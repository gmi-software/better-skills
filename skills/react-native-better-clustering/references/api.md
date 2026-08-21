# API reference

Public surface only. Signatures from `package/src`. Do not invent props.

Deep aggregation (reducers, packing, MapView denial): [aggregation.md](aggregation.md). Rendering identity: [rendering.md](rendering.md). Migration: [migration.md](migration.md). Thread safety: [architecture.md](architecture.md).

## Drop-in MapView (default)

```tsx
import MapView from 'react-native-better-clustering'
import { Marker } from 'react-native-maps'

<MapView
  style={{ flex: 1 }}
  initialRegion={{
    latitude: 52.23,
    longitude: 21.01,
    latitudeDelta: 0.35,
    longitudeDelta: 0.35,
  }}
  radius={56}
  minPoints={2}
  clusterColor="#0F52FF"
  clusterTextColor="#FFFFFF"
  spiralEnabled
  animationEnabled
  clusterUpdateIntervalMs={100}
  onClusterPress={(cluster, markers) => {
    cluster.properties.point_count
    markers.length
  }}
>
  {markers}
  <Marker cluster={false} coordinate={{ latitude: 52.23, longitude: 21.01 }} />
</MapView>
```

`markers` should be a stable element list ([rendering.md](rendering.md)). Migration from `react-native-map-clustering` is this import plus the same `Marker` children (ADR 0001).

`/compat` is the same module as the root export.

### `clusterProperties` is NOT a MapView prop

```text
`clusterProperties` is supported by the lower-level clustering APIs,
but it is NOT a prop accepted by the root MapView compatibility API.
```

Do **not** write `<MapView clusterProperties={...} />` — `compat/MapView.tsx` never reads that prop; `clustererOptions` only forwards `radius`, `maxZoom`, `minZoom`, `minPoints`, `extent`, `nodeSize`.

Use aggregation via `/engine` (`Supercluster` options) or `/hooks` (`useClusterer` options). Overview below; full detail: [aggregation.md](aggregation.md).

### ClusteredMapViewProps extras (on top of RN Maps `MapViewProps`)

`radius`, `maxZoom`, `minZoom`, `minPoints`, `extent`, `nodeSize`, `edgePadding`, `onClusterPress`, `onRegionChangeComplete` (adds `markers` as third arg), `onMarkersChange`, `preserveClusterPressBehavior`, `clusteringEnabled`, `clusterColor`, `clusterTextColor`, `clusterFontFamily`, `superClusterRef`, `mapRef`, `spiralEnabled`, `spiderLineColor`, `renderCluster`, `selectedClusterId`, `selectedClusterColor`, `animationEnabled`, `layoutAnimationConf`, `clusterFadeInDuration`, `tracksViewChanges`, `width`, `height`, `clusterUpdateIntervalMs`.

RN Maps props (including `provider`) are forwarded via `...restProps`.

Defaults: see `compat/MapView.tsx`. Engine-only defaults (`radius: 40`) apply to `/engine` and `/hooks`, not to MapView radius.

`edgePadding` is a MapView / fit-related prop. It does **not** drive the clustering query bbox — that comes from `regionToBBox` / viewport math ([algo.md](algo.md)).

### Measuring visible features (`k`)

`onMarkersChange` receives the same stabilized `clusters` array the map renders — use `markers.length` as `k` ([performance.md](performance.md)).

`onRegionChangeComplete` on RN Maps is omitted from the extends and re-declared with the extra `markers` argument.

## Custom cluster bubble

```tsx
import MapView, { type RenderClusterProps } from 'react-native-better-clustering'
import { Marker } from 'react-native-maps'
import { useCallback } from 'react'

const renderCluster = useCallback((cluster: RenderClusterProps) => {
  const [longitude, latitude] = cluster.geometry.coordinates
  return (
    <Marker
      coordinate={{ latitude, longitude }}
      onPress={cluster.onPress}
      tracksViewChanges={false}
    >
      {/* bubble */}
    </Marker>
  )
}, [])

<MapView renderCluster={renderCluster}>{markers}</MapView>
```

`RenderClusterProps` is `ClusterFeature` plus `onPress`, `clusterColor`, `clusterTextColor`, `tracksViewChanges`. Custom render skips default fade (`clusterFadeInDuration` ignored).

## useClusterer (you own MapView)

