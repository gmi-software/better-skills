# Clustering algorithm & viewport

Derived from `package/cpp/ClusterEngineCore.hpp`, `package/cpp/GeoUtils.hpp`, `package/src/engine/geometry.ts`, `package/src/compat/throttleRegionSync.ts`, `package/src/compat/MapView.tsx`.

This is a supercluster-faithful port (kdbush-style KD-tree + zoom hierarchy), not a DBSCAN/grid-only clusterer. Aggregation reducers: [aggregation.md](aggregation.md). Architecture / copies: [architecture.md](architecture.md).

## Pieces

| Piece | Role |
| --- | --- |
| Web Mercator `lngToX` / `latToY` | Project into `[0, extent)` (default extent 512). Latitude clamped to `±85.05`, longitude to `±180`. |
| `KDTree` | Static 2D tree: permutation of ids, `std::nth_element` on alternating axes until `(right-left) <= nodeSize` (default 64). |
| Zoom hierarchy | For `z = maxZoom … minZoom`, cluster `current` into `next` using radius `radius / zoomScale(z, extent)`. |
| Result trees | One KD-tree per stored zoom over `_clustersByZoom[z]`, used by `getClusters`. |
| Parent/child graph | `_childrenByParent` / `_nodeById` for `getChildren`, `getLeaves`, `getClusterExpansionZoom`. |

`zoomScale(z, extent) = 2^z * extent / 256`. Larger `z` → smaller world-radius → tighter groups.

Defaults (`DEFAULT_SUPERCLUSTER_OPTIONS` / engine config): `radius 40`, `minZoom 1`, `maxZoom 20`, `minPoints 2`, `extent 512`, `nodeSize 64`. Compat `MapView` overrides radius to `~6%` of window width.

## Build pass (per zoom)

From `ClusterEngineCore::build`:

1. Seed `current` with one non-cluster node per valid point (`count = 1`, `id` = packed index, `zoom = maxZoom + 1`). The `maxZoom+1` layer is **not** stored in `_clustersByZoom`. Seed order follows **ingest / `_points` array order**.
2. For each `z` from `maxZoom` down to `minZoom`:
   - Build a local KD-tree over `current` (used only for `within` neighbourhood queries — **not** for walk order).
   - Walk `current` in **array order** (`for (size_t i = 0; i < current.size(); i++)`). Skip if `zoom <= z` (already processed this level).
   - `tree.within(x, y, r)` for neighbours.
   - If summed `count` of origin + unprocessed neighbours `>= minPoints` **and** at least one neighbour contributes, create a cluster at the **count-weighted** centroid, link children, mark those neighbours processed.
   - Else the origin survives; neighbours that were "mergeable" but below `minPoints` are marked processed and also survive individually.
3. Store `_clustersByZoom[z]` and a result KD-tree (result tree is what `getClusters` range-queries).

`clusteringEnabled == false` skips the hierarchy; `getClusters` then linear-filters `_points` against the geographic viewport (including antimeridian `west > east`).

Invalid coordinates (`!isfinite`) are skipped at ingest and never enter `_points`. `pointCount` is valid points only.

## Query

`getClusters(viewport)`:

1. `z = floor(viewport.zoom)` clamped to `[minZoom, maxZoom]`.
2. Convert north/south to Y (Y grows southward) and west/east to X.
3. If `west <= east`, one `tree.range`. If `west > east`, two ranges: `[west, 180]` and `[-180, east]`.
4. Return copies of the matching nodes.

JS `Supercluster.getClustersFromRegion` computes zoom via `clusterZoomFromRegion` (geo-viewport style using **both** map width and height; `longitudeDelta >= 40` → `minZoom`) and bbox via `regionToBBox`.

## Expansion

`getClusterExpansionZoom` mirrors supercluster: start at the cluster's origin zoom, walk while the node has exactly one child, return the zoom at which it splits (capped by walking `<= maxZoom`).

`getLeaves(id, limit, offset)` DFS via a stack; `limit <= 0` means unlimited (`Supercluster.getAllLeaves` uses `limit = 0`). Compat cluster press calls `getAllLeaves` — cost scales with cluster size, on the JS thread, synchronously.

## Complexity (from the implementation)

Let `n` = valid points, `Z = maxZoom - minZoom + 1` (default 20), `k` = nodes returned by a query, `B = nodeSize` (64).

This is a **2D** kd-tree (alternating axes, `nth_element` partitions). Classic 2D range-query cost is **not** `O(log n + k)`.

