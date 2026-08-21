# React integration

`useClusterer` rebuilds the native index when `data` **identity** (or option primitives) change. Compat `MapView` derives `data` from `children`. Most flicker and "the map rebuilds every time I setState" reports start here.

Architecture triggers: [architecture.md](architecture.md). Performance layers: [performance.md](performance.md).

## Dataset identity

```tsx
// New array every render → destroy + loadAsync every render
<MapView>{points.map((p) => (
  <Marker key={p.id} coordinate={p} />
))}</MapView>
```

`React.Children.toArray(children)` depends on `children`. A parent `setState` (sheet, filter chip, GPS) passes a new element tree, `markerFeatures` is a new array, the effect in `useClusterer` runs.

Better: keep **points** and **children** reference-stable across unrelated renders.

```tsx
const points = useMemo(() => fetchPoints(), [])
const markers = useMemo(
  () => points.map((p) => (
    <Marker key={p.id} coordinate={{ latitude: p.latitude, longitude: p.longitude }} />
  )),
  [points]
)
return <MapView initialRegion={REGION}>{markers}</MapView>
```

`example/App.tsx` memoizes `points` but still maps Markers inline. That is fine only while `App` does not re-render. The moment you add UI state beside the map, memoize the Marker list or switch to `useClusterer` with a memoized GeoJSON array.

For headless:

```tsx
const data = useMemo(() => points.map(toFeature), [points])
const [clusters] = useClusterer(data, mapDimensions, region, options)
```

`options` should be memoized or passed as primitives. The hook already depends on `radius`, `minZoom`, … individually so an inline `{ radius: 40 }` object does **not** rebuild by itself — but a new `data` array does. `clusterProperties` array identity / `clusterPropertiesKey` also rebuilds ([aggregation.md](aggregation.md)).

## When memoization helps

| Memoize | When |
| --- | --- |
| GeoJSON / Marker children | Parent re-renders for reasons other than the point set |
| `clustererOptions` in MapView | Already done internally from primitive props |
| `renderCluster` | It is in the marker `useMemo` dep list; an inline function remakes every cluster element |
| `renderItem` on `Clusterer` | Same — `clusters.map(renderItem)` |
| `onClusterPress` | `handleClusterPress` depends on it; module `noop` is the default |

`stabilizeClusterFeatures` is already applied inside `useClusterer`. Calling it again on the same array is wasted work.

## Leaf stabilization keys (`stabilizeClusters.ts`)

Leaf identity for reuse is:

```ts
properties.id ?? feature.id ?? ''
// key = `p:${id}:${latitude}:${longitude}`
```

`markerToGeoJSONFeature` (compat MapView path):

- Spreads Marker props (except `coordinate` / `children`) into `properties`, including a Marker `id` prop when present.
- Sets `properties.index` to the child index.
- Does **not** set GeoJSON `feature.id`.

Therefore:

```text
Compatibility markers without an explicit marker `id` may stabilize based on
coordinates rather than the original marker index.
```

(Empty `id` → key is effectively `p::lat:lng`. Index is stored on properties but is **not** part of the stabilize key.)

Why this matters:

- **React reconciliation** — object identity reuse only kicks in when the stabilize key matches; coordinate-only keys collide if two markers share a position without ids.
- **Rerenders** — moving a marker without a stable `id` looks like a different leaf; previous object identity is not reused.
- **Remounts** — React keys on compat leaves still use `marker-${index}` when cloning children; stabilize affects the GeoJSON/`useClusterer` array identity, not those Marker keys. Unstable point lists still remount annotations.

`computeClusterLayoutSignature` (LayoutAnimation gating) **does** use `properties.index` for points — different from stabilize. Do not conflate the two.

App guidance: give Markers a stable `id` (or GeoJSON `feature.id` / `properties.id` for headless data) when positions can duplicate or reorder.

## When memoization makes things worse

- Wrapping `getClustersFromRegion` in extra `useMemo` that still runs on every region field change (the hook already does that).
- Deep-cloning features "for immutability" — breaks stabilization keys' object reuse and forces Marker remounts.
- `useMemo` on a mapped Marker list whose `coordinate` object is still new every time **and** you pass that list as `data` via a second conversion — you paid twice.
- Memoizing `currentRegion` while also copying it in `onRegionChange` without throttle — the copy is required; the throttle in MapView is the actual lever.

`React.memo(Marker)` does not stop compat from `cloneElement` when the parent MapView re-renders with a new `clusters` array. Keys and stabilization matter more than wrapping RN Maps `Marker`.

## State vs derived

| Put in React state | Keep derived |
| --- | --- |
| Map `region` you actually control | `clusters` — already derived in `useClusterer` |
| Selection id (`selectedClusterId`) | Zoom integer — `clusterZoomFromRegion` |
| UI chrome (filters, sheets) | Packed buffers — recreate on dataset change only |

Feeding `onRegionChange` into a `setPoints`-related state update is the classic per-frame rebuild. Region state may update (compat already throttles); **marker arrays must not**.

## Flicker

Causes in this codebase:

1. New `cluster_id`s on zoom → unmount/remount annotations (`ClusterMarker` comment).
2. Fade-out stacking during gesture — mitigated by `effectiveFadeOut = 0` while `isMapMoving`.
3. Unstable Marker `key`s / child indexes when list order changes (`properties.index` is the child index).
4. `tracksViewChanges={true}` redrawing bitmaps.
5. Custom `renderCluster` returning a new component type every call.

Mitigations already in tree: `stabilizeClusterFeatures`, layout signature gating iOS `LayoutAnimation`, Reanimated native opacity, `tracksViewChanges` default false. App-side: stable point ids, stable children, don't rebuild `data` on pan.

## `cluster={false}`

`isMarker` returns false when `cluster={false}`. Those elements render as `otherChildren` and never enter the engine. Use for the user location pin so GPS updates do not rebuild the index — **if** the clustered children stay referentially stable.

If the parent remaps **all** markers including clustered ones every GPS tick, `cluster={false}` does not save you.

## Callbacks and refs

- `superClusterRef` receives the hook's instance (or a placeholder Supercluster before load — queries on the placeholder throw / `isLoaded` is false).
- `mapRef` / `forwardRef` attach the underlying RN Maps view.
- Cluster press with `preserveClusterPressBehavior` skips `fitToCoordinates`.
- `fitToCoordinates` is skipped until layout and `onMapReady` (Android zero-size guard).
