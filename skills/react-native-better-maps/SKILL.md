---
name: react-native-better-maps
description: >-
  Expert guide to react-native-better-maps — native maps for React Native built on Nitro
  Modules, with Apple MapKit and Google Maps provider adapters, descriptor-based overlays,
  and native marker clustering. Use when installing or configuring the map, rendering
  markers or overlays, driving the camera, diagnosing lag or marker re-render churn,
  working around a provider or platform difference, migrating from react-native-maps, or
  changing the library's TypeScript, Swift, Kotlin, or Nitro specs.
license: MIT
metadata:
  package: react-native-better-maps
  version: "1.1.0"
  commit: b9a178334913043b3aa2542fb528731debaad4f5
  verified: "2026-08-21"
  repository: https://github.com/gmi-software/react-native-better-maps
  audience: library users and library contributors
  tags: react-native, maps, mapkit, google-maps, nitro, jsi, markers, clustering, expo, ios, android
---

# react-native-better-maps

Native map view for React Native's New Architecture. One Nitro HybridView (`MapView`) backed by
Apple MapKit or Google Maps. Overlays are serialisable descriptors (not child views). Clustering
is implemented in Swift/Kotlin — not JavaScript, not shared C++, and not shared with
`react-native-better-clustering` (load that skill only when clustering on `react-native-maps`).

Paths like `package/src/...` are relative to a **library checkout**, not this skills repo.

## Version verification

```text
Package:            react-native-better-maps
Version:            1.1.0
Commit:             b9a178334913043b3aa2542fb528731debaad4f5
Verification date:  2026-08-21
```

```bash
npm view react-native-better-maps version
node -p "require('react-native-better-maps/package.json').version"
```

## When to use

- Installing / configuring the map (Google keys, Expo config plugin)
- Markers, polylines, polygons, circles, camera control
- Jank, flicker, markers disappearing at some zooms
- iOS vs Android or Apple vs Google behaviour differences
- Migrating from `react-native-maps`
- Changing TypeScript, Swift, Kotlin, Nitro specs, or the config plugin

## When NOT to use

| Situation | Instead |
| --- | --- |
| Using or debugging `react-native-maps` itself (not migrating) | Load the `react-native-maps` skill |
| Clustering on top of `react-native-maps` | Load the `react-native-better-clustering` skill |
| Mapbox / OSM tiles | Names exist in `MapProvider` but **throw at runtime** |
| Arbitrary React views as marker content | Unsupported on every provider |
| Web / Old Architecture / Expo Go | Native New Arch + development build only |
| Directions / geocoding / places | Outside this library |

## Core architecture

1. **One HybridView.** Everything is a prop or imperative method on `MapView`.
2. **Overlays are descriptors.** `<Marker>` renders `null`; props become `MarkerDescriptor`s.
   Bulk `markers` bypasses child collection — preferred for large sets.
3. **Adapters own SDKs.** `MapProviderAdapter` owns MapKit or Google Maps.
4. **Provider changes remount.** Key is `` `${provider}:${googleMapId ?? ''}` `` — camera and
   overlays must be re-supplied.
5. **Large sets take a background path.** Clustering on, or >500 descriptors → spatial index on
   a background queue; smaller unclustered sets apply synchronously.
6. **No shared native package.** Native changes require **both** Swift and Kotlin (or an explicit
   provider/platform carve-out).

## API guidance

```ts
import {
  MapView, Marker, Polyline, Polygon, Circle,
  regionFromCoordinate, distanceBetween,
} from 'react-native-better-maps';
```

That is the entire runtime surface (plus types). Full detail: [api.md](references/api.md).

## Problem → reference routing

| Problem | Start here |
| --- | --- |
| **Installation / blank map / Expo** | [setup.md](references/setup.md) |
| Google Maps blank/crash on iOS | setup → [ios.md](references/ios.md) |
| Markers, overlays, camera | [api.md](references/api.md) |
| Lag while panning/zooming | [performance.md](references/performance.md) |
| Marker re-render / flicker | [rendering.md](references/rendering.md) |
| Clustering / markers vanish when zoomed out | [clustering.md](references/clustering.md) |
| Provider / platform asymmetry | [ios.md](references/ios.md), [android.md](references/android.md) |
| Camera fights controlled `region` | [debugging.md](references/debugging.md) |
| **Migration from react-native-maps** | [migration.md](references/migration.md) |
| `animateCamera` hangs | debugging — **duration is seconds, not ms** |
| Architecture / contributing | [architecture.md](references/architecture.md), [contributing.md](references/contributing.md) |

## Canonical performance workflow

1. Baseline (release, real device, recorded number)
2. Define workload (count, provider, gesture)
3. Profile (Instruments / Android Studio Profiler)
4. Identify layer (JS / React / JSI conversion / native SDK)
5. Hypothesis → smallest change → re-measure → compare → regression note

Most "slow map" reports are layer 1: camera event → parent re-render → new `markers` array →
full descriptor re-cross. Region callbacks fire **once per gesture**, not per frame.

## Common mistakes

- Passing `duration: 300` to `animateCamera` (five-minute animation — unit is **seconds**)
- Expecting custom React marker views
- Using `openstreetmap` / `mapbox` provider values (they throw)
- Assuming Google-iOS honours `image` / `anchor` / `opacity` (it forces stock pins)
- Blaming clustering first when the parent rebuilds descriptors every camera event
- Measuring FPS on emulator / debug builds

## Troubleshooting

1. Blank/grey map → keys + Expo plugin + New Arch ([setup.md](references/setup.md))
2. Slow → name the layer ([performance.md](references/performance.md))
3. Flicker → stabilize `markers` / descriptor identity ([rendering.md](references/rendering.md))
4. Crash / odd prop → [debugging.md](references/debugging.md)

## Known limitations (high signal)

| Limitation | Consequence |
| --- | --- |
| `openstreetmap` / `mapbox` unimplemented | Throw during render |
| Google-iOS ignores marker visuals | Stock pins only; no warning |
| `animateCamera` duration in seconds | Default 0.25 s |
| Android `fitToCoordinates` / `region` apply collapse padding to max edge | Asymmetric fit padding does not port; `mapPadding` is per-edge |
| Unclustered LOD drops markers when zoomed out | By design, not a bug |
| No Expo Go | Development build required |
| No benchmark harness in repo | Measure yourself |

Full list and evidence rules: see references; do not invent thresholds.