| Operation | Typical | Worst in this code |
| --- | --- | --- |
| KD-tree build | `O(n log n)` `nth_element` partitions until buckets ≤ B | Degenerate coordinates still partition; leaf scan is `O(B)` |
| `range` / `within` | `O(√n + k)` for a 2D range/neighbourhood style query | `O(n)` when the query covers the whole tree or leaves scan everything |
| Full `build()` | `O(Z · n_z log n_z)` with `n_z` shrinking as clusters form | If nothing merges, `n_z ≈ n` at every zoom → `O(Z · n log n)` plus `within` that can scan `O(n)` neighbours on a dense zoom |
| `getClusters` | `O(√n_z + k)` plus `O(k)` `toFeature` | World bbox at a zoom with many unclustered nodes → large `k` |
| `getLeaves` unlimited | `O(leaves)` | A top-level cluster of all `n` points |
| Memory | `O(n)` points + trees/arrays per zoom | `_clustersByZoom` holds a vector **per zoom**; no-merge case ≈ `O(Z · n)` nodes plus one result tree per zoom |

`memorySize()` sums capacities of `_points`, result trees, per-zoom node vectors, `_nodeById`, `_childrenByParent`, and reducer vectors. Jest does not cover it; C++ `testMemorySizeReflectsNativeAllocations` does.

**Determinism:** same input + options + viewport → same ids/counts (integer zoom). Build walks `current` in **array/ingest order**; the KD-tree answers neighbour queries only. Do not assert Mapbox supercluster byte-identical cluster ids unless you have a pinned compatibility suite — this is a port, not a clone.

## What changes cost

| Knob | Effect |
| --- | --- |
| Marker count `n` | Build ≈ linear-log in `n` per zoom; native memory ≈ linear in `n` (and `Z`) |
| `radius` | Larger radius → more merging, fewer nodes at low zoom, cheaper low-zoom queries, heavier `within` neighbourhoods during build |
| `minPoints` | Higher → fewer clusters, more leaves at a given zoom |
| `minZoom`/`maxZoom` | Wider range → more zoom passes (`Z`) |
| `nodeSize` | Larger leaves → faster build, slower queries (linear scan in the leaf) |
| `extent` | Scales projection and `zoomScale`; keep 512 unless matching a known supercluster setup |
| Zoom level | Low zoom: few large clusters (`k` small). High zoom: many leaves (`k` large) → JSI + marker mount dominate, not `build` |
| Viewport | Query cost follows `k`, not `n`. Compat bbox is 4× the visible area, so `k` is larger than the strictly visible set |
| Geographic distribution | Tight clumps merge early. A uniform grid (as in `bench.cpp`) merges less than a city dump at the same radius |
| `clusterProperties` | Extra `values` vectors on every node; v2 buffer `+ 8` bytes per property per point |

## Edge cases the code actually handles

- **NaN / non-finite coords:** dropped at ingest; `pointIndex` on survivors stays the packed index (`testPointIndexPreservesOriginalInputIndex`).
- **NaN zoom / non-positive deltas / zero map size:** JS `getClustersFromRegion` returns `[]` (`isValidRegion`, `width/height <= 0`).
- **Empty dataset:** `build()` sets `_built` and `getClusters` returns empty.
- **Duplicate coordinates:** same `x`/`y`; they merge when `minPoints` is met.
- **Antimeridian:** C++ splits only if `west > east`. JS `regionToBBox` never sets that (see below).
- **Invalid buffer:** `setPointsFromBuffer` returns false; HybridObject throws. State is reset.
- **Query before build:** `std::runtime_error` with the `isBuilt` message.

## Id collision when invalid points are dropped

`_nextClusterId` starts at `_points.size()` (valid count), while packed ids are original indices. If an interior point is invalid, a later valid point can keep id `2` while the first cluster is also assigned id `2`, and `_nodeById[2]` is overwritten. All-valid datasets (`0..n-1` ids, clusters start at `n`) do not hit this. Treat mixed valid/invalid inputs as an engine correctness hazard when changing id assignment.

---

## Region → bbox (JS)

`regionToBBox`:

```
west  = longitude - longitudeDelta
east  = longitude + longitudeDelta
south = latitude  - latitudeDelta
north = latitude  + latitudeDelta
```

`react-native-maps` `Region` deltas are the **visible** span, so the visible rectangle is `center ± delta/2`. This function uses `± delta`, i.e. **twice the visible width and height** (4× area). Tests lock that formula. Comments: react-native-clusterer parity.

