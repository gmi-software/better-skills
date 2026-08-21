# iOS

What differs on iOS, verified against `ios/` at v1.1.0 (`b9a1783`).

## Deployment target and dependencies

| | Value | Where |
| --- | --- | --- |
| Minimum iOS | **16.0** | `react-native-better-maps.podspec` |
| Frameworks | `MapKit`, `CoreLocation` | podspec |
| Pods | `React-jsi`, `React-callinvoker`, `GoogleMaps` | podspec |
| Nitro module name | `NitroMaps` | `nitro.json` |

**`GoogleMaps` is an unconditional pod dependency.** It is linked into your app whether or not you
ever set `provider="google"`. You cannot opt out through a podspec flag, so the binary size cost is
unavoidable at v1.1.0. This is worth knowing before you decide the library is "MapKit-only".

## Two providers

iOS is the only platform where you get a choice.

| `provider` | Backing SDK | Adapter |
| --- | --- | --- |
| `'apple'` (default) | MapKit `MKMapView` | `AppleMapProviderAdapter` |
| `'google'` | Google Maps iOS SDK `GMSMapView` | `GoogleMapProviderAdapter` |

`resolveMapProvider` in `src/providers.ts` lists `['apple', 'google']` for iOS and takes the first
entry as the default, so omitting `provider` gives you Apple MapKit.

