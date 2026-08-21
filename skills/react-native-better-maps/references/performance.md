# Performance

Marker and camera pipeline, then profiling. Every pipeline number is read from source; keep them in sync when the constants move.

## Marker and camera pipeline

How overlay data actually executes, per cadence.

## The two marker paths

`usesViewportPipeline` decides, on both platforms: clustering enabled **or** more than 500 descriptors.

**Synchronous path** (small, unclustered): the full descriptor list becomes render elements and applies on the main thread in one pass.

**Viewport pipeline** (clustering or large):

1. Build `MarkerSpatialIndex`, a 96×96 uniform grid, on a background queue. Immutable after construction, so queries are thread-safe.
2. Query candidates for the padded visible region.
3. Either `MarkerClusterEngine.clusters(...)` or `MarkerViewportFilter.displaySubset(...)`.
4. Diff against displayed versions, keyed by marker id or cluster key.
5. Post the diff to the main thread and apply it, guarded by a generation counter that drops stale results.

Background queues: `com.nitromaps.markerCompute` (`.userInitiated`) on iOS, a single-thread `Executors` pool on Android, recreated after `clear()`.

## Constants

| Constant | Value | Where | Effect |
| --- | --- | --- | --- |
| `asyncThreshold` / `ASYNC_THRESHOLD` | 500 | `MarkerRenderPipeline`, `MapOverlayController.kt` | Sync vs viewport pipeline |
| Spatial index `cellsPerSide` | 96 | `MarkerSpatialIndex` both platforms | Grid resolution |
| Candidate padding | 0.2 of span | `MarkerSpatialIndex`, `MarkerViewportFilter` | Off-screen margin |
| `liveRefreshInterval` | 0.1 s | `MarkerRenderPipeline` (iOS) | Live cluster timer while gesturing |
| Debounced refresh delay | 0.12 s | `scheduleViewportRefresh` (iOS) | Coalesces settle |
| `LIVE_REFRESH_THROTTLE_MS` | 180 | Android | Minimum gap between live passes |
| `IDLE_REFRESH_DEBOUNCE_MS` | 120 | Android | Coalesces repeated short pans |
| Cluster cell target | 64 pt / 96 pt / 64 dp | `MarkerClusterEngine.defaultCellPoints` (iOS Apple), `GoogleMapOverlayController` (iOS Google), `MarkerClusterEngine.CELL_DP` (Android) | Grid coarseness; **provider-dependent** |
| `MAX_ANIMATED_MARKERS_PER_DIFF` | 96 | Android and iOS Google | Entering animation budget. **The Apple provider has no cap.** |
| `MAX_LIVE_ANIMATED_MARKERS_PER_DIFF` | 24 | Android | Budget during gestures |
| LOD caps by `latitudeDelta` | 2000 / 800 / 350 / 200 | `MarkerViewportFilter` | Unclustered large sets |
| Marker image LRU | 64 | `src/overlays/resolveMarkerImage.ts` | JS-side resolved assets |

Level-of-detail intentionally hides markers: below 0.08 delta shows up to 2000, below 0.5 up to 800, below 2.0 up to 350, otherwise 200, chosen by spatial subsampling so the survivors stay evenly spread. Changing these caps changes what users see, so it travels with a doc update.

## Cost per cadence

**Per render.** `useCollectedOverlays` rebuilds descriptor arrays whenever `children` identity changes, resolving `require()` images through an LRU on the way. `normalizeMarkerDescriptors` compares each bulk descriptor field by field and returns the original array when nothing changed, so a stable input array stays reference-stable.

**Per prop update.** Fabric parses each changed prop through `CachedProp::fromRawValue`, and Nitro's `JSIConverter` constructs a C++ struct per marker — `std::string` id, nested coordinate, optional image, anchor, animation. Cost scales with marker count and field richness. Unchanged props keep the previous value and cost nothing.