Effects:

- `getClusters` returns nodes that are still off-screen. Compat **renders them** as Markers.
- Edge-of-viewport membership looks "early" (clusters appear before they enter the screen) rather than late.
- If an app builds its own bbox with `± delta/2` and calls `Supercluster.getClusters` directly, results will not match compat MapView.

Invalid region (non-finite or `delta <= 0`) → world bbox `[-180,-90,180,90]` from `regionToBBox`, but `getClustersFromRegion` returns `[]` without querying when `isValidRegion` fails or map size is 0.

### `edgePadding` does not drive the clustering query bbox

`edgePadding` appears on `ClusteredMapViewProps` (fit / map UI). Clustering queries use `regionToBBox` + `clusterZoomFromRegion` (or an explicit headless `Viewport`). Setting `edgePadding` to zero does **not** shrink the engine bbox to the strictly visible set. Do not invent edgePadding-driven query clipping.

## Zoom

`clusterZoomFromRegion`:

1. Invalid region → `minZoom`.
2. `longitudeDelta >= 40` → `minZoom` (clusterer/geo-viewport shortcut).
3. Else `bboxToZoom`: project the bbox at `maxZoom+1`, compare pixel size to `mapDimensions`, `floor`, clamp to `[minZoom, maxZoom]`. Non-finite → `minZoom`.

C++ then does `z = floor(viewport.zoom)` and clamps again. Fractional zoom uses the **lower** integer cluster level until the next integer.

`extent` must match between JS zoom math and native options (default 512). Mismatch = wrong `z` vs trees that were built for a different scale.

Zero `width`/`height` → `minZoom` / empty `getClustersFromRegion`. Compat seeds dimensions from window size, then `onLayout`.

## When clusters recompute

Compat:

- `onRegionChange` → `scheduleThrottledRegionSync` → `setCurrentRegion`.
- Default `intervalMs = 100`, leading + trailing edge. `intervalMs <= 0` skips in-gesture sync; `onRegionChangeComplete` still `flushThrottledRegionSync`.
- `useClusterer` recomputes when region fields or dimensions change.

Rapid pan/zoom: expect ~10 JS queries/s at default throttle. Lowering the interval without a profile increases JSI + commit load. Raising it makes clusters lag the camera.

## Dateline / antimeridian

C++ `getClusters` splits the X range **only when `west > east`**.

`regionToBBox` never wraps: a camera at `longitude = 179` with `longitudeDelta = 10` yields `east = 189`. `lngToX` **clamps** longitude to `±180`, so east becomes 180 and the eastern wrap (`-180 … -171`) is **not** queried. Points on the other side of 180° can be missing.

This is a real correctness gap for Pacific-centered maps. Workarounds today: keep the region from straddling 180°, or call the native engine with an explicit `Viewport` where `west > east`. Changing `regionToBBox` is a behaviour break vs clusterer parity — needs tests on both wrap and non-wrap cases.

## Latitude / longitude bounds

Ingest: non-finite skipped; finite values clamped to `±85.05` lat, `±180` lng before projection. Mercator `MAX_LATITUDE` in GeoUtils is `85.05112878`; clamp uses `85.05`.

Points exactly on the clamp boundary are valid. Coordinates outside the clamp are moved, so a marker at lat 89 clusters at 85.05.

## Extreme zoom

- Below `minZoom`: stored trees start at `minZoom`; queries clamp up.
- Above `maxZoom`: clamp down; `spiralEnabled` may spiderfy instead of clustering further.
- `maxZoom+1` exists only as the clustering **input** layer, never as a queryable `_clustersByZoom` entry.

## Empty / tiny viewports

`getClustersFromRegion` → `[]` when not loaded, invalid region, or non-positive map size. Compat waits for layout before `fitToCoordinates` (Android zero-size crash class).

World-scale `longitudeDelta >= 40` forces `minZoom` clusters (few large bubbles), which is usually what you want for a globe view.

## Padding vs "wrong at the edge"

If clusters **pop in late** at the visible edge: confirm the caller isn't using a tighter bbox than `regionToBBox`; confirm `z` matches (`floor`, `longitudeDelta >= 40`, `extent`). Do not blame missing `edgePadding` on the query path.

If clusters **show outside** the map: expected with 4× bbox + rendering all results.

If clusters **belong to the wrong zoom** while pinch-zooming: throttle + integer zoom — intermediate frames use the last flushed region and `floor(zoom)`.
