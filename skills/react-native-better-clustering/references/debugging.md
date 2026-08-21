# Debugging

Finish each step before the next. The later steps are easy to rush; the bound on each step is checkable.

For **performance** issues, after you know it is a speed problem, follow the **canonical optimization workflow** in [SKILL.md](../SKILL.md) — do not invent a parallel numbered optimization workflow here.

```
1. Reproduce
2. Reduce dataset
3. Correctness or performance?
4. Layer (JS / JSI / native / RN Maps)
5. Cadence (dataset vs region vs settle)
6. Isolate clustering (headless query)
7. Isolate rendering (Marker count / tracksViewChanges)
8. Viewport / zoom math
9. Algorithm / ids
10. Regression test
11. If speed: canonical optimization workflow (SKILL.md)
```

## Decision tree

```
Symptom
├─ Crash / exception
│  ├─ JS: query-before-build (exact string in architecture.md) → lifecycle
│  ├─ JS: "can only be called once" / destroyed → Supercluster instance reuse
│  │     (exact: "The .load() or .loadAsync() method can only be called once.")
│  ├─ Native module missing → New Arch / pods / so / Expo Go ([setup.md](setup.md))
│  └─ RN Maps "Map size can't be 0" → layoutReady path
├─ Blank map
│  └─ Android Google key, or clusters still loading (`[]` until isLoaded)
├─ Wrong membership / missing points
│  ├─ Edge of screen → bbox padding / dateline ([algo.md](algo.md))
│  ├─ Invalid coords dropped
│  ├─ `cluster={false}` / `clusteringEnabled`
│  ├─ integer zoom / longitudeDelta >= 40
│  └─ id collision with invalid interior points ([algo.md](algo.md))
├─ Flicker / remount
│  └─ [rendering.md](rendering.md) + ClusterMarker keys
├─ iOS fine / Android slow
│  └─ Provider asymmetry first (below) — not KD-tree by default
├─ Concurrent engine / mysterious native corruption
│  └─ Thread safety ([architecture.md](architecture.md)) — ClusterEngineCore is not thread-safe
└─ Slow / low FPS / regression
   └─ Canonical optimization workflow ([SKILL.md](../SKILL.md)) + [performance.md](performance.md)
      Do not start in ClusterEngineCore
```

## 1. Reproduce

Record: platform, Apple vs Google, `n`, approximate visible markers / `k`, clustering props (`radius`, `minPoints`, `maxZoom`, `clusterUpdateIntervalMs`), release vs debug, pan vs zoom vs load vs tap.

Completion: a second person (or you tomorrow) could hit the same bug from those notes.

## 2. Reduce dataset

Try `n = 0, 1, 10`, then a tight clump, then the original set. Example app uses 2000 random points in Poland.

Completion: smallest `n` and geographic pattern that still fails.

## 3. Correctness or performance

Wrong bubbles vs dropped frames. Both at once: fix membership first; speed work on a wrong query is wasted.

## 4–5. Layer and cadence

See [SKILL.md](../SKILL.md) troubleshooting + [architecture.md](architecture.md).

Log (temporarily) `data.length`, whether `useClusterer`'s effect ran, `isLoaded`, `clusters.length`, `floor(zoom)`, bbox. Remove the logs after.

Completion: one layer, one cadence.

## 6. Isolate clustering

```ts
await supercluster.loadAsync(features)
supercluster.getClustersFromRegion(region, dims)
```

No `Marker` tree. Compare `k` and wall time to the map.

C++: `ClusterEngineCore.test.cpp` patterns; `bench.cpp` for timing without JSI.

Do not call query methods on a headless engine concurrently with `buildAsync` ([architecture.md](architecture.md)).

## 7. Isolate rendering

`clusteringEnabled={false}` mounts every Marker (`n` annotations) — a stress test, not a fix. Compare `tracksViewChanges`, custom vs default `renderCluster`, `spiralEnabled={false}`, `clusterUpdateIntervalMs={0}`.

## 8. Viewport

Dump `region`, `regionToBBox` output, `clusterZoomFromRegion`, and native `Viewport`. Check dateline (`west > east` or not), `longitudeDelta >= 40`, zero layout size. Canonical detail: [algo.md](algo.md). Remember: `edgePadding` does not drive the query bbox.

