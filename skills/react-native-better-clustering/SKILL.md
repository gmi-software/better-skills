---
name: react-native-better-clustering
description: >-
  Expert guide to react-native-better-clustering — a drop-in clustered MapView for
  react-native-maps backed by a C++ supercluster engine over Nitro/JSI. Use when
  installing, configuring, or debugging it; when clustering is slow, wrong, or
  flickering; when handling thousands of map markers; when migrating from
  react-native-map-clustering or react-native-clusterer; and when changing the
  library's TypeScript, C++, or Nitro specs. Also use before writing any performance
  claim about map clustering, pan, zoom, or marker frame rate.
license: MIT
metadata:
  package: react-native-better-clustering
  version: "1.0.0"
  commit: 7c7d659046a3d1bb8b7d4cb06a94f6e0d509862e
  verified: "2026-08-21"
  repository: https://github.com/gmi-software/react-native-better-clustering
  audience: library users and library contributors
  tags: react-native, clustering, maps, markers, geospatial, supercluster, nitro, jsi, cpp, performance, ios, android, expo
---

# react-native-better-clustering

Drop-in clustered `MapView` for `react-native-maps`. Clusters are computed in C++ via a Nitro
HybridObject; every visible bubble/leaf is still a React `react-native-maps` `<Marker>`.

**Source is truth.** Where the library README and the code disagree, follow the code.

Paths like `package/src/...` are relative to a **library checkout**, not this skills repo.

## Version verification

```text
Package:            react-native-better-clustering
Version:            1.0.0
Commit:             7c7d659046a3d1bb8b7d4cb06a94f6e0d509862e
Verification date:  2026-08-21
```

```bash
npm view react-native-better-clustering version
node -p "require('react-native-better-clustering/package.json').version"
```

If your version differs, re-read `node_modules/react-native-better-clustering/src/` before trusting
internals.

## When to use

- Installing / configuring clustering on a React Native map
- Migrating from `react-native-map-clustering` or `react-native-clusterer`
- Thousands of markers, pan/zoom jank, flicker, wrong membership
- Native crash or Nitro load failure involving this package
- Aggregating cluster values (`clusterProperties`)
- Changing the C++ engine, Nitro spec, or React layer
- Reviewing any performance claim about clustering / marker FPS

## When NOT to use

| Situation | Instead |
| --- | --- |
| Base map / tiles / camera / gestures | Load the `react-native-maps` skill |
| `react-native-better-maps` | Load that skill — different library, native clustering |
| Mapbox / MapLibre / `@rnmapbox/maps` | Those SDKs cluster internally |
| Non-geographic clustering | This engine is lon/lat Web Mercator only |

## Core architecture

1. **Compute is C++; drawing is React.** `ClusterEngineCore` builds the hierarchy; the default
   `MapView` mounts one RN Maps `<Marker>` per visible node.
2. **One HybridObject, not a map view.** Nitro autolinks `ClusterEngine` → `HybridClusterEngine`.
3. **Load copies; query converts.** `packPoints` → `setPoints` memcpy → sync `getClusters` that
   allocates one JS object per node.
4. **Rebuilds are all-or-nothing.** No incremental insert API; `data` identity change destroys
   and rebuilds.
5. **Region sync is throttled** (`clusterUpdateIntervalMs` default `100`).

Details: [architecture.md](references/architecture.md).

### Thread safety (CRITICAL)

```text
ClusterEngineCore is NOT thread-safe.
No mutex / lock / atomic protects build state.

Do not issue concurrent buildAsync / getClusters / getChildren / getLeaves / isBuilt
against the same engine instance.

Supercluster lifecycle gating is incidental protection only.
createClusterEngine() (headless) provides no such guarantee.
```

`buildAsync` moves work off the JS thread — that is **not** concurrent-query safety.
For continuous querying during a rebuild, build a second engine fully, then swap.
→ [architecture.md](references/architecture.md)

## API guidance

