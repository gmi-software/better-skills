# Architecture

How `react-native-maps` actually runs. Verified against `src/` and native trees at **1.29.0**.

This is a **React Native native-component library**, not a Nitro HybridView, not a JS-only wrapper, and not a shared C++ engine.

## Layers

```text
JS/React API
  MapView, Marker, Callout, Polygon, Polyline, Circle, Overlay, …
        ↓
React Native native components
  Fabric codegen (`RNMapsSpecs`) — this is the JS mount path at 1.29.0
        ↓
Library native views
  iOS: AIRMap (MapKit) | AIRGoogleMap (GMSMapView)
  Android: MapView.java (GoogleMap)
        ↓
Map SDK
  MapKit / Google Maps
```

`Geojson` is the exception: it is a JS helper that emits `Marker` / `Polyline` / `Polygon` children. It is not a native overlay type.

Web: `src/MapView.web.ts` re-exports `react-native-web`'s `UnimplementedView`. There is no web map.

## JS MapView path (1.29.0)

`src/MapView.tsx` always mounts a Fabric host:

| Condition | Component | Codegen name |
| --- | --- | --- |
| iOS + `provider === 'google'` | `FabricGoogleMap` | `RNMapsGoogleMapView` |
| Everything else | `FabricMap` | `RNMapsMapView` |

Android has no separate Google Fabric map component (`RNMapsGoogleMapView` is `excludedPlatforms: ['android']`). Android is Google Maps either way.

An unused `airMaps` `requireNativeComponent('AIRMap')` object remains in `MapView.tsx`. It is **not** the render path at **1.29.0**. Do not document Paper `AIRMap` as the active JS implementation for this pin.

Children are withheld until `onMapReady` (`isReady`). Before that, `children` is `null`.

`ProviderContext` passes `provider` down so overlay components pick the matching native view (`decorateMapComponent.ts`).

## Native trees

| Side | Paper (legacy managers) | Fabric |
| --- | --- | --- |
| iOS Apple | `ios/AirMaps/AIRMap*` (`MKMapView`) | `RNMapsMapView`, `RNMapsMarkerView`, … |
| iOS Google | `ios/AirGoogleMaps/AIRGoogleMap*` (`GMSMapView`) | `RNMapsGoogleMapView`, `RNMapsGoogleMarkerView`, … |
| Android | `android/.../maps/MapView.java` (`GoogleMap`) | `android/.../fabric/*Manager.java` |

iOS Google Maps is a **pod subspec**, not the default:

- Default: `react-native-maps/Maps` (MapKit)
- Google: `pod 'react-native-maps/Google'` plus `GMSServices.provideAPIKey` as the first call in `didFinishLaunchingWithOptions`

Without the Google subspec, mounting `PROVIDER_GOOGLE` on iOS raises a runtime error. `HAVE_GOOGLE_MAPS` is written at pod install time.

Codegen config: `package.json` → `codegenConfig.name = "RNMapsSpecs"`, `type: "all"`, `includesGeneratedCode: true`. TurboModule: `RNMapsAirModule` (`src/specs/NativeAirMapsModule.ts`) for imperative queries (`getCamera`, `takeSnapshot`, …).

## New Architecture vs Old Architecture (1.29.0)

This section is for **react-native-maps 1.29.0** (`863dc3c`). Do not generalise it to older releases.

**At 1.29.0 the JS `MapView` always mounts a Fabric host** (`FabricMap` / `FabricGoogleMap`). That is the active implementation. The leftover `airMaps` / `requireNativeComponent('AIRMap')` object in `MapView.tsx` is unused. Paper view managers still exist on disk (`AIRMap*`, `MapView.java`); they are not what this version's JS entry renders.

This library is **not** Nitro. It is a React Native native-component library on Fabric codegen (`RNMapsSpecs`).

| Source | What it actually says |
| --- | --- |
| `package.json` peer | `react-native >= 0.76.0` |
| Library README **Fabric** table | 1.26.1+ pairs with RN `>= 0.81.1` |
| Library README **Old Architecture** table | Lists `1.14.0–1.20.1` and `< 1.14.0` only. **1.29.0 is not in that table.** |

If the user asks **"Does react-native-maps 1.29 support Old Architecture / Paper?"**:

- Do **not** answer yes from the README Old Architecture table. That table does not cover 1.29.0.
- Answer from this pin: JS mounts Fabric hosts. Treat 1.29.0 as a Fabric / New Architecture installation.
- Earlier versions had a different Paper JS path. That is historical; it is not this pin.

If their installed version is **not** 1.29.0, re-read *their* `src/MapView.tsx` before answering.

## React ↔ native boundary

Each overlay child is a real native view in the RN hierarchy:

1. React commits a `<Marker>` (or polygon, …).
2. The matching native view is created/updated.
3. That view adds/removes an SDK annotation or overlay.

Consequences:

- Marker **count** is React child count, not a bulk array on `MapView`.
- Re-rendering the parent with new element identity remounts native annotations.
- Custom marker children are React views. Android draws them to a bitmap (`MapMarker.getIcon` / `ViewChangesTracker`). iOS Google uses `GMSMarker.tracksViewChanges`. iOS Apple uses MapKit annotation views.
- You cannot "move map rendering off the JS thread" inside this library. The map SDK already paints natively; **overlay management still goes through RN views**.

## Lifecycle

- `onMapReady` — JS sets `isReady` and then mounts children. Android's first ready callback is intercepted; the event object may be missing.
- `onMapLoaded` — tiles finished; Google Maps (iOS Google + Android).
- `showsUserLocation` — requires a granted location permission; fails silently otherwise (docs). iOS Google Maps SDK still wants `NSLocationWhenInUseUsageDescription` in Info.plist even if you never show the user dot.
- Native map views follow the host activity/view controller. Blank/grey Google maps are usually keys or zero layout size, not a JS bug. See [providers.md](providers.md).

## Crashes and native failures

Typical native-side failures (not clustering, not React):

- Missing Google API key / billing / SDK not enabled → blank tiles, Google logo only
- `PROVIDER_GOOGLE` on iOS without the Google subspec → runtime exception
- `fitToCoordinates` from `componentDidMount` on Android → documented to throw; wait for `onLayout` / `onMapReady`
- Using a Google-only overlay (Heatmap, KML) on Apple Maps → runtime error (installation docs)

Do not rewrite native map code to fix a JS-layer problem. Name the layer first ([performance.md](performance.md)).
