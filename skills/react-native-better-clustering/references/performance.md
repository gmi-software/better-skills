# Performance

Separate **three** costs before changing code. Most "clustering is slow" reports mix them.

```
clustering compute     ClusterEngineCore::build / getClusters in C++
        ↓
React reconciliation   stabilize + commit Marker elements
        ↓
map rendering          react-native-maps annotations + map SDK (Google/Apple)
```

(JSI conversion sits on the query path between clustering and React — count it when JS is busy inside `getClusters` / `JSIConverter`.)

A fast `build()` with 20k points still drops frames if 400 `<Marker>`s mount on zoom. A smooth map can still hitch once on load if the caller uses `Supercluster.load()` (`build()` on the JS thread) instead of `loadAsync()`.

Cadence labels: **per mount · per dataset change · per render · per region event · per settle**.

Speed changes follow the **canonical optimization workflow** in [SKILL.md](../SKILL.md). Vague goals ("2x faster") must become a measurable workload first.

Architecture copies / threads: [architecture.md](architecture.md). Marker identity: [rendering.md](rendering.md). Viewport `k` inflation: [algo.md](algo.md).

## Which layer? (checkable)

| Observation | Likely layer |
| --- | --- |
| Hitch once when data arrives, then pan is fine | `loadAsync` / `build` (or accidental `load()` on JS) |
| Every parent rerender hitches, even without moving the map | `data` / `children` identity → full index rebuild ([rendering.md](rendering.md)) |
| iOS fine / Android slow with similar `n` | Often Apple vs Google Maps annotation cost ([debugging.md](debugging.md)) — not KD-tree by default |
| Pan/zoom FPS falls as **visible** markers rise; CPU in RN Maps / Google / MapKit | marker rendering |
| JS thread busy in `getClusters` / `JSIConverter` / `useMemo` at 10 Hz | query conversion + GeoJSON mapping |
| JS thread busy in Reanimated `setNativeProps` historically; today fade uses `useAnimatedProps` | if someone reintroduces JS-driven opacity on every bubble |
| Tiles crawl, clusters already drawn | map SDK / network, not this library |

README's own ceiling: view-child `<Marker>` typically ~50–150 visible annotations at ~60 FPS. That is a **rendering** bound. Do not "fix" it by rewriting `KDTree`.

## JS

**Per render.** `MapView` does `React.Children.toArray(children)` whenever `children` identity changes, then builds a new `markerFeatures` array. `useClusterer` lists `data` in its effect deps — a new array rebuilds the engine.

**Per dataset change.** `packPoints` allocates an `ArrayBuffer` and walks every point on JS. `extractGeoJSONAggregationValues` walks properties when `clusterProperties` is set. Then `setOptions` + `setPoints` (native copy) + `buildAsync`.

**Per region event.** `useClusterer` `useMemo` calls `getClustersFromRegion` (sync JSI) and `stabilizeClusterFeatures`. Compat throttles `setCurrentRegion` to `clusterUpdateIntervalMs` (default 100; `0` = settle only).

**Per settle.** Flush throttle; optional iOS `LayoutAnimation`; `onRegionChangeComplete` after `clusters` updates (no second engine query).

Stabilization reuses feature object identity when `cluster_id` + coordinates + count match (`package/src/hooks/stabilizeClusters.ts` keys). It does not prevent RN Maps from removing/adding annotations when React keys change. Default cluster keys are `cluster-${cluster.id}`; new cluster ids on zoom still remount bubbles (`ClusterMarker.tsx` comment).

Memoization: [rendering.md](rendering.md). Blind `useMemo` on the `clusters` map that still returns new Marker elements every time does not help the native annotation path.

### Callbacks

Module-level `noop` keeps default `onClusterPress` / `onRegionChangeComplete` / `onMarkersChange` stable. Inline `onClusterPress={() => {}}` in the app breaks `handleClusterPress` and remounts cluster markers.

`getAllLeaves` on cluster press is synchronous and unbounded. A cluster of tens of thousands of leaves will hitch on tap even if pan was fine.

## Native

**CPU.** `build()` is the heavy native pass (`O(Z · n log n)` typical). `getClusters` is a range query; cheap relative to JSI + markers for normal `k`.

**Allocations.** Per build: points, per-zoom vectors, KD-trees, `_nodeById`. Per query: `vector<ClusterNode>` + `EngineClusterNode` + JS objects.