| Import | Surface |
| --- | --- |
| `react-native-better-clustering` | Drop-in clustered `MapView` |
| `.../hooks` | `useClusterer` — you own the `MapView` |
| `.../engine` | `Supercluster`, `createClusterEngine` — headless |
| `.../geojson` | Feature helpers |
| `.../utils` | `packPoints`, etc. |
| `.../clusterer` | `Clusterer` component |

**`clusterProperties` is NOT a root `MapView` prop.** Aggregation exists only on `/engine` and
`/hooks` (`sum` \| `min` \| `max` only). Surface: [api.md](references/api.md). Deep detail:
[aggregation.md](references/aggregation.md).

## Problem → reference routing

| Problem | Start here |
| --- | --- |
| Concurrent engine / headless threading | [architecture.md](references/architecture.md) |
| **Installation & setup** | [setup.md](references/setup.md) |
| Blank Android map | [setup.md](references/setup.md) |
| Basic usage / which API | [api.md](references/api.md) |
| Slow / "make it 2× faster" | [Canonical optimization](#canonical-optimization-workflow) → [performance.md](references/performance.md) |
| 10k+ markers / ~20 FPS pan | [performance.md](references/performance.md) |
| Marker re-renders / flicker | [rendering.md](references/rendering.md) |
| Wrong membership / viewport edge | [algo.md](references/algo.md) |
| **Aggregation (`clusterProperties`)** | [aggregation.md](references/aggregation.md) + [api.md](references/api.md) |
| **Migration** | [migration.md](references/migration.md) |
| **Regression / PR slower** | [performance.md](references/performance.md) |
| Debugging unknown | [debugging.md](references/debugging.md) |
| Platform iOS / Android | [setup.md](references/setup.md), [debugging.md](references/debugging.md) |
| Testing / contributing | [contributing.md](references/contributing.md) |

## Canonical optimization workflow

```text
1. Establish baseline
2. Define workload
3. Profile
4. Identify bottleneck
5. Form hypothesis
6. Smallest change
7. Benchmark
8. Compare before vs after
9. Add regression coverage
```

Vague "2× faster" → reframe first: point count, distribution, pan/zoom/load, platform, device,
debug vs release, metric, current baseline. Profiling: [performance.md](references/performance.md).

**Do not** rewrite the KD-tree without a profile, add memoization that does not stabilize
identity, or claim FPS without measuring release builds on a real device.

## Common mistakes

- Treating clustering FPS as engine FPS — visible RN Maps markers are usually the ceiling
- Concurrent `buildAsync` + query on one headless engine
- Passing `clusterProperties` to root `MapView`
- Claiming "zero-copy" / "60 FPS at 10k" — not supported by source
- Optimising without a baseline workload
- Assuming Jest covers C++ clustering (it mocks Nitro)

## Troubleshooting

1. Name the layer: compute / JSI / React commit / RN Maps annotations → [performance.md](references/performance.md)
2. Name the trigger: dataset identity, region event, settle, mount
3. Measure on the failing platform → [performance.md](references/performance.md)
4. Then fix → [debugging.md](references/debugging.md)

Decision tree and real error strings live in the debugging reference.

## Known limitations

| Limitation | Consequence |
| --- | --- |
| Rendering is RN Maps markers | Visible count, not point count, sets FPS ceiling |
| `ClusterEngineCore` not thread-safe | Serialize build/query per instance |
| No incremental updates | `data` identity change rebuilds everything |
| `clusterProperties` not on root MapView | Use `/hooks` or `/engine` |
| New Architecture + no Expo Go | RN 0.78+; needs a development build |
| No CI performance gate | Regressions need your own measurement |

## Accuracy

Label claims **SOURCE FACT** / **TEST FACT** / **BENCHMARK FACT** / **EXAMPLE FACT** / **INFERENCE**.
Banned as fact: "zero-copy", "zero-bridge", "no JS overhead", "10k markers at 60 FPS".

2D KD-tree range/`within` complexity is typically **O(√n + k)** (not O(log n + k)). Build walks
`current` in **array/ingest order**; the tree answers neighbour queries only.
