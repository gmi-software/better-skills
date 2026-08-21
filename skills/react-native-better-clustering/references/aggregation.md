# Aggregation (`clusterProperties`)

Declarative numeric cluster properties. Sources: `package/src/utils/clusterProperties.ts`, `packPoints.ts`, `Supercluster` / `useClusterer` options, `ReducerKind` / C++ reducers in `GeoUtils.hpp` / `ClusterEngineCore`.

API recipes: [api.md](api.md). Build/query algorithm: [algo.md](algo.md). Copies and v2 buffer layout: [architecture.md](architecture.md).

## Entry points

```text
`clusterProperties` is supported by the lower-level clustering APIs,
but it is NOT a prop accepted by the root MapView compatibility API.
```

| Entry | `clusterProperties` |
| --- | --- |
| `Supercluster` / `createClusterEngine` (`/engine`) | Yes — via `SuperclusterOptions` / native `reducers` |
| `useClusterer` / `Clusterer` (`/hooks`, `/clusterer`) | Yes — options object |
| Root `MapView` / `/compat` | **No** — `clustererOptions` only passes `radius`, `maxZoom`, `minZoom`, `minPoints`, `extent`, `nodeSize` |

Do **not** write `<MapView clusterProperties={...} />`. Compat never reads that prop; TypeScript bypass does not enable it.

## Shape (sum \| min \| max only)

```ts
{ source: string; key?: string; reduce: 'sum' | 'min' | 'max' }[]
```

- `source` — dot path into leaf `properties` (numeric values only).
- `key` — property name written onto cluster features; defaults to the **last segment** of `source`.
- `reduce` — **only** `'sum' | 'min' | 'max'`. No `avg`, `count`, `median`, map/reduce callbacks, or arbitrary JS reducers.

JS Mapbox supercluster allows arbitrary map/reduce functions. This port only runs **declarative** reducers in C++ (`ReducerKind`) so build does not hop to JS.

```tsx
const [clusters] = useClusterer(data, dimensions, region, {
  clusterProperties: [
    { source: 'price', reduce: 'sum' },           // → properties.price
    { source: 'price', key: 'maxPrice', reduce: 'max' },
  ],
})
// cluster.properties.price / maxPrice on cluster features
```

Keep the `clusterProperties` array **stable or memoized** — option identity / `clusterPropertiesKey` triggers a full `destroy` + `loadAsync` rebuild ([architecture.md](architecture.md), [rendering.md](rendering.md)).

Median (or other unsupported reducers) requires app-side logic or a new library design — not an unsupported option invent.

## Pipeline

```
leaf properties (numeric, via source path)
      ↓  JS extractGeoJSONAggregationValues (clusterProperties.ts)
packed float64 values in v2 buffer
      ↓  setPoints → PointData.values
C++ build-time reduction (sum | min | max per reducer)
      ↓  values on ClusterNode / EngineClusterNode
mapped back onto cluster GeoJSON properties by key
```

Reduction runs during **native hierarchy construction**, not on each JS query. Aggregation adds packed values and per-node `values` storage — extra cost on build and memory ([algo.md](algo.md)).

Non-numeric source values are not valid for native reducers; do not emulate an arbitrary reducer callback inside the native build path.

## Packing (v2 buffer)

`packPoints` little-endian layouts ([architecture.md](architecture.md)):

- **v1** (no aggregation): `uint32 count`, then per point `int32 index`, `float64 lat`, `float64 lng` (20-byte stride).
- **v2** (values present): magic `0x4E4D4332` (`PACK_POINTS_MAGIC_V2`), count, `numProps`, then per point the v1 fields plus `numProps` float64s.

Buffer size ≈ `12 + n*(20+8p)` for v2 with `p` properties. Invalid / malformed buffers: `setPointsFromBuffer` rejects; HybridObject throws. C++ coverage: `testBufferV2Aggregation`, `testInvalidBufferRejected`, `testPropertyAggregationSumMinMax`.

Headless `createClusterEngine` can take `reducers: []` on `setOptions` with values already packed; high-level callers use `clusterProperties` on `Supercluster` / `useClusterer` which extract + pack for them.