**Threads.** `buildAsync` off JS; `build()` and queries on the caller (JS) thread. Putting `load()` in a render path blocks JS for the full hierarchy. `ClusterEngineCore` is **not** thread-safe — no concurrent build/query on one instance ([architecture.md](architecture.md)).

**Native memory.** `memorySize()` / `getExternalMemorySize`. Retaining multiple `Supercluster` instances (forgotten `destroy`, overlapping `useClusterer` effects) stacks full indexes.

## Map rendering

`react-native-maps` creates a native annotation per mounted `<Marker>`. Compat renders **all** query results, and the query bbox is 4× the visible region ([algo.md](algo.md)), so annotation count exceeds what the user sees.

`tracksViewChanges` defaults **false**. `true` makes Google Maps redraw the marker bitmap every frame — a classic FPS killer. Custom `renderCluster` that wraps a custom view marker inherits that cost if it leaves tracking on.

Default cluster fade: Reanimated UI-thread `opacity` on the **Marker**. A previous JS `Animated` path showed ~23% self-time in the comment on `ClusterMarker.tsx`. Do not revert that.

While moving, `effectiveFadeOut = 0` so `useFadePresence` does not keep 2–3 bubble generations mounted during a 100 ms recompute cadence (comment: that dragged JS to ~30 FPS on continuous zoom-out).

## Compat knobs that are frame-budget tools

| Knob | Default | Effect |
| --- | --- | --- |
| `clusterUpdateIntervalMs` | 100 | Lower → more queries + commits while gesturing. `0` → clusters only on settle (pan looks stale, JS quieter) |
| `clusterFadeInDuration` | 250 | `0` or `animationEnabled={false}` skips Reanimated markers |
| `tracksViewChanges` | false | Keep false unless the bubble content is live |
| `spiralEnabled` | true | At max zoom, one cluster becomes many spider markers + polylines |
| `clusteringEnabled` | true | `false` mounts **all** marker children (n annotations) |

Changing radius/minPoints/zoom range to "make pan faster" without a profile usually just changes `k` (visible count). Measure `k` and annotation count first.

## Large datasets

Workload bands below are **benchmark categories**, not library guarantees. README claims the C++ engine "indexes 10k+ points"; the example ships **2000** markers; CONTRIBUTING's release checklist mentions **30k** as a manual feel test.

| Band | Marker count | What usually dominates |
| --- | --- | --- |
| Small | < 1,000 | React children collection, not the engine |
| Medium | 1,000–10,000 | Index rebuild if `data` is unstable; rendering if zoomed in |
| Large | 10,000–50,000 | `buildAsync` duration; pan/zoom **visible** `k`; JS `packPoints` |
| Very large | 50,000+ | Native memory (`O(Z · n)` worst); never mount `n` Markers |

`k` = nodes returned by `getClusters` (padded bbox). FPS follows `k` and annotation churn, not `n`, once the index exists.

### Initial load

Path: pack (JS) → `setPoints` copy → `buildAsync` (native) → first query → first Marker commit.

- `useClusterer` / compat `MapView` already use `loadAsync`. Headless `load()` blocks JS for the full `build()`.
- `packPoints` is `O(n)` on JS before the async build starts. 50k v1 points ≈ 1 MB buffer plus DataView writes.
- Until `isLoaded`, `useClusterer` returns `[]` (blank clusters, map still shows).

Measure: time to `isLoaded`, JS thread during pack, native thread during build, first-frame annotation count.

### Viewport changes (pan)

Index stays. Each throttle tick: sync JSI `getClusters` + stabilize + React commit of the diff.

Default `clusterUpdateIntervalMs = 100` → ~10 query/commit cycles per second while moving. `0` → update only on settle.

Compat bbox is 4× visible area, so `k` is larger than on-screen pins.

### Zoom

Zoom changes `floor(zoom)` and therefore `_clustersByZoom[z]`. Cluster **ids change**, so default bubbles remount (`cluster-${id}`). Fade-in/out exists to hide that blink; while gesturing, fade-out is disabled to avoid stacking generations.

Zoom-in toward `maxZoom` increases `k` (more leaves). That is the rendering cliff, not a build cliff.

At `maxZoom` with `spiralEnabled`, a stuck cluster spiderfies into many markers + polylines — `k` jumps again.

