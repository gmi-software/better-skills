---
name: react-native-maps
description: >-
  Expert guide to react-native-maps — MapView for iOS and Android backed by MapKit
  and Google Maps through React Native native components (not Nitro). Use when
  working with MapView, Marker, Callout, Polygon, Polyline, Circle, Overlay,
  Heatmap, Geojson, camera, or region from the `react-native-maps` package; when
  diagnosing map performance, marker performance, provider differences, Android vs
  iOS behaviour, Expo map setup, clustering on top of react-native-maps, or
  migrating away from it; and when deciding whether a problem belongs to this
  library, a clustering layer, React rendering, or a native map alternative.
license: MIT
metadata:
  package: react-native-maps
  repository: https://github.com/react-native-maps/react-native-maps
  audience: library users and coding agents
  tags: react-native, maps, mapview, google-maps, mapkit, markers, clustering, expo, ios, android
---

# react-native-maps

React Native map view. JS/React API over **native map views** (MapKit / Google Maps).
Not a Nitro Modules library. Not a clustering library.

**Source is truth.** Verify props and methods against the installed `src/` before using them.

Paths like `src/...` are relative to a **react-native-maps checkout** (`node_modules/react-native-maps`), not this skills repo.

## Version verification

```text
Package:            react-native-maps
Version:            1.29.0
Commit:             863dc3c53aa17c0aac8c80415b91ed30d6a4f478
Verification date:  2026-08-21
```

```bash
npm view react-native-maps version
node -p "require('react-native-maps/package.json').version"
```

If the installed version differs, re-read `node_modules/react-native-maps/src/` before trusting internals.

## When to use

- `react-native-maps`, `MapView`, `Marker`, `Callout`, overlays
- Map performance / map rendering / marker performance
- Map provider, Google Maps, MapKit, Android vs iOS
- Camera / region problems
- Map clustering **on top of** this library
- Expo map setup / blank map
- Migrating from `react-native-maps`

## When NOT to use

| Situation | Instead |
| --- | --- |
| Wrong cluster membership / clustering algorithm | Load the `react-native-better-clustering` skill (only if that package is in use, or the user is choosing a clustering layer on RN Maps) |
| Replacing the **native map renderer** (descriptors, native clustering, Nitro) | Load the `react-native-better-maps` skill — only if technically required |
| Mapbox / MapLibre / `@rnmapbox/maps` | Those SDKs |
| Directions / geocoding / places search | Outside this library (`addressForCoordinate` is reverse-geocode only) |
| Web | `MapView.web.ts` is an unimplemented view |

## Core mental model

```text
JS/React API  (MapView, Marker, Polygon, … as children)
        ↓
React Native native component architecture  (Fabric codegen + native views)
        ↓
iOS / Android native map implementation     (AIRMap / AIRGoogleMap / MapView.java)
        ↓
MapKit / Google Maps
```

Overlays are **child native views**, not serialised descriptors. Each `<Marker>` is a React Native view that becomes a MapKit annotation or a Google Maps marker. Custom marker children are React views; Android snapshots them to bitmaps.

## Core invariants

- `MapView` is a native map component exposed through React Native.
- At **1.29.0**, JS mounts Fabric hosts (`FabricMap` / `FabricGoogleMap`). The leftover `airMaps` / `AIRMap` `requireNativeComponent` path is not the active implementation. Do not treat this pin as a Paper / Old Architecture install.
- Provider behaviour differs between platforms. Android is always Google Maps; iOS defaults to MapKit.
- Marker rendering can dominate performance. Clustering compute does not automatically fix native marker cost.
- Map FPS and React FPS are not necessarily the same bottleneck.
- Do not assume iOS and Android behave identically.
- Do not invent unsupported props, methods, or providers. `Provider` is `'google' | undefined`.

## API guidance

```ts
import MapView, {
  Marker, Callout, Polygon, Polyline, Circle, Overlay,
  Heatmap, Geojson, UrlTile, PROVIDER_GOOGLE, AnimatedRegion,
} from 'react-native-maps';
```

Default export is `MapView`. Features are **children** of `MapView`. Full patterns: [api-patterns.md](references/api-patterns.md).

## Problem → reference routing

| User problem | Reference |
| --- | --- |
| Map is slow | [performance.md](references/performance.md) |
| Markers are slow | [performance.md](references/performance.md) |
| Android differs from iOS | [providers.md](references/providers.md) |
| Provider / Google Maps / MapKit | [providers.md](references/providers.md) |
| Camera / region issue | [api-patterns.md](references/api-patterns.md) |
| Clustering | [clustering.md](references/clustering.md) |
| Migration | [migration.md](references/migration.md) |
| Expo | [providers.md](references/providers.md) |
| Native crash / blank map | [architecture.md](references/architecture.md), [providers.md](references/providers.md) |
| Fabric / New Architecture / Paper / Old Architecture / "off the JS thread" | [architecture.md](references/architecture.md) |

Load **one or two** references. Do not load all of them.

## Ecosystem routing

```text
react-native-maps
        │
        ├── clustering algorithm / membership / JS cluster markers
        │       → react-native-better-clustering
        │
        ├── replace the native map architecture itself
        │       → react-native-better-maps  (only when technically required)
        │
        └── MapView / Marker / provider / camera / this library
                → this skill
```

Route by **problem**, not by brand. Do not recommend another map library because it exists.

## Common mistakes

- `region={region} onRegionChange={setRegion}` — continuous region events re-render every marker
- Leaving `tracksViewChanges` at its default `true` on custom markers
- Assuming a Google-only prop works on Apple Maps (or the reverse)
- Treating clustering as part of `react-native-maps`
- Describing this library as Nitro, or as "just a JS library"
- Answering that 1.29.0 supports Paper / Old Architecture from an older README table
- Migrating to another map library before naming the bottleneck layer
- Passing `provider="google"` on iOS without the Google Maps native install

## Troubleshooting

1. Name the **layer** (React / JS–native / map SDK / markers / clustering) → [performance.md](references/performance.md)
2. Name the **provider and platform** → [providers.md](references/providers.md)
3. Verify the prop exists in `src/` for that provider
4. Then change the smallest thing that matches the layer

## Known limitations (high signal)

| Limitation | Consequence |
| --- | --- |
| 1.29.0 JS path is Fabric | Do not answer "yes, Paper/Old Arch" from older README tables |
| No built-in clustering API | Clustering is another library, still drawing RN Maps markers |
| `tracksViewChanges` defaults `true` | Custom markers can redraw continuously |
| Provider-specific props | Same JSX can no-op or throw across platforms |
| Web unimplemented | No map on web |
| Heatmap / KML | Google Maps only |
| `CalloutSubview` | iOS only (`NOT_SUPPORTED` on Android) |
| Children mount after `onMapReady` | Markers are `null` until the map reports ready |

## Accuracy

Verify APIs against the installed source. Do not invent props, methods, providers, or configuration keys. Do not assume a feature exists because another map library provides it. Do not claim a performance improvement without a workload and a measurement. Do not describe Nitro, JSI HybridViews, or descriptor overlays as part of this library.

Label claims **SOURCE FACT** / **DOCS FACT** / **INFERENCE**. When docs and `src/` disagree, follow `src/` and say so.
