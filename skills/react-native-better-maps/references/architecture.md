# Architecture

Reference for what the library is and where its parts live. Execution costs live in [performance.md](performance.md).

There is **no shared package/C++** for overlay, clustering, or adapter logic. Native behaviour is implemented twice — **Swift and Kotlin** — and any native change must land on both hosts (or be explicitly scoped and documented as provider/platform-specific).

## Layers

```
React MapView            package/src/components/MapView.tsx
  collects overlay children or takes bulk descriptor props
  wraps listeners in nitro callback()
NativeMapView            package/src/native/MapViewNative.ts (getHostComponent + MapViewConfig.json)
  Fabric props parsed by generated HybridMapViewProps
HybridMapView            package/ios/HybridMapView.swift, android/.../HybridMapView.kt
  stores state, installs a provider adapter, replays state into it
MapProviderAdapter       Apple MapKit | Google Maps (iOS) | Google Maps (Android)
Overlay controllers      MapOverlayController, GoogleMapOverlayController
Map SDK objects          MKAnnotation / MKOverlay, GMSMarker, Google Maps Marker
```

## File map

| Area | Paths under `package/` |
| --- | --- |
| Public components | `src/components/{MapView,Marker,Polyline,Polygon,Circle}.tsx`, `src/index.ts` |
| Overlay collection | `src/hooks/useCollectedOverlays.ts`, `src/overlays/*` |
| Nitro spec | `src/native/specs/MapView.nitro.ts`, `src/native/specs/overlays.ts` |
| Host component | `src/native/MapViewNative.ts` |
| Provider resolution | `src/providers.ts` |
| Codegen | `nitrogen/generated/**`, `scripts/patch-nitrogen-generated.mjs` |
| iOS host and adapters | `ios/HybridMapView.swift`, `ios/{Apple,Google}MapProviderAdapter.swift`, `ios/MapProviderAdapter.swift`, `ios/MapViewState.swift` |
| iOS markers | `ios/MapOverlayController.swift`, `ios/GoogleMapOverlayController.swift`, `ios/MarkerClusterEngine.swift`, `ios/MarkerSpatialIndex.swift`, `ios/MarkerViewportFilter.swift` |
| Android | `android/src/main/java/com/margelo/nitro/nitromaps/*.kt` |
| Expo plugin | `plugin/src/*`, `app.plugin.js` |
| Decisions | `docs/adr/0001`–`0004` |

## Public API

`package/src/index.ts` exports the components, the type surface (coordinate, region, camera, provider, POI events, overlay props and descriptors, `MapViewRef`), and two helpers, `regionFromCoordinate` and `distanceBetween`.

### Overlay children are collectors

`Marker`, `Polyline`, `Polygon`, and `Circle` render `null` and carry a static `overlayType`. `useCollectedOverlays` walks `React.Children`, builds descriptor arrays, and fills an id-keyed callback registry. Missing ids fall back to `${type}-${index}`, which shifts when list order changes and misroutes callbacks — stable ids are the contract for anything reorderable.

Bulk props (`markers`, `polylines`, `polygons`, `circles`) take precedence over collected children when set, and are the documented path for hundreds or thousands of points.

### Imperative handle

`MapViewRef` methods forward to hybrid methods and return Nitro promises. `getCamera` and `setCamera` on the ref map to `fetchCamera` and `applyCamera` on the hybrid; `animateCamera`, `getVisibleRegion`, and `fitToCoordinates` keep their names. When the view is unmounted the wrapper rejects with `MapView is not mounted`.

### Providers

`src/providers.ts` resolves `apple` on iOS and `google` on Android, and throws for anything the platform does not support. `openstreetmap` and `mapbox` exist in the `MapProvider` union as reserved names with no adapter. Native rejects unsupported providers too: iOS returns an `UnavailableMapProviderAdapter`, Android calls `error()`.

Provider-specific props are narrowed through `MapViewPropsForProvider<P>` and pinned by `package/type-tests/provider-props.ts`.

## Events