```tsx
import MapView, { Marker } from 'react-native-maps'
import { useClusterer } from 'react-native-better-clustering/hooks'
import { isClusterFeature } from 'react-native-better-clustering/geojson'

const [clusters, supercluster] = useClusterer(data, mapDimensions, region, {
  radius: 40,
  minPoints: 2,
})

// clusters: PointFeature | ClusterFeature
// supercluster.getClusterExpansionZoom(id)
```

`data` is `PointFeature[]`. Empty until loaded. Returns `[clusters, supercluster]` — not a third
`isLoaded` value. Use `supercluster.isLoaded` or empty `clusters` rather than querying blindly.

## Clusterer component

```tsx
import { Clusterer } from 'react-native-better-clustering/clusterer'

<Clusterer
  data={data}
  region={region}
  mapDimensions={mapDimensions}
  renderItem={(feature) => <Marker ... />}
/>
```

Undocumented subpath (ADR 0001); still exported. `renderItem` belongs in `useCallback`.

## Supercluster / createClusterEngine

```tsx
import {
  Supercluster,
  createClusterEngine,
} from 'react-native-better-clustering/engine'
import { packPoints } from 'react-native-better-clustering/utils'

const clusterer = new Supercluster({ radius: 40, minZoom: 1, maxZoom: 20 })
await clusterer.loadAsync(features)
const visible = clusterer.getClustersFromRegion(region, { width, height })
clusterer.destroy()

const engine = createClusterEngine()
engine.setOptions({
  radius: 40,
  minPoints: 2,
  minZoom: 1,
  maxZoom: 20,
  extent: 512,
  nodeSize: 64,
  reducers: [],
})
engine.setPoints(packPoints(coordinates).buffer)
await engine.buildAsync()
const nodes = engine.getClusters({
  north, south, east, west, zoom,
})
```

After `build` / `buildAsync`, `engine.isBuilt` is `true` and `engine.pointCount` is the number of
valid loaded points. Query before that throws.

`Supercluster` query helpers (throw if `engine` is still null; `getClustersFromRegion` returns `[]`
while `!isLoaded`):

```ts
clusterer.getChildren(id)
clusterer.getLeaves(id, 10, 0)      // default limit 10
clusterer.getAllLeaves(id)          // limit 0 = unlimited; sync on the JS thread
clusterer.getClusterExpansionZoom(id)
clusterer.getClusterExpansionRegion(id)
clusterer.isLoaded                  // engine?.isBuilt ?? false
```

`getAllLeaves` is unbounded. Compat cluster press uses it — a cluster of tens of thousands of
leaves will hitch on tap.

Lifecycle: `setOptions` → `setPoints` → `build`/`buildAsync` → query. `load`/`loadAsync` once per `Supercluster` instance.

Do not run concurrent `buildAsync` and queries on the same `createClusterEngine()` instance ([architecture.md](architecture.md)). For uninterrupted querying during a rebuild, use the dual-engine swap pattern there.

### Aggregation overview

`clusterProperties` (JS wrapper / `useClusterer` options — **not** root MapView): `{ source, key?, reduce: 'sum' | 'min' | 'max' }[]`. Arbitrary JS reducers are not supported.

```tsx
const [clusters] = useClusterer(data, dimensions, region, {
  clusterProperties: [
    { source: 'price', reduce: 'sum' },
    { source: 'price', key: 'maxPrice', reduce: 'max' },
  ],
})
// cluster.properties.price / maxPrice on cluster features
```

`source` is a dot path into leaf `properties`. `key` defaults to the last path segment. Values must be numeric. Keep the options array stable or memoize it. Full pipeline: [aggregation.md](aggregation.md).

## GeoJSON helper

```tsx
import { coordsToGeoJSONFeature, isClusterFeature } from 'react-native-better-clustering/geojson'

const feature = coordsToGeoJSONFeature(
  { latitude: 52.23, longitude: 21.01 },
  { id: 'p1' }
)
```

## Types

- `ClusterFeature.properties`: `cluster: true`, `cluster_id`, `point_count`, `point_count_abbreviated`, `getExpansionRegion()`.
- `EngineClusterNode`: `id`, `latitude`, `longitude`, `count`, `isCluster`, `parentId`, `pointIndex`, `values`.
- Leaf `pointIndex` is the **pack index** (array index into the loaded feature list).

## Viewport handling in-app

Prefer compat `MapView` region plumbing (throttled). If you drive `useClusterer` yourself, put **throttled** region in state (`clusterUpdateIntervalMs` equivalent) and keep `data` out of that setState.

## TypeScript

Package `react-native` condition points at `src/index.ts`; `types` at `lib/index.d.ts`. Subpaths are listed in `exports`. There is no `./types` export.