Choosing `'google'` requires a key in `Info.plist` — see
[setup.md](setup.md#do-you-need-a-google-maps-api-key). Without one you get a
grey view.

**Changing `provider` at runtime tears down and rebuilds the whole adapter.** The camera resets and
overlays are re-created. Treat provider as a mount-time decision; if you must switch, expect a
visible reset and re-apply your camera afterwards.

## Props that behave differently under Apple

`showsScale` is a real MapKit feature. `MKMapView+ScaleAppearance.swift` toggles the scale view,
and `AppleMapProviderAdapter` applies `mapView.showsScale = showsScale ?? false`.

**It is a no-op under the Google provider on iOS.** `GoogleMapProviderAdapter` declares
`var showsScale: Bool?` as a plain stored property with no observer and never reads it. The Google
Maps iOS SDK has no scale-bar control, so nothing is lost, but do not expect the prop to work when
you switch provider. Same story on Android — see [android.md](android.md).

TypeScript catches the explicit case (`GoogleMapViewProps` types `showsScale` as `never`) but not
the implicit one: omitting `provider` allows `showsScale?: boolean`, which is correct on iOS and
silently inert on Android.

`mapType: 'terrain'` **is not distinct on Apple.** `MapType.toMKMapConfiguration()` maps
`.standard` and `.terrain` to the same `MKStandardMapConfiguration(elevationStyle: .realistic)`.
Under the Google provider on iOS, terrain is a real map type. If your UI offers a terrain toggle,
it will appear to do nothing on the default provider.

`customMapStyle` takes Google Maps style JSON. Under Apple this is **not** applied literally —
`CustomMapStyleParser` (iOS 16+) parses the JSON and extracts a curated subset:

| JSON rule | Effect on MapKit |
| --- | --- |
| `featureType: "poi*"` with `visibility: "off"` | `pointOfInterestFilter = .excludingAll` |
| `featureType: "transit*"` with `visibility: "off"` | `showsTraffic = false` |
| `elementType: "geometry"` with negative `lightness` | `elevationStyle = .flat` |

Everything else in the JSON — colours, road weights, label styling — is silently ignored. The
parser's own doc comment says so: "Full JSON parity is not available on iOS". If the JSON fails to
parse, it falls back to the plain configuration for the current `mapType` rather than throwing.

Under the Google provider on iOS the same string goes to `GMSMapStyle(jsonString:)` and is applied
in full. So the *same* `customMapStyle` prop produces very different results depending on provider.

## POI presses

Apple only. `AppleMapProviderAdapter` sets:

```swift
mapView.selectableMapFeatures = onPoiPress == nil ? [] : .pointsOfInterest
```

**Points of interest are only selectable while you have an `onPoiPress` handler attached.** Adding
the handler changes map interaction behaviour, not just your callback wiring: with it, tapping a
café selects the café; without it, that tap is an ordinary map press.

The delegate filters `MKMapFeatureAnnotation` to `featureType == .pointOfInterest`, then
`ApplePoiCategory.from(_:)` maps `MKPointOfInterestCategory` to a string union. The union has
roughly 40 categories available from iOS 16, plus a further set gated behind
`if #available(iOS 18.0, *)` (`animalService`, `automotiveRepair`, `baseball`, `basketball`,
`beauty`, `bowling`, `castle`, `conventionCenter`, `distillery`, `fairground`, and others).

**On iOS 16 and 17, an iOS 18-only category arrives as `unknown`** with the raw value in
`rawCategory`. Write your handler so `unknown` is a normal case, not an error — and consult
`rawCategory` before deciding you have hit a bug.

The event shape is provider-discriminated in TypeScript: `ApplePoiPressEvent` has `category` and
`rawCategory`; `GooglePoiPressEvent` has `placeId`. `MapView.tsx` only forwards the Google variant
when both `name` and `placeId` are non-null, so a Google POI press with a missing `placeId` is
dropped rather than delivered with undefined fields.

## Marker rendering

Under the Apple provider, three annotation view classes, chosen per marker:

| Class | Used for |
| --- | --- |
| `NitroPinAnnotationView` | Markers with no `image` |
| `NitroImageAnnotationView` | Markers with an `image` |
| `NitroClusterAnnotationView` | Cluster badges |

### The Google provider on iOS ignores every marker visual

This is the single largest behavioural gap between the two iOS providers, and it is silent — no
warning, no type error, just default red pins.

`GoogleMapOverlayController.updateMarker` sets exactly five things on a single (non-cluster)
`GMSMarker`: `position`, `title`, `snippet`, `isDraggable`, and `userData`. It then assigns
`marker.icon = nil` and hardcodes `groundAnchor = CGPoint(x: 0.5, y: 1)`. Nothing else is read.

So under `provider="google"` on iOS, all of these are discarded:

| Prop | Apple iOS | Google iOS | Android |
| --- | --- | --- | --- |
| `image` | Rendered | **Ignored** — `icon` forced to `nil` | Rendered |
| `anchor` | Applied | **Ignored** — forced to bottom-center | Applied |
| `centerOffset` | Applied | **Ignored** | Applied |
| `rotation` | Applied | **Ignored** | Applied |
| `flat` | Applied | **Ignored** | Applied |
| `opacity` | Applied | **Ignored** | Applied |

Cluster badges are the exception: they are drawn through `clusterIcon(count:)` and do appear.

The practical consequence is that a custom-pin design implemented against the Apple provider, or
ported from Android, degrades to stock Google pins the moment someone sets `provider="google"` on
iOS. If custom marker imagery matters to your product, the Google provider on iOS is not currently
an option. There is no workaround at the JS layer — the descriptor arrives natively intact and is
dropped there.

Images are resolved by `MarkerImageLoader`, which caches into a static
`NSCache<NSString, UIImage>`. **The cache has no count limit** — it is bounded only by the system's
memory-pressure eviction. Android bounds the equivalent cache at 64 entries. A workload with
thousands of distinct marker images will therefore show different memory behaviour on the two
platforms.

`MarkerImageLoader` fetches `http://` and `https://` URIs through `URLSession.shared` with **no
host restriction**. Android applies an allowlist that blocks loopback, link-local, and private
addresses. The practical consequence: a marker image served from your dev machine at
`http://localhost:3000/pin.png` loads on iOS and is rejected on Android. See
[android.md](android.md#remote-marker-images-are-restricted).

## Threading

| Work | Queue |
| --- | --- |
| Clustering, viewport filtering, spatial index, diffing | `com.nitromaps.markerCompute`, QoS `.userInitiated` |
| Diff application to `MKMapView` / `GMSMapView` | Main |
| Remote image fetch | `URLSession` background, delivered to main |

State shared between the Nitro view and the adapter goes through `withStateLock`, so prop writes
from the JS side and reads from the compute queue do not race. The engines themselves never touch
map SDK objects, which is what makes off-main computation legal at all. See
[clustering.md](clustering.md#threading).

Refresh cadence differs between the two iOS providers, which is easy to miss because they share the
compute queue:

| | Apple | Google |
| --- | --- | --- |
| Live, during a gesture | 0.1 s timer (`MarkerRenderPipeline.liveRefreshInterval`) | **0.18 s** (`GoogleMapProviderAdapter.liveGestureRefreshInterval`) |
| Settle, after a gesture | 0.12 s debounce | 0.12 s debounce |
| Entering animations per diff | **uncapped** | 96 |
| Entering animations per **live** diff | uncapped | **24** (`liveGestureAnimationBudget`) |

The Apple provider having no budget at all is deliberate on MapKit's side rather than an oversight
here: `MapOverlayController.swift` contains no animation cap, and MapKit's `didAdd views:` animates
every newly added annotation. If entering animations cause a visible hitch on a large Apple refresh,
turning them off is the only lever — there is no threshold to lower.

Clustering cell size differs too: 64 pt under Apple, 96 pt under Google. See
[clustering.md](clustering.md).

## Cluster tap zoom

With no `onClusterPress` handler, Apple zooms to the members' bounding box scaled by **1.6×** with
a floor of **0.01°** per delta. Android uses a padding-based fit instead, so the resulting camera
differs between platforms. Do not write cross-platform assertions on the post-tap region.

## Lifecycle

`HybridMapView.prepareForRecycle()` invalidates the live-cluster timer and releases the adapter.
This runs when Fabric recycles the view and when the provider or `googleMapId` changes. If you see
memory grow across repeated mount/unmount cycles of a screen containing a map, that is a bug worth
reporting with an Allocations trace, not expected behaviour.

## Simulator

The iOS Simulator renders MapKit adequately but is not a performance instrument — it has none of a
device's GPU or thermal constraints, so a map that is smooth in the simulator can still drop frames
on hardware. Do not accept simulator frame rates as evidence. See
[performance.md](performance.md).

User location in the simulator requires Features → Location to be set to something other than
"None"; otherwise `showsUserLocation` renders nothing and `followsUserLocation` has nothing to
follow.