**Per marker set.** Native hashes the whole array (`markersFingerprint`) and returns early when it matches, so React re-sending identical data costs one hash instead of a rebuild. The conversion above has already been paid by then — the fingerprint saves SDK churn, not the crossing.

**Per camera event.** Marker work is scheduled continuously — live refresh on a timer or throttle, idle refresh on a debounce — but the JS callbacks are not. `onRegionChange` fires once when a gesture-driven move begins and `onRegionChangeComplete` once when it settles, both latched behind `isUserRegionChange` / `isUserGesture`; programmatic moves emit neither. So per-frame native work does not imply per-frame JS work.

**Per diff apply.** Removals, additions, and retained-element updates run on the main thread. Apple updates retained annotations in place through `MapMarkerAnnotation.update`, which reports whether anything visual changed and only then refreshes the annotation view.

**Per shape-overlay update.** Shapes get none of the protection markers get, and this is the biggest asymmetry on the page. There is **no fingerprint for `polylines`, `polygons`, or `circles`** on any backend — no equivalent of `markersFingerprint` exists — so the early-return above never applies to them. What each backend then does with the array differs:

| Backend | Updating an existing shape |
| --- | --- |
| iOS + Apple | `removeOverlay` + `addOverlay` for **every descriptor in the array**, changed or not |
| Android | `remove()` + re-add, for ids present in both sets |
| iOS + Google | Mutates `path`, colours, and widths **in place** |

The Apple path is the one to watch: `syncShapeOverlays` loops the full descriptor array and unconditionally destroys and recreates each overlay, with no content comparison anywhere. A hundred-segment route polyline re-sent unchanged is a hundred `MKOverlay` teardowns and rebuilds on the main thread.

Because the guard is absent natively, **reference stability of the shape arrays is entirely your responsibility.** Memoise them. An inline `polylines={routes.map(toDescriptor)}` recomputed every render is cheap in JS and expensive on the other side of the boundary, and unlike the marker case nothing downstream will absorb it.

## Camera

Declarative `region` and `camera` props sync into the adapter through property observers; the ref methods drive imperative moves.

The guard against a controlled `region` fighting the user is simpler than you might expect, and worth knowing precisely. On iOS both observers bail out while `view.isUserInteracting`, so a `region` value arriving mid-gesture is dropped rather than queued — it is not re-applied when the gesture ends. **`camera` also takes precedence over `region`**: the `region` observer additionally requires `camera == nil`, so passing both means `region` is ignored entirely. There is no callback-suppression bookkeeping, no in-flight update registry, and no timer fallback on either platform.

The practical consequence is that the feedback loop is yours to avoid, not the library's to absorb. See [rendering.md](rendering.md).