### Marker updates

There is **no incremental API**.

| App intent | What the library does |
| --- | --- |
| 1% of points moved | New `data` array → destroy + full `loadAsync` |
| 10% changed | Same |
| 100% replaced | Same |
| Same coordinates, new array identity | Same — identity is the trigger |

For live GPS fleets, rebuild cost is `O(Z · n log n)` native plus pack, **on every update you fail to debounce**. Debounce/batch in the app; do not patch `ClusterEngineCore` for one moving point without a design for incremental trees.

`cluster={false}` markers skip the engine and always mount — a live user pin belongs there so the index is not rebuilt on every location tick.

### Memory

- JS: full GeoJSON `loadedFeatures` (`n` objects).
- Native: points + per-zoom structures (`memorySize()`).
- Annotations: `O(k)` views/bitmaps in RN Maps, plus fade ghosts when not moving.

Two `MapView`s or overlapping `useClusterer` hooks duplicate the native index.

Report: `n`, estimated `k`, provider, device, release vs debug, load time (pack vs build vs first commit), pan p50/p95 frame time, zoom remount count if you have React Profiler.

Do not use `bench.cpp` query_ms as a substitute for pan FPS.

## Profiling

Establish **which layer** is slow before changing `ClusterEngineCore`. The question:

```
Is the bottleneck:
1. JS?          (packPoints, useMemo, React commit, GeoJSON mapping)
2. native?      (build(), KD-tree, memory)
3. JS/native boundary?  (JSIConverter per EngineClusterNode)
4. clustering algorithm?
5. map rendering?       (react-native-maps / Google / MapKit)
6. React reconciliation?
7. memory / GC?
```

Record the **cadence** (dataset change vs region event vs settle) on the same trace.

This section is how to execute the profile step of the canonical workflow in [SKILL.md](../SKILL.md) — not a second workflow.

### Before you profile

1. Reproduce on the failing platform. Prefer a **release** (or release-like) build for FPS claims — see Debug vs Release below.
2. Record: `n` (input markers), `k` (returned / visible feature count), map provider (Apple vs Google), clustering props, device vs emulator/simulator.
3. Capture a trace of the failing interaction (pan, zoom, or load) — not idle.
4. Split the timeline: JS thread vs UI thread vs Nitro async worker (`buildAsync`).
5. Only then apply the layer table above for the matching fix.

### Marker counts: `n` and `k`

```text
n = input markers
k = returned cluster/visible feature count
```

| Path | How to obtain |
| --- | --- |
| Compat `MapView` | `n`: length of clusterable Marker children (or `markerFeatures.length` if you temporarily log inside/app-side). `k`: `onMarkersChange` receives the stabilized `clusters` array — `markers.length` is `k` for the current region (`MapView.tsx` effect). |
| `useClusterer` | `n = data.length`. `k = clusters.length` after load. |
| Headless `Supercluster` | `n = points.length`. `k = getClustersFromRegion(...).length` (or `getClusters(bbox, zoom).length`). |
| C++ only | `bench.cpp` / `getClusters` result size — no React markers. |

Do not confuse `n` with on-screen pins: compat bbox is 4× visible area, so `k` includes off-screen nodes that still mount as Markers ([algo.md](algo.md)).

### React Native / React DevTools

There is no single universal CLI that captures a React profile for every RN version. Use the tooling that ships with the app's React Native:

1. Run the app with Metro (`npx react-native start` / `bunx expo start`).
2. Open the **Dev Menu** → **Open React Native DevTools** (Hermes) or the React DevTools entry your RN version documents.
3. In the **Profiler**, record while reproducing pan/zoom/load.
4. Inspect commit durations and which components re-rendered.

Interpretation:

- A commit every ~100 ms matching `clusterUpdateIntervalMs` is expected while gesturing.
- Commits every frame usually mean the throttle is bypassed or `children` / `data` is new every render ([rendering.md](rendering.md)).
- Hermes sampling: look for `packPoints`, `getClusters`, `engineFeatureToGeoJSON`, `stabilizeClusterFeatures`, `markerToGeoJSONFeature`, `useClusterer`.
- If sync `load` / `build` appears on the JS thread for large `n`, switch to `loadAsync` / `useClusterer`.

Stabilized cluster feature identity still remounts when `cluster.id` changes on zoom.

### Android — executable frame stats

