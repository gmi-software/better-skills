# Migration

Leaving `react-native-maps` for another native map library (for example `react-native-better-maps`). This file is the **decision and inventory**. Destination API mapping lives in that library's skill — load the `react-native-better-maps` skill and open its migration reference. Do not duplicate that table here.

## When NOT to migrate

Do not migrate because another library exists, because Android feels slower, or because an agent defaulted to "rewrite".

Stay on `react-native-maps` when any of these is true:

- Custom React marker views (`<Marker><Badge /></Marker>`) are required. Destination libraries that use descriptors typically cannot host arbitrary React children.
- `<Callout>` / `CalloutSubview` / info windows are required.
- You need `Heatmap`, `UrlTile` / `WMSTile` / `LocalTile`, `Geojson`, or image `<Overlay>`.
- You need `takeSnapshot`, `pointForCoordinate`, `coordinateForPoint`, `addressForCoordinate`, `getMarkersFrames`, or `AnimatedRegion` as used today.
- You are on Old Architecture or an RN version the destination does not support.
- Expo Go is the runtime and the destination requires a development build / New Architecture.
- The slowdown is a controlled `region` loop or `tracksViewChanges` — those are fixable here ([performance.md](performance.md)).
- Clustering on **this** MapView is enough and the bug is algorithm/membership → load the `react-native-better-clustering` skill, not a map swap.

A **partial** split is valid: keep RN Maps on screens that need callouts; use another map only where the constraint is native marker volume.

Migrate only when the user needs a different native architecture (bulk descriptors, native clustering inside the map, Nitro) **and** they accept the destination's missing APIs.

## Inventory the current app

Search before rewriting:

| Look for | Why it matters |
| --- | --- |
| `from 'react-native-maps'` / `require('react-native-maps')` | Every screen |
| `PROVIDER_GOOGLE`, `provider=` | iOS Google is opt-in; Android is always Google |
| `<Marker`, `tracksViewChanges`, Marker children | Custom views vs image pins |
| `<Callout`, `CalloutSubview` | Often a hard blocker for descriptor maps |
| `<Polygon`, `<Polyline`, `<Circle`, `<Overlay`, `<Heatmap`, `<Geojson`, `UrlTile` | Overlay coverage |
| `region`, `initialRegion`, `camera`, `initialCamera`, `onRegionChange*` | Controlled-camera loops |
| `animateCamera`, `animateToRegion`, `fitTo*`, `takeSnapshot`, `ref=` | Imperative API |
| Clustering packages | Stays or is replaced by native clustering |
| Expo plugin `react-native-maps` / Google keys | Native config must be re-done |
| Platform-specific props (`liteMode`, `followsUserLocation`, `googleMapId`, …) | Will not 1:1 map |

Do not assume a destination supports a prop because the name matches. `animateCamera` duration units, `onRegionChange` cadence, and `provider` values already differ across libraries.

## Providers and native config

Destination libraries still need Google keys on Android (and on iOS if they use Google). Apple vs Google behaviour remains unequal after a swap.

Re-test:

- iOS MapKit (or destination default)
- iOS Google, if you use it
- Android Google
- Blank-map / key path
- Location permission + `showsUserLocation`

Expo: a different config plugin, a development build, and a prebuild. Do not expect Expo Go to pick up a Nitro map module.

## Markers and clustering

RN Maps: one React child per annotation.

If you migrate to descriptor/native clustering:

- Child `<Marker>` collection goes away or becomes a thin helper that renders `null`
- Custom view markers generally cannot come along
- JS clustering libraries that wrap RN Maps `MapView` will not wrap the new view. Remove them; do not nest both.

If you only needed clustering on RN Maps, prefer adding/fixing a clustering layer first ([clustering.md](clustering.md)).

## Camera and region

RN Maps: `initialRegion` is uncontrolled after mount; `onRegionChange` is continuous.

Other libraries may make `region` fully controlled, fire region events once per gesture, or use different animation units. Copy-pasting `onRegionChange={setRegion}` into the destination can still rebuild overlays — check that skill's rendering notes.

## Testing requirements

Minimum pass criteria, both platforms, release-like build:

- [ ] Initial camera matches the old screen
- [ ] Pan / zoom / rotate / pitch (whatever you enabled)
- [ ] Marker press, drag (if used), callout replacement (or accepted absence)
- [ ] Overlays you kept (polyline/polygon/circle)
- [ ] Clustering / density at the zooms you care about
- [ ] User location, if enabled
- [ ] Google key / cloud `googleMapId` styling, if used
- [ ] No controlled-region feedback loop
- [ ] Performance measured on the same device/workload you used to justify the move

If a checklist item is "not supported at destination", that is a **reason not to migrate**, not a bug to ignore.

## Routing

- User asked how to use / fix **this** library → stay in this skill.
- User asked "should I migrate?" → this file; default answer is **no** until a blocker above is absent and a real layer-4/native limit is proven.
- User asked to **replace** `react-native-maps` with `react-native-better-maps` → load the `react-native-better-maps` skill after this inventory.