`animateCamera` defaults to a **0.25 s** duration on all three backends when the argument is
omitted. The argument itself is in **seconds** — see
[api.md](api.md#imperative-handle).

`mapPadding` is density-independent pixels, applied as `layoutMargins` on iOS and `setPadding` on Android. `fitToCoordinates` converts the whole coordinate array per call.

## Keeping the map smooth

- Marker data stays independent of camera state. Heavy application work belongs on `onRegionChangeComplete`.
- Bulk `markers` arrays stay reference-stable across renders that do not change marker content.
- Bulk `polylines` / `polygons` / `circles` arrays stay reference-stable too, and it matters more than for markers: they have no native fingerprint guard, and Apple recreates every overlay on each update.
- Thousands of points go through the bulk prop rather than thousands of JSX children, which keeps the collection loop off the render path.
- Throttles, debounces, and animation budgets stay as they are unless a profile justifies the new value; they exist to protect gesture frame rate on Google backends, where every marker add is main-thread work.
- Entering animations on very large viewport refreshes are the first thing to disable when gestures stutter, ahead of touching thresholds.

## Marker images

JS resolves Metro assets before the crossing, so native receives `{ uri, width?, height?, scale? }`. Remote `http(s)` URIs load asynchronously into an in-memory cache — `NSCache` on iOS, `MarkerIconFactory` on Android — with no disk persistence. README guidance is bitmaps up to 128×128 dp, downscaled when explicit dimensions are supplied.

## Entering animations

`normalizeEnteringAnimation` turns the public value (`false`, `'system'`, or a preset config) into `{ kind, duration?, delay?, reduceMotion? }`. Map-level `markerEnteringAnimation` and `clusterEnteringAnimation` set defaults; per-marker values override them. Durations and delays clamp to 0–3000 ms, `reduceMotion: 'system'` honours the platform setting, and animations replay only when a marker is added again, not when its config changes while retained.

---

# Profiling and benchmarking

Commands and procedures for measuring the map. Nothing here quotes a target number: the library
repository contains no benchmark harness and no performance gate. Measure release builds on a
real device, or do not claim a number.

## Before you measure anything

Answer these first. Without them there is no experiment, only an opinion.

| Question | Why it changes the answer |
| --- | --- |
| How many markers? | The pipeline switches at 500. Below it, work is synchronous. |
| Clustering on or off? | Different algorithm, different output size. |
| Which provider? | Apple MapKit and Google Maps have very different marker costs. |
| Which platform and device? | A Pixel 3a and an iPhone 16 Pro are not the same problem. |
| Debug or release? | Debug JS is interpreted or unoptimised; Debug native has fewer optimisations. **Debug numbers are not evidence.** |
| Which gesture? | A slow pan, a fling, a pinch, and an idle map exercise different paths. |
| Which metric? | Frame rate, dropped frames, time-to-first-render, memory. |
| What is the current number? | Without a baseline there is nothing to compare. |

**Always measure in a release build on a physical device.** Simulators have no realistic GPU
constraint and emulators are usually far slower than real hardware; both mislead, in opposite
directions.

```bash
npx expo run:ios --configuration Release
npx expo run:android --variant release
```

## Layer 1 — JavaScript and React

Start here. Most map jank is a React problem, not a map problem.

**React DevTools profiler.** Record a pan, then read the flamegraph:

```bash
npx react-devtools
```

What you are looking for: does the component containing `MapView` re-render during the gesture? If
it renders dozens of times per second, stop — you have found it, and
[rendering.md](rendering.md) has the fix. Nothing further down matters until this is
clean.

**Count the crossings.** A crude but effective instrument:

```tsx
const renders = useRef(0);
renders.current += 1;
console.log('MapView parent render', renders.current, 'markers', markers.length);
```

If that number climbs during a pan, the marker payload is being rebuilt at gesture frequency.

**Time descriptor construction**, if you build the array yourself:

```tsx
const markers = useMemo(() => {
  const t = performance.now();
  const out = places.map(toDescriptor);
  console.log('descriptors', out.length, (performance.now() - t).toFixed(1), 'ms');
  return out;
}, [places]);
```

A number that grows while you pan means the memo dependency is unstable.

## Layer 2 — frame rate

### Android

`gfxinfo` is the fastest reliable measurement, and it needs no tooling beyond `adb`:

```bash
adb shell dumpsys gfxinfo <your.package.name> reset
# ... perform the exact gesture, for a fixed duration ...
adb shell dumpsys gfxinfo <your.package.name>
```

Read the "Janky frames" percentage and the 50th/90th/95th/99th percentile frame times. A frame
budget of 16.7 ms is 60 Hz; many devices run at 90 or 120 Hz, where the budget is 11.1 or 8.3 ms.

Record: device, Android version, build variant, marker count, gesture, duration, janky-frame
percentage, and the 95th percentile. Change one thing, repeat, compare.

For a detailed trace, capture a Perfetto trace from the device's developer options, or use the
Android Studio Profiler's CPU recording and look at main-thread time inside the Google Maps SDK
versus your own code.

### iOS

Instruments, driven from the command line:

```bash
xcrun xctrace list templates          # confirm what is installed
xcrun xctrace record --template 'Time Profiler' \
  --device-name '<device>' --launch -- <app path>
```

Or open Instruments from Xcode (Product → Profile) and use:

| Template | Answers |
| --- | --- |
| **Time Profiler** | Where main-thread time goes. Look for `MapOverlayController`, `MarkerClusterEngine`, and MapKit/GMS symbols. |
| **Animation Hitches** | Frame drops during gestures, with a hitch ratio you can compare run to run. |
| **Allocations** | Whether marker churn is allocating unboundedly. |

What to look for specifically: cluster computation should appear on
`com.nitromaps.markerCompute`, **not** on the main thread. If it is on the main thread, either the
marker set is below the 500 threshold with clustering off (expected) or something has changed.

## Layer 3 — the JS/native boundary

There is no built-in instrumentation for this. Measure it indirectly: hold the marker array
identity constant and vary nothing else. If frame rate improves, the crossing was the cost. If it
does not, the cost is in layers 1 or 4.

A single crossing is proportional to descriptor count times field richness. A useful experiment is
to strip optional fields (`image`, `anchor`, `enteringAnimation`) from a large set and see whether
it moves the number.

## Layer 4 — native map rendering

Isolate by substitution:

- **Render the same markers with clustering on.** If it gets dramatically better, the cost was the
  number of native marker objects, not your code.
- **Halve the marker count.** If time halves, you are marker-bound. If it does not, you are bound by
  something else.
- **Switch provider on iOS** (`apple` ↔ `google`, with a valid key). A large difference implicates
  the SDK, not this library.
- **Render an empty map** with the same gesture. That is your floor; nothing you do to marker code
  gets below it.

## Memory

```bash
# Android
adb shell dumpsys meminfo <your.package.name>
```

On iOS use the Allocations instrument. Things worth watching, given how this library works:

- **Three separate image caches.** In JavaScript, `resolveMarkerImage` memoises resolved asset
  sources in a 64-entry LRU. Natively, Android holds a 64-entry `LruCache` of `BitmapDescriptor`
  (plus a parallel 64-entry size cache), while iOS uses an `NSCache` with no count limit, evicted
  only under memory pressure. A workload with thousands of distinct marker images therefore behaves
  differently on the two platforms — see [android.md](android.md) and
  [ios.md](ios.md).
- A remounted map (provider or `googleMapId` change) releases its previous adapter through
  `prepareForRecycle`. If memory grows with every remount, that is a leak worth reporting.

## Benchmarking a change to the library

There is **no benchmark harness in this repository**, and no performance gate in CI. Any number you
produce, you produce yourself. Report it with enough context to be reproducible:

```text
Device:        iPhone 13, iOS 18.4
Build:         Release
Provider:      apple
Markers:       5,000, clustering enabled
Workload:      continuous horizontal pan, 10 s, zoom level ~12
Metric:        hitch ratio (Animation Hitches instrument)
Git SHA:       <before> / <after>
Before:        <n> ms/s
After:         <n> ms/s
Runs:          3 each, median reported
```

Rules that keep the comparison honest:

- **Same device, same build mode, same OS version, same thermal state.** Let the device cool
  between runs; sustained profiling throttles the CPU and will manufacture a regression.
- **Same workload**, ideally scripted or at least described precisely enough to repeat.
- **Three runs minimum**, report the median. One run of anything on a phone is noise.
- **Change one thing.** A diff that adjusts a threshold *and* refactors the diffing gives you no
  information about either.

If you are changing one of the constants in [performance.md](performance.md) — a threshold, a
throttle, an animation budget — the measurement is not optional. Those values exist to protect
gesture frame rate on Google backends, and lowering one to fix a jank report whose real cause is
per-render JavaScript makes the library worse for everyone else.

## Adding a benchmark

There is no harness to extend, so adding one is a genuine contribution rather than a matter of
adding a case. A useful shape would be a script in the example app that renders a fixed synthetic
dataset, drives a scripted camera path, and reports frame statistics — with the workload checked
in so results are comparable across machines. Discuss it in an issue before building it; the
maintainers may have a preferred approach.