Native emits map-level callbacks carrying overlay **ids**; `MapView.tsx` resolves them through `callbackRegistry` via `overlayCallbackKey(type, id)`, calls the child handler, then the map-level prop. Listeners are only registered with native when something needs them (`hasMarkerPress`, `hasPolylinePress`, and friends), so unused events never cross.

| Event | Payload | Notes |
| --- | --- | --- |
| `onRegionChange` / `onRegionChangeComplete` | `Region` | **One each per user gesture**, latched by `isUserRegionChange` / `isUserGesture`. Programmatic moves emit neither |
| `onMapReady` | none | Fires once |
| `onPress` / `onLongPress` | `Coordinate` | Background map only |
| `onPoiPress` | `ApplePoiPressEvent \| GooglePoiPressEvent` | Base-map POIs; suppresses background `onPress` |
| `onMarkerPress`, `onMarkerDragEnd` | `id`, `id + Coordinate` | Also dispatched to `Marker` handlers |
| Shape `onPress` | `id` | Polyline, polygon, circle; `tappable` defaults true when a handler exists |
| `onClusterPress` | `string[] + Coordinate` | Member marker ids |

Apple POI events carry `category` and `rawCategory`; Google POI events carry `name` and `placeId`, and the JS wrapper drops Google events missing either field.

## Platform differences

Encode these rather than assuming parity:

- **Region under tilt or rotation.** Apple derives `Region` from `MKCoordinateRegion` (center plus span); Android derives it from the visible `LatLngBounds`. The values agree when flat and diverge when tilted or rotated.
- **Scale control.** `showsScale` is Apple-only and rejected by the type tests for `google`.
- **Map types.** `terrain` falls back to standard on Apple.
- **Custom styles.** Google JSON styles on both Google backends; a curated `MKMapConfiguration` subset on Apple, iOS 16+.
- **`followsUserLocation`.** Apple iOS and Google iOS follow the camera; Android enables the location layer only (empty follow block in `GoogleMapProviderAdapter`).
- **`googleMapId`.** Google backends only, and creation-time, hence the remount.
- **Custom view markers.** Unsupported on every backend. `docs/adr/0004-custom-view-markers.md` proposes a separate `MarkerView` HybridView; MapKit could host live views while Google Maps would need bitmap snapshots.

## Decisions already made

- **ADR 0001** — provider adapters own SDK views, and provider switches remount rather than mutate.
- **ADR 0002** — the iOS Google Maps SDK arrives through the package podspec, because the library target itself compiles `GoogleMapProviderAdapter`.
- **ADR 0003** — marker and cluster entering animations are native presets driven by serializable props, keeping Reanimated out of the core dependency set.
- **ADR 0004** — custom view markers, if built, are an additive `MarkerView` HybridView beside the descriptor pipeline, not an extension of `Marker`.

## Distribution

ESM-only build through `react-native-builder-bob` (`module` + `typescript` targets), an explicit `exports` map, and a `source` condition Metro resolves in development. Requires React Native 0.78+, New Architecture, and `react-native-nitro-modules` 0.35+. Expo needs a development build and the config plugin; Expo Go cannot load the native module.

## Native, Nitro, and Fabric

Implementation rules for the Swift, Kotlin, and generated layers.

### Nitro spec and codegen

`package/src/native/specs/MapView.nitro.ts` is the contract: `MapViewProps extends HybridViewProps` plus `MapViewMethods extends HybridViewMethods`. Overlay descriptor shapes live beside it in `specs/overlays.ts`.

Descriptors carry plain data only; callbacks are separate props, so a marker's `onPress` stays in the JS registry while native sees an id. Event props forwarded to `NativeMapView` pass through `callback()` from `react-native-nitro-modules`, which Nitro needs for callback lifetime.

Adding a member means: edit the spec, run `bun run nitrogen`, implement it on `HybridMapView.swift` **and** `HybridMapView.kt`, and extend the fingerprint when it is a marker field. There is no shared C++ overlay path to update once.

The generated tree under `package/nitrogen/generated/` is rewritten on every codegen run. `package/scripts/patch-nitrogen-generated.mjs` re-applies two repo-specific edits to the shared C++ view component and fails loudly when its target text no longer matches, which is the signal that a Nitrogen upgrade changed the emitted shape.

### Fabric hosting