`adb` path on this machine (adjust if your SDK differs):

```bash
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
"$ADB" devices
```

Identify the package:

```bash
"$ADB" shell pm list packages | rg -i 'expo|better|cluster|yourapp'
"$ADB" shell dumpsys activity activities | rg -i 'mResumedActivity|topResumedActivity'
```

Example app package is whatever `example/app.json` / Android applicationId resolves to after prebuild — do not hard-code a package name without checking the built app.

```bash
PACKAGE='com.your.app'   # replace with the real package

"$ADB" shell dumpsys gfxinfo "$PACKAGE" reset
# …reproduce the jank…
"$ADB" shell dumpsys gfxinfo "$PACKAGE" framestats
```

**What this measures:** historical frame timing / jank stats for the app's UI frames. Useful for comparing before/after on the **same device and build type**.

**What it does NOT measure:** `ClusterEngineCore::build` vs `getClusters` vs React commit vs Google Maps marker add; JS vs UI attribution (use Android Studio CPU Profiler / Perfetto); absolute "map FPS" as a marketing number.

**Emulator caveat:** Do **not** use emulator map FPS as final performance evidence. Prefer a real device; label any emulator numbers as non-authoritative.

### Perfetto / System Trace

If Android Studio **CPU Profiler → System Trace** or the Perfetto UI is available, capture a short system trace during pan/zoom. Attribute:

- UI thread: `GoogleMap` / marker add-remove / RN Maps overlays
- JS thread: Hermes; Nitro JSI under the JS thread
- Worker: `ClusterEngineCore::build` during `loadAsync`

There is no required `perfetto` CLI on every machine; GUI capture is valid. Do not invent CLI flags.

`newArchEnabled` must be true; otherwise you are not profiling this library's real path.

### iOS — Instruments

CLI: `xcrun xctrace` is available; **Time Profiler** and **Allocations** are standard Instruments templates. Prefer the Instruments GUI for map work:

1. Open **Instruments** (Xcode → Open Developer Tool → Instruments), or `open -a Instruments`.
2. Choose **Time Profiler** (CPU) or **Allocations** (memory).
3. Select a **physical device** for FPS claims; Simulator is fine for membership / load correctness.
4. Target the example or app process; record while panning/zooming.
5. Filter / search symbols: `HybridClusterEngine`, `ClusterEngineCore`, `nitromapcluster`, then separately MapKit / Google Maps / RN Maps annotation paths.

They are **different threads in the same app process and the same frame budget** — not different OS processes.

**os_signpost:** this library does not emit signposts. Do not document fictional intervals.

LayoutAnimation on settle is iOS-only — a Time Profiler spike in Core Animation / RN at gesture end is that path.

### Debug vs Release (iOS engine)

The podspec does **not** set explicit `-O2`/`-O0` for the C++ engine. Xcode **Debug** builds typically compile C++ without optimization (effectively unoptimized / `-O0`-class), while **Release** uses the project's release optimization settings.

```text
Do not use Debug iOS engine timings as production performance evidence.

Debug
→ useful for debugging

Release
→ meaningful for performance measurement
```

Do not claim an exact compiler flag unless you inspected the build log for that configuration.

Android native flags are explicit: Debug `-O1 -g`, Release `-O2` (`package/android/build.gradle`) — still do not compare Debug Android to Release iOS as if equal.

### Isolating clustering from rendering

To see engine cost without RN Maps:

1. Drive `Supercluster.loadAsync` + `getClustersFromRegion` in a tight loop with no Marker tree (or `package/cpp/bench.cpp` for C++ only).
2. Compare wall time to the same interaction in the full `MapView`.
3. If (1) is milliseconds and (2) is frame drops, stop looking at the KD-tree.

`bench.cpp` and `scripts/bench-supercluster.mjs` never mount a map. Treat them as compute baselines only (below).

### Memory (profiling)

| Heap | What to look for |
| --- | --- |
| JS | `loadedFeatures` retained; GeoJSON rebuilt every render; fade presence maps |
| Native | `memorySize()` growing across loads; multiple HybridObjects |
| Images / annotations | RN Maps marker views and bitmaps — not this engine |

C++ `testMemorySizeReflectsNativeAllocations` asserts `memorySize()` rises after `setPoints` and again after `build`. There is no JS API exposing that number today.

### What not to do with a profile

