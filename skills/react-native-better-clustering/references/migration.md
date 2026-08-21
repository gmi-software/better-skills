# Migration

Grounded in library `README.md`, `docs/docs/compatibility.md`, and ADR 0001. Do not invent prop parity beyond what those sources and `ClusteredMapViewProps` list.

Setup after swap: [setup.md](setup.md). API surface: [api.md](api.md). Aggregation limits: [aggregation.md](aggregation.md).

## From `react-native-map-clustering`

One-line import swap (documented migration):

```diff
- import MapView from 'react-native-map-clustering'
+ import MapView from 'react-native-better-clustering'
  import { Marker } from 'react-native-maps'
```

`/compat` is the same module as the root export.

### What you can infer from source

- Root export **is** the clustered `MapView` (ADR 0001).
- `Marker` children and many clustering props continue to work through `ClusteredMapViewProps` + forwarded RN Maps props (`...restProps`).
- Documented fixes over the old library (NaN zoom guard, Android zero-size `fitToCoordinates`, `maxZoom` / `spiralEnabled`, stable cluster references, per-marker `cluster={false}`) are listed in README / compatibility docs — verify behaviour in your app, do not treat the table as a test suite.

### What you must not invent

- Exact 1:1 parity with every historical `react-native-map-clustering` prop or quirk unless it appears on `ClusteredMapViewProps` or is forwarded via RN Maps `MapViewProps`.
- That `clusterProperties` works on root `MapView` — it does **not** ([aggregation.md](aggregation.md)).
- Performance guarantees ("10k+ without bridge jank") — measure ([performance.md](performance.md)).

### Setup after swap

New Architecture + Nitro peers + Reanimated/Worklets + maps key. [setup.md](setup.md).

## From `react-native-clusterer`

Compatibility docs map subpaths:

| react-native-clusterer | This package |
| --- | --- |
| `useClusterer` | `/hooks` |
| `Supercluster` | `/engine` |
| `isClusterFeature` | `/geojson` |

Extra vs clusterer (documented): declarative `clusterProperties` aggregation on `/engine` / `/hooks` (C++ `sum` \| `min` \| `max` only — not arbitrary JS reducers).

`regionToBBox` padding matches react-native-clusterer parity (4× visible area) — [algo.md](algo.md).

## Cannot be inferred without reading your app

- Whether your custom map stack expects half-delta bboxes
- Whether you relied on JS-supercluster-only APIs
- Whether Google vs Apple Maps was the real performance difference ([debugging.md](debugging.md))

When unsure: open `package/src/compat/MapView.tsx` and `package/src/engine/types.ts`, then write a small headless `loadAsync` + `getClustersFromRegion` fixture before changing production UI.
