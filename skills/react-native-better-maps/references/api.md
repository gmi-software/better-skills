# API reference

The complete public surface, read from `package/src` at v1.1.0. Everything is exported from the
package root; there are no subpath exports except `./app.plugin.js` and `./package.json`.

```ts
import {
  MapView, Marker, Polyline, Polygon, Circle,
  regionFromCoordinate, distanceBetween,
} from 'react-native-better-maps';
```

## MapView

```tsx
<MapView
  style={StyleSheet.absoluteFill}
  region={{ latitude: 52.23, longitude: 21.01, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
  onRegionChangeComplete={handleRegionSettled}
>
  <Marker id="a" coordinate={{ latitude: 52.23, longitude: 21.01 }} title="Warsaw" />
</MapView>
```

`style` is a normal `StyleProp<ViewStyle>`. The map has no intrinsic size — give it explicit
dimensions or `flex: 1`, or you get a zero-height view and an apparently missing map.

### Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `provider` | `'apple' \| 'google'` | iOS `'apple'`, Android `'google'` | Changing it **remounts** the native view. `'openstreetmap'` and `'mapbox'` are in the type but throw. |
| `googleMapId` | `string` | — | Google provider only. Also remounts, because it is creation-time. |
| `mapType` | `'standard' \| 'satellite' \| 'hybrid' \| 'terrain'` | `'standard'` | `'terrain'` falls back to standard on Apple. |
| `region` | `Region` | — | Center plus deltas. |
| `camera` | `Camera` | — | Center, zoom, heading, pitch, altitude. |
| `scrollEnabled` | `boolean` | provider default | |
| `zoomEnabled` | `boolean` | provider default | |
| `rotateEnabled` | `boolean` | provider default | |
| `pitchEnabled` | `boolean` | provider default | |
| `showsUserLocation` | `boolean` | `false` | Requires a location permission at runtime. |
| `followsUserLocation` | `boolean` | `false` | Camera follow on Apple iOS and Google iOS; Android enables the location layer only. |
| `showsCompass` | `boolean` | provider default | |
| `showsScale` | `boolean` | — | **Apple only.** Typed `never` for the Google provider. |
| `customMapStyle` | `string` | — | Google style JSON. Apple applies a curated `MKMapConfiguration` subset on iOS 16+. |
| `clusteringEnabled` | `boolean` | `false` | Native clustering; see [clustering.md](clustering.md). |
| `mapPadding` | `EdgePadding` | — | Density-independent pixels. Android `setPadding` is per-edge; `fitToCoordinates` / `region` apply use `max()`. See [android.md](android.md#edgepadding-max-vs-per-edge). |
| `markerEnteringAnimation` | `OverlayEnteringAnimation` | — | Map-wide default; per-marker values override it. |
| `clusterEnteringAnimation` | `OverlayEnteringAnimation` | — | |
| `markers` | `MarkerDescriptor[]` | — | Bulk path. **Takes precedence over `<Marker>` children when set.** |
| `polylines` | `PolylineDescriptor[]` | — | Same precedence rule. |
| `polygons` | `PolygonDescriptor[]` | — | |
| `circles` | `CircleDescriptor[]` | — | |

Prop types are narrowed per provider through `MapViewPropsForProvider<P>`, so `showsScale` with
`provider="google"` is a type error rather than a silent no-op.

### Events

| Event | Payload | Notes |
| --- | --- | --- |
| `onMapReady` | none | Fires once. |
| `onRegionChange` | `Region` | Fires **once** when a gesture-driven move begins — not per frame. Programmatic moves emit nothing. |
| `onRegionChangeComplete` | `Region` | Fires once when the gesture settles. Where application work belongs. |
| `onPress` | `Coordinate` | Background map only. |
| `onLongPress` | `Coordinate` | |
| `onPoiPress` | `ApplePoiPressEvent \| GooglePoiPressEvent` | Provider-owned POIs; suppresses the background `onPress`. |
| `onMarkerPress` | `(id: string)` | Also dispatched to the `<Marker>`'s own `onPress`. |
| `onMarkerDragEnd` | `(id: string, coordinate: Coordinate)` | |
| `onPolylinePress` / `onPolygonPress` / `onCirclePress` | `(id: string)` | |
| `onClusterPress` | `(markerIds: string[], coordinate: Coordinate)` | Member marker ids. |

Listeners are only registered with native when a handler exists, so unused events never cross the
boundary.

POI events are a discriminated union:

```ts
type PoiPressEvent =
  | { provider: 'apple';  coordinate: Coordinate; name?: string; category: ApplePoiCategory; rawCategory?: string }
  | { provider: 'google'; coordinate: Coordinate; name: string;  placeId: string }
```

`ApplePoiCategory` is a union of ~75 MapKit category strings plus `'unknown'`, which is the
fallback when native reports a category the union does not cover. The JS layer **drops** Google POI
events that arrive without both `name` and `placeId`, so a handler is not called for them.

### Imperative handle

```tsx
const map = useRef<MapViewRef>(null);
await map.current?.animateCamera({ center: coord, zoom: 14 }, 0.3); // seconds, not ms
```

```ts
interface MapViewRef {
  getCamera(): Promise<Camera>
  setCamera(camera: Camera): Promise<void>
  animateCamera(camera: Camera, duration?: number): Promise<void>
  getVisibleRegion(): Promise<VisibleRegion>
  fitToCoordinates(coordinates: Coordinate[], padding?: EdgePadding, animated?: boolean): Promise<void>
}
```

Every method returns a promise. Called before mount, or after the view is recycled, they reject
with `Error('MapView is not mounted')` rather than throwing synchronously — so `await` them inside
a `try`/`catch` or the rejection is unhandled.

The ref names differ from the Nitro spec on purpose: `getCamera`/`setCamera` forward to
`fetchCamera`/`applyCamera`, because the `camera` prop already claims the `getCamera`/`setCamera`
accessor names in the generated C++ bindings. If you are reading native source, that is the same
call.

**`duration` on `animateCamera` is in seconds, not milliseconds.** Nothing in the type or the JSDoc
says so — it is a bare `duration?: number` passed straight through to native, where all three
adapters treat it as seconds and Android multiplies by 1000 to reach the SDK. Passing `300` because
that is what `react-native-maps` expects gives you a five-minute animation, which reads as a frozen
map rather than an obvious mistake.

Omitting it gives **0.25 s** on every backend.

## Overlay components

`Marker`, `Polyline`, `Polygon`, and `Circle` **render `null`**. They are not native views. The
parent `MapView` reads their props through `React.Children` and serialises them into descriptor
arrays.

Three consequences that trip people up:

- **They must be direct children of `MapView`.** Wrapping them in a fragment, a `<View>`, or your
  own component breaks collection — `React.Children.forEach` does not recurse.
- **Children are ignored.** `<Marker><CustomView /></Marker>` renders nothing. Custom view markers
  are not supported by any provider here.
- **Setting the bulk prop disables children.** If `markers` is non-null, `<Marker>` children are
  discarded entirely, not merged.

### Ids

`id` is optional on the components and required on the descriptors. When omitted, the collector
assigns `` `${type}-${index}` `` — `marker-0`, `polyline-3`, and so on.

That index is positional. Reorder or filter the list and the ids shift, which misroutes press
callbacks and makes native treat a moved marker as a new one. **Give every overlay a stable `id`**
unless the list is fixed and never reordered.

### Marker

| Prop | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Optional on the component, required in `MarkerDescriptor`. |
| `coordinate` | `Coordinate` | Required. |
| `title`, `subtitle` | `string` | Callout text. |
| `draggable` | `boolean` | |
| `clusterable` | `boolean` | Whether it participates when `clusteringEnabled`. |
| `image` | `MarkerImageSource` | `require('./pin.png')` or `{ uri, width?, height?, scale? }`. Ignored under Google-on-iOS. |
| `anchor` | `{ x: number; y: number }` | 0..1 on the image. Default is bottom-center. Ignored under Google-on-iOS. |
| `centerOffset` | `{ x: number; y: number }` | Additional offset in dp. Ignored under Google-on-iOS. |
| `rotation` | `number` | Degrees, clockwise. Ignored under Google-on-iOS. |
| `flat` | `boolean` | Rotate with the map plane instead of staying screen-aligned. Ignored under Google-on-iOS. |
| `opacity` | `number` | 0..1. Ignored under Google-on-iOS. |
| `enteringAnimation` | `OverlayEnteringAnimation` | Overrides the map-level default. |
| `onPress` | `() => void` | |
| `onDragEnd` | `(coordinate: Coordinate) => void` | |

**Six of those props do nothing under `provider="google"` on iOS.** `GoogleMapOverlayController`
sets only position, title, snippet, draggability, and identity on a single marker, then forces
`icon = nil` and a bottom-center anchor. You get stock Google pins with no warning. Cluster badges
still render. Apple-on-iOS and Android apply all six. Details in
[ios.md](ios.md#the-google-provider-on-ios-ignores-every-marker-visual).

`MarkerDescriptor` is the same shape with `id` required and `onPress`/`onDragEnd` removed —
callbacks stay in JS, keyed by id, and native only ever sees the id.

### Polyline, Polygon, Circle

| | Required | Styling |
| --- | --- | --- |
| `Polyline` | `coordinates: Coordinate[]` | `strokeColor`, `strokeWidth` |
| `Polygon` | `coordinates: Coordinate[]` | `fillColor`, `strokeColor`, `strokeWidth` |
| `Circle` | `center: Coordinate`, `radius: number` (metres) | `fillColor`, `strokeColor`, `strokeWidth` |

All three take `id`, `tappable`, and `onPress`. Colours are hex strings, with alpha supported as
`#RRGGBBAA` (`'#FF000080'`). `strokeWidth` is density-independent pixels.

`tappable` defaults to `true` when an `onPress` is present and is otherwise left as you set it —
you do not need to pass both. That defaulting happens in `useCollectedOverlays`, so it only applies
to the JSX components.

If you pass descriptors through the bulk `circles` prop instead and omit `tappable`, the native
default takes over, and it is **not consistent**: Apple-on-iOS and Android treat an unset `tappable`
on a circle as `true`, Google-on-iOS as `false`. Polylines and polygons default to `false`
everywhere. Set `tappable` explicitly on bulk descriptors rather than relying on the default.

## Types

```ts
interface Coordinate { latitude: number; longitude: number }

interface Region { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }

interface Camera { center: Coordinate; zoom?: number; heading?: number; pitch?: number; altitude?: number }

interface EdgePadding { top: number; right: number; bottom: number; left: number }   // Android: mapPadding per-edge; fit/region max()

interface VisibleRegion { nearLeft: Coordinate; nearRight: Coordinate; farLeft: Coordinate; farRight: Coordinate }
```

`Region` is a center-plus-span rectangle; `VisibleRegion` is four corners and is what you want when
the camera is rotated or tilted, because a rectangle cannot represent that. The two are derived
differently per platform — see [ios.md](ios.md) and
[android.md](android.md).

`Camera` mixes MapKit and Google concepts: `altitude` is meaningful to MapKit, `zoom` to Google.
Provide the one your provider uses.

### Marker images

```ts
type MarkerImageSource = number | MarkerImage           // number = require()
interface MarkerImage { uri: string; width?: number; height?: number; scale?: number }
```

`require()`d assets are resolved to `{ uri, width, height, scale }` in JavaScript before crossing
the boundary, through a 64-entry LRU cache
(`MARKER_IMAGE_CACHE_SIZE` in `src/overlays/resolveMarkerImage.ts`). Native never sees a Metro
asset id.

Remote `http(s)` URIs load asynchronously into a memory-only cache on the native side, so a remote
marker image appears a frame or more after the marker does, and is re-fetched after the process is
killed. Bundled assets are the predictable choice.

### Entering animations

```ts
type OverlayEnteringAnimation = false | 'system' | OverlayEnteringAnimationConfig

interface OverlayEnteringAnimationConfig {
  preset: 'fade' | 'fade-scale'
  duration?: number                          // ms
  delay?: number                             // ms
  reduceMotion?: 'system' | 'never'
}
```

`false` disables it, `'system'` uses the platform default. Durations and delays clamp to
0–3000 ms. `reduceMotion: 'system'` honours the OS accessibility setting.

Animations replay when a marker is **added**, not when its config changes while the marker is
retained. Native also caps how many markers animate per diff, so a large viewport refresh animates
a subset — see [performance.md](performance.md).

## Helpers

```ts
function regionFromCoordinate(
  coordinate: Coordinate,
  latitudeDelta?: number,   // default 0.01
  longitudeDelta?: number,  // default 0.01
): Region

function distanceBetween(from: Coordinate, to: Coordinate): number   // metres
```

`distanceBetween` is the Haversine formula on a sphere of radius 6,371,000 m. It is a great-circle
distance, not a driving distance, and it ignores altitude and the Earth's oblateness — good to
roughly 0.5% for typical use.

## Errors you can hit from JavaScript

| Error | Thrown by | When |
| --- | --- | --- |
| `Map provider "mapbox" is not supported on ios. Supported providers: apple, google.` | `resolveMapProvider`, **during render** | An unimplemented provider. Wrap in an error boundary if the value is dynamic. |
| `react-native-better-maps does not support platform "web".` | `getDefaultMapProvider` | Any platform other than iOS or Android. |
| `MapView is not mounted` | The imperative handle | A ref method called before mount or after recycle. Rejected, not thrown. |
| `react-native-better-maps: provider="google" on iOS requires GoogleMapsIosApiKey in the host app Info.plist.` | `GoogleMapsAPIKey.configureIfNeeded` (native) | See [setup.md](setup.md). |

The first two are synchronous throws during render, so a bad `provider` value crashes the tree
rather than degrading.