- Rewrite the algorithm because Time Profiler shows `nth_element` during **load** while the user complained about **pan**.
- Enable `tracksViewChanges` to "debug" flicker (it will dominate the next profile).
- Compare debug iOS / `-O1` Android native to release as if they were the same build.
- Treat emulator/simulator map FPS as final evidence.

## Benchmarking

In-repo harnesses measure **compute**, not map FPS. Quote them as compute. Map FPS is a device measurement you still have to take.

Evidence bar: no in-repo FPS harness. C++ `bench.cpp` measures build + `getClusters` only. Do not cite those numbers as map FPS.

### What already exists

#### C++ engine — `package/cpp/bench.cpp`

Not in CI. Uniform-ish grid around 52°N, 21°E. Config: `radius 50`, `minPoints 2`, `minZoom 0`, `maxZoom 16`, `extent 512`, `nodeSize 64`. Viewport fixed `{north 53, south 51.5, east 22, west 20.5, zoom 10}`.

```bash
cd package/cpp
c++ -std=c++20 -O2 -I. bench.cpp -o cluster_bench
./cluster_bench
```

Prints `cpp,n=...,build_ms=...,query_ms=...,runs=10,queries=100` for `n` in `{1000, 5000, 10000, 20000, 30000, 50000}`.

`build_ms` includes `setPoints` + `build`. `query_ms` is average `getClusters` over 100 calls. **No JSI, no GeoJSON, no Markers.**

#### JS supercluster comparison — `scripts/bench-supercluster.mjs`

Times **Mapbox `supercluster@8`**, not this package. Same `n` set and similar bbox/zoom. Useful as a "JS clusterer baseline", not as a Nitro result.

Do not report those numbers as `react-native-better-clustering` query time.

### Scenarios to run (library or app)

Prefer **release** native builds for FPS. Use bands: 1k / 10k / 20k / 50k, uniform vs city-clumped, pan vs zoom vs replace.

#### Initial load

```
1k / 10k / 20k / 50k → packPoints + loadAsync + first getClusters + first React commit
```

Split timings: pack (JS) | build (native async) | first query+JSI | first annotation commit.

#### Pan

```
index already built → 30–60 throttled region updates (clusterUpdateIntervalMs = 100)
```

Record JS thread time, UI thread time, dropped frames, `k` (clusters.length).

#### Zoom

```
same n → animate minZoom-ish to maxZoom and back
```

Cluster ids remount. Watch annotation add/remove and fade.

#### Updates

```
10k → 1% coordinates changed (new data array, full rebuild)
10k → 10% changed
10k → 100% replaced
```

All three are full `loadAsync` in this library. Measure rebuild wall time; do not pretend 1% is incremental.

#### Headless vs MapView

Same points and region: `Supercluster.getClustersFromRegion` loop vs compat `MapView`. The delta is JSI+React+RN Maps.

### Metrics

| Metric | How |
| --- | --- |
| Total / average / p50 / p95 / p99 wall time | `bench.cpp` style loop, or Instruments/Perfetto slices |
| Native CPU | Time Profiler / Android CPU on `ClusterEngineCore::build` |
| JS thread time | Hermes sampling during pan |
| Dropped frames | Xcode FPS / `adb shell dumpsys gfxinfo` / RN perf monitor (dev only, label it) |
| Memory | JS heap + `memorySize()` if you expose it; Allocations / Android Profiler |
| `k` | `clusters.length` after stabilize |

Always record: device, OS, map provider, debug/release, `n`, region, radius, min/max zoom, `clusterUpdateIntervalMs`.

### Geographic distribution

`bench.cpp` places points on a 0.01° grid (`i/100`, `i%100`). Real city dumps clump harder (faster merge, smaller low-zoom `k`, heavier `within` during build). Run at least:

- uniform grid (harness default)
- one tight cluster (all points within a few meters)
- mixed (example-style random in a country bbox)

### Rules

- Benchmark more than one `n`. Cold load is not pan.
- Do not use synthetic `query_ms` as the only evidence for a MapView PR.
- Compare Apple Maps vs Google Maps separately; annotation cost differs.
- If the PR changes the algorithm, run `bench.cpp` **and** a device pan/zoom on the example (or larger `n`).
- State the comparison: before/after git SHA, same device.

There is no checked-in golden CSV of times. Do not invent one. Paste fresh output in the PR.