## 9. Algorithm

Duplicate coords, boundary radius, `minPoints`, invalid lat/lng, packed index vs user id. C++ tests in `ClusterEngineCore.test.cpp` are the regression home for engine membership.

## 10–11. Test and measure

[contributing.md](contributing.md), [performance.md](performance.md). A fix without a test is a recurring GitHub issue. Performance regressions: baseline + before/after on the same workload (canonical workflow).

## Native crashes

This engine throws C++ exceptions to JS for bad buffers and queries-before-build. A true native abort is more often RN Maps, Nitro load, ABI mismatch, or **concurrent build/query on one engine** than `nth_element`. Capture tombstone/lldb **and** Metro JS logs before changing the KD-tree.

Exact query-before-build string: [architecture.md](architecture.md).

---

## Platform deltas

Shared engine is C++ on both platforms ([architecture.md](architecture.md)). Install: [setup.md](setup.md).

### Map provider asymmetry ("iOS fine / Android slow")

Typical defaults:

- **iOS** → Apple Maps (`react-native-maps` default on iOS)
- **Android** → Google Maps (API key required)

```text
"iOS is smooth, Android is slow"
does NOT immediately imply an Android clustering-engine problem.
```

Control experiments:

1. Same `n`, same region, same clustering props, **release** builds on **real devices**.
2. Isolate the map provider where practical. Compat `MapView` forwards RN Maps props (`...restProps`), so on iOS try `provider={PROVIDER_GOOGLE}` when Google Maps is configured — comparing Apple vs Google on the **same** OS isolates annotation cost from `ClusterEngineCore`.
3. Headless `getClustersFromRegion` loop vs full `MapView` pan ([performance.md](performance.md)).

```text
Do not use emulator/simulator map FPS as final performance evidence.
```

Blank map vs slow map: blank is almost always the API key ([setup.md](setup.md)); slow with tiles visible is usually annotation/`k`/React, not a missing key.

### iOS-only behaviour in JS

`animationEnabled` (default `true`) runs `LayoutAnimation.configureNext` on **iOS** when the settled cluster layout signature changes (`compat/MapView.tsx`). Android ignores that branch (`Platform.OS === 'ios'`).

Cluster **fade-in** via Reanimated `useAnimatedProps` on marker `opacity` runs on both platforms (`ClusterMarker.tsx`). Comments there: animating the inner `<View>` does nothing while `tracksViewChanges={false}` because RN Maps snapshots a bitmap; only native `opacity` is live.

Threading: `buildAsync` on Nitro async pool; `getClusters` sync JSI on JS; annotations on main inside RN Maps. No library-owned GCD queues. Engine concurrency: [architecture.md](architecture.md).

Simulator is enough for Nitro load / membership / JS cadence. Frame timing differs on device. CI iOS builds the example for Simulator; it does not measure FPS.

Debug vs Release iOS engine timings: [performance.md](performance.md).

iOS crash / load checks first: missing `pod install`, Old Architecture, query-before-`isBuilt` (JS exception, not EXC_BAD_ACCESS), `LayoutAnimation` jank during rapid zoom (not an engine crash).

### Android-sensitive behaviour in JS

- Compat `fitToCoordinates` waits for `onLayout` with positive width/height to avoid RN Maps "Map size can't be 0" (`layoutReady`).
- `LayoutAnimation` cluster implode/explode is iOS-only. Android relies on Reanimated marker opacity + annotation add/remove.
- `tracksViewChanges={false}` (default) is the right default on both; leaving it `true` is especially expensive on Google Maps.

Threading same as iOS. No library-owned `Executor` for clustering.

Android crash / load checks first: New Architecture off (CMake may still build; Nitro will not run HybridObject), prefab without `.so`, missing ABI `.so`, query before build → JS exception not JNI abort. ProGuard/R8: this package does not ship consumer ProGuard rules of its own; Nitro/RN Maps rules still apply. Do not invent keep rules without a minified repro.

A 20 FPS pan with 20k points is usually Google Maps marker add/remove plus React commit, not the KD-tree ([performance.md](performance.md)).