`getHostComponent<MapViewProps, MapViewMethods>('MapView', () => MapViewConfig)` binds the generated view config; Android additionally registers through `NitroMapsPackage.kt` and the generated view manager, iOS through the podspec.

Generated `HybridMapViewProps` reads each prop from `RawProps` when present and otherwise keeps the previous value. There is no per-marker patch protocol — a changed `markers` prop is a whole new array.

Overlay React children never enter the Fabric subtree; they exist so `useCollectedOverlays` can read props. A future custom-view marker is a separate HybridView under ADR 0004 rather than children on `Marker`.

New Architecture is the only target. Nitro Views require it, and Expo Go cannot load the module.

### iOS

`HybridMapView.swift` holds a container `UIView`, keeps props in `MapViewState` behind `stateLock`, and installs adapters on the main thread. Prop setters store state then hop to main to sync the adapter, so state reads stay consistent off-thread.

A lifecycle generation counter plus `isRecycled` guards promises: `promiseOnMain` and `promiseOnMainVoid` capture a snapshot and reject with `MapView is not mounted` when the view was recycled between call and execution. Keep that snapshot pattern for new imperative methods.

Adapters:

- `AppleMapProviderAdapter` drives `NitroMKMapView`, with `MapOverlayController` and the annotation views `NitroPinAnnotationView`, `NitroImageAnnotationView`, `NitroClusterAnnotationView`. Live clustering runs from a run-loop timer during gestures.
- `GoogleMapProviderAdapter` drives `GMSMapView` with `GoogleMapOverlayController`, reading the API key through `GoogleMapsAPIKey`. Both share `MarkerRenderPipeline`.
- `UnavailableMapProviderAdapter` absorbs unsupported providers and configuration failures so construction never crashes.

Conversions stay in `+`-suffixed extension files (`Camera+MKMapCamera.swift`, `Region+GMSCoordinateBounds.swift`, and so on), one concern per file, classes `final`.

### Android

`HybridMapView.kt` hosts a `FrameLayout`, implements `RecyclableView`, backs each prop with a private field, and forwards to the adapter. `syncState` replays every field into a freshly installed adapter — a new prop is added there as well as in its setter, or it silently disappears on provider reinstall.

`GoogleMapProviderAdapter.kt` owns the Google `MapView` lifecycle, listeners, camera, and controls. `MapOverlayController.kt` owns markers, clusters, shapes, and animators, with its own compute executor and the throttle constants in [performance.md](performance.md).

Conversions live in `+`-named Kotlin files matching the iOS layout (`Camera+CameraPosition.kt`, `Region+LatLngBounds.kt`).

### Threading

| Thread | Owns |
| --- | --- |
| JS | Overlay collection, image resolution, callback dispatch into app code |
| Main / UI | SDK mutation, annotation and marker add/remove/update, animations, event emission |
| Background compute | Spatial index construction, cluster grouping, viewport filtering, diffing |

Background results cross back to main and check a generation counter before applying, so a newer refresh always wins. Preserve that check in any new async path.

### Lifecycle and resources

`prepareForRecycle` runs on host and adapter, and is where every retained resource is released: timers invalidated, animators cancelled, listeners nulled, overlays removed, the Android compute executor shut down and replaced, and stored props reset to defaults.

Overlay controllers hold the map view weakly on iOS; timers and dispatch work items capture `[weak self]`. Keep both patterns when adding asynchronous work, otherwise a recycled map view stays alive behind its own timer.

Image caches are memory-only by design. New caches need an eviction bound.

### Google Maps configuration

Neither platform ships an API key. iOS reads `GoogleMapsIosApiKey` from `Info.plist`, Android reads `com.google.android.geo.API_KEY` metadata, and the Expo config plugin in `package/plugin/` writes both from `googleMapsApiKey`, `iosGoogleMapsApiKey`, and `androidGoogleMapsApiKey`, alongside location permission strings. A blank Google map is nearly always configuration, not JS.

The iOS SDK dependency is declared in `package/react-native-better-maps.podspec` because the library target itself compiles `GoogleMapProviderAdapter` (ADR 0002); host-app SPM integration does not satisfy it.
