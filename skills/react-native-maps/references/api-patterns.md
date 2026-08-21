# API patterns

Public surface verified against `src/index.ts` and component prop types at **1.29.0**.

Do not copy this file into a giant prop dump. If a name is not here, open the component file in `src/`.

## Imports

Default export is `MapView`. Named exports from `src/index.ts`:

```ts
import MapView, {
  Marker, MarkerAnimated, Callout, CalloutSubview,
  Polygon, Polyline, Circle, Overlay, OverlayAnimated,
  Heatmap, Geojson, UrlTile, WMSTile, LocalTile,
  AnimatedRegion, MAP_TYPES, PROVIDER_GOOGLE, PROVIDER_DEFAULT,
} from 'react-native-maps';
```

`PROVIDER_GOOGLE` is `'google'`. `PROVIDER_DEFAULT` is `undefined`. `Provider` type is `'google' | undefined`.

Also exported as aliases: `MapMarker`, `MapPolygon`, `MapPolyline`, `MapCircle`, `MapCallout`, `Animated` (animated `MapView`).

There is no clustered `MapView` export. There is no `clusteringEnabled` prop.

## Children, not descriptor arrays

```tsx
<MapView initialRegion={region} style={{flex: 1}}>
  <Marker coordinate={{latitude, longitude}} title="Pin" />
  <Polyline coordinates={coords} strokeWidth={3} />
  <Polygon coordinates={ring} fillColor="rgba(0,0,255,0.2)" />
  <Circle center={coord} radius={200} />
</MapView>
```

Required fields (SOURCE FACT):

| Component | Required |
| --- | --- |
| `Marker` | `coordinate: LatLng` |
| `Polyline` | `coordinates: LatLng[]` |
| `Polygon` | `coordinates: LatLng[]` |
| `Circle` | `center: LatLng`, `radius` (meters) |
| `Overlay` | `bounds`, `image` |

`Geojson` takes a GeoJSON object and renders the matching children. `Heatmap` is Google Maps only (`points`, optional `gradient` / `radius` / `opacity`).

Callouts:

```tsx
<Marker coordinate={coord}>
  <Callout tooltip>
    <MyCalloutBody />
  </Callout>
</Marker>
```

`CalloutSubview` is **iOS only** (`NOT_SUPPORTED` on Android). Custom marker content is Marker **children that are not** `<Callout>` — they replace the pin. That path is real here; it is not available in every other map library.

`MapView` does not mount children until `onMapReady`.

Give the map a size (`flex: 1` in a flexed parent, or explicit width/height). A zero-size map looks like a missing provider.

## Camera vs region

`Region`: `{ latitude, longitude, latitudeDelta, longitudeDelta }`.

`Camera`: `{ center: LatLng, pitch, heading, altitude?, zoom? }`. `altitude` is Apple Maps (meters). `zoom` is Google Maps. Passing `camera` **ignores** `region`.

| Prop | Role |
| --- | --- |
| `initialRegion` / `initialCamera` | Mount-only. Later changes do not move the map. |
| `region` / `camera` | Controlled. Keep identity stable; do not feed every gesture back into React state. |
| Ref methods | Imperative moves without a controlled-state loop |

`onRegionChange` fires **continuously** while the user drags. `onRegionChangeComplete` fires once when the gesture ends. `onRegionChangeStart` fires once at the start. `details.isGesture` is documented as Google Maps only.

Do not write `region={region} onRegionChange={setRegion}` for a marker-heavy map. That is the usual "region changes re-render every marker" bug. Prefer `initialRegion` plus ref methods, or store region on complete only.

`AnimatedRegion` is a real export for Animated-driven region/coordinate updates.

## Imperative `MapView` methods

On the `MapView` ref (`src/MapView.tsx`):

`getCamera`, `setCamera`, `animateCamera`, `animateToRegion`, `setRegion`, `fitToElements`, `fitToSuppliedMarkers`, `fitToCoordinates`, `getMapBoundaries`, `setMapBoundaries`, `setIndoorActiveLevelIndex`, `takeSnapshot`, `addressForCoordinate`, `pointForCoordinate`, `coordinateForPoint`, `getMarkersFrames`, `boundingBoxForRegion`, `setNativeProps`.

`animateCamera(camera, { duration })` and `animateToRegion(region, duration)` default **duration to 500**. Treat that as milliseconds in this library (the JS default is `500`, not `0.25`). Docs historically say duration is not supported on iOS — verify on the target provider rather than assuming a no-op or a seconds unit.

Several query methods reject with `"… not supported on this platform"` when the Fabric handle is missing. `setMapBoundaries` is Google Maps only (docs). `addressForCoordinate` is documented as not supported on Google Maps for iOS. `fitToCoordinates` on Android from `componentDidMount` is documented to throw. `setRegion` in JS forwards to `animateToRegion(..., 0)` on the Fabric handle and has an Android TODO in source — prefer `animateToRegion` / `setCamera` unless you have verified it on the target platform.

## Marker methods and `tracksViewChanges`

Marker ref: `showCallout`, `hideCallout`, `redrawCallout`, `setCoordinates`, `animateMarkerToCoordinate`, `redraw`, `setNativeProps`.

`tracksViewChanges` defaults **`true`** (codegen `WithDefault<boolean, true>`). Platform notes in `MapMarker.tsx`: iOS Google + Android. Docs recommend turning it off for custom markers and calling `redraw()` when content actually changes.

`tracksInfoWindowChanges` defaults `false`, iOS Google only.

Anchor naming differs by provider:

| Intent | Apple Maps | Google / Android |
| --- | --- | --- |
| Pin hot-spot | `centerOffset` (points) | `anchor` (0–1) |
| Callout hot-spot | `calloutOffset` | `calloutAnchor` |

`icon` is Google Maps (iOS Google + Android). `image` is both. Only local image resources are allowed for `image` / `icon`.

`animateMarkerToCoordinate` exists in JS; docs mark it Android-only. Verify on the platform in use.

## Platform-tagged MapView props (do not assume both)

Examples from `MapViewProps` — not exhaustive:

- Android only: `liteMode`, `googleRenderer` (`'LATEST' | 'LEGACY'`, default `LATEST`), `moveOnMarkerPress`, `toolbarEnabled`, `zoomControlEnabled`, `showsBuildings`, `poiClickEnabled`, user-location interval/priority
- Apple Maps only: `followsUserLocation`, `showsScale`, `cacheEnabled`, `legalLabelInsets`, `appleLogoInsets`, `tintColor`, `compassOffset`, `cameraZoomRange`
- Google Maps (Android + iOS Google): `customMapStyle`, `kmlSrc`, `showsIndoors`, `showsIndoorLevelPicker`, `showsMyLocationButton`, `onPoiClick`, `googleMapId`

`mapType` values differ: Android has `none`; Apple has `mutedStandard` / `*Flyover`. `terrain` is not a MapKit type in the same way — check the prop comment in `src/MapView.tsx`.

If a prop is not on the type, it does not exist. Do not copy APIs from `react-native-better-maps` (`markers` bulk arrays, `clusteringEnabled`, `provider="apple"` strings as required values, seconds-based `animateCamera`).
