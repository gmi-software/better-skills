# Migrating from `react-native-maps`

The realistic migration path, and the parts that do not map. Everything in the
`react-native-better-maps` column is verified against `package/src` at v1.1.0. The
`react-native-maps` column describes that library's public API and is **not** verified against this
repository — check it against your installed version before relying on it.

The upstream repository has a marker-level mapping table in its README and an open roadmap item for
a full migration guide, so treat this as the more complete version of a document the maintainers
intend to write.

## Decide whether to migrate at all

Migrate if you want native clustering without a JS clustering library, you are already on the New
Architecture, and your markers are bitmaps.

**Do not migrate yet if** any of these is true:

- You render custom React views inside markers (`<Marker><MyBadge /></Marker>`). Not supported. See
  [Custom marker views](#custom-marker-views).
- You use callouts, info windows, or `<Callout>`. There is no equivalent.
- You need heatmaps, tile overlays, `UrlTile`, `Geojson`, or `<Overlay>` images. Not implemented.
- You need `takeSnapshot`, `pointForCoordinate`, `coordinateForPoint`, or `addressForCoordinate`.
  The imperative handle has five methods and none of them are these.
- You support React Native below 0.78, or the old architecture. Both are hard requirements — see
  [setup.md](setup.md).

A partial migration is reasonable: `react-native-better-maps` for the dense marker screen where
clustering matters, `react-native-maps` for a detail screen with custom callouts.

## The two structural changes

Almost all migration effort comes from these, not from renaming props.

**1. Overlays are descriptors, not views.** `<Marker>` renders `null`; `MapView` collects its props
into a `MarkerDescriptor[]` and sends the array as one prop. The JSX form is a convenience over the
same array. This is why there is no `children` support, no `<Callout>`, and no ref on an individual
marker — there is no view to hold a ref to. See [architecture.md](architecture.md).

**2. `region` is fully controlled, and there is no `initialRegion`.** In `react-native-maps` you
typically pass `initialRegion` and let the map own the camera afterwards. Here, `region` is a
controlled prop with no uncontrolled counterpart.

Copying the `region={region} onRegionChange={setRegion}` habit across is less catastrophic here
than it would be in `react-native-maps`, because the region callbacks fire once per gesture rather
than per frame and the `region` observer ignores values that arrive mid-gesture. It still costs you
a full subtree re-render and a full descriptor rebuild on every pan, which is the difference
between smooth and hitchy at a few thousand markers.

Read [rendering.md](rendering.md) before you write the camera wiring. The short version
is to set `region` once for the initial camera and drive later moves through the ref.

## Component and prop mapping

### `MapView`

| `react-native-maps` | `react-native-better-maps` | Notes |
| --- | --- | --- |
| `provider={PROVIDER_GOOGLE}` | `provider="google"` | Plain string; no exported constant |
| `provider={PROVIDER_DEFAULT}` | omit `provider` | Defaults to `apple` on iOS, `google` on Android |
| `initialRegion` | `region` | No uncontrolled variant; see above |
| `region` | `region` | Same shape: `latitude`, `longitude`, `latitudeDelta`, `longitudeDelta` |
| `camera` / `initialCamera` | `camera` | Also `getCamera` / `setCamera` / `animateCamera` on the ref |
| `mapType` | `mapType` | `'terrain'` is not distinct on Apple — [ios.md](ios.md) |
| `customMapStyle` | `customMapStyle` | Google style JSON; only a subset is honoured on Apple |
| `showsUserLocation` | `showsUserLocation` | Requires a granted runtime permission on Android |
| `followsUserLocation` | `followsUserLocation` | Camera follow on Apple iOS and Google iOS; **no-op follow on Android** — [android.md](android.md) |
| `showsCompass` | `showsCompass` | |
| `showsScale` | `showsScale` | Apple provider only; no-op elsewhere |
| `scrollEnabled`, `zoomEnabled`, `rotateEnabled`, `pitchEnabled` | same names | |
| `mapPadding` | `mapPadding` | |
| `onMapReady` | `onMapReady` | |
| `onPress` | `onPress` | |
| `onLongPress` | `onLongPress` | |
| `onPoiClick` | `onPoiPress` | Renamed. Provider-discriminated payload |
| `onRegionChange` | `onRegionChange` | **Different firing behaviour.** Fires once at gesture start here, not per frame |
| `onRegionChangeComplete` | `onRegionChangeComplete` | Once at gesture end. Programmatic moves emit neither event |
| `googleMapId` | `googleMapId` | Android: fixed at creation, remounts if changed |
| — | `clusteringEnabled` | No equivalent; this is the reason to migrate |
| — | `markers`, `polylines`, `polygons`, `circles` | Bulk descriptor props |
| `liteMode`, `minZoomLevel`, `maxZoomLevel`, `showsTraffic`, `showsBuildings`, `showsIndoors`, `toolbarEnabled`, `loadingEnabled`, `moveOnMarkerPress`, `kmlSrc` | — | Not implemented |

### Imperative handle

The whole surface is five methods:

| `react-native-maps` | `react-native-better-maps` |
| --- | --- |
| `animateToRegion(region, duration)` | `animateCamera(camera, duration)` — **duration is seconds, not ms** |
| `animateCamera(camera, { duration })` | `animateCamera(camera, duration)` — positional, and **seconds** |
| `setCamera(camera)` | `setCamera(camera)` |
| `getCamera()` | `getCamera()` |
| `getMapBoundaries()` → `{ northEast, southWest }` | `getVisibleRegion()` → `{ nearLeft, nearRight, farLeft, farRight }` |
| `fitToCoordinates(coords, { edgePadding, animated })` | `fitToCoordinates(coords, padding, animated)` — positional |
| `fitToElements`, `fitToSuppliedMarkers` | — |
| `takeSnapshot`, `pointForCoordinate`, `coordinateForPoint`, `addressForCoordinate` | — |

**The duration unit change is the easiest thing to get wrong in this whole migration.**
`react-native-maps` takes milliseconds; this library takes seconds on every backend. A mechanical
port of `animateToRegion(region, 500)` becomes an eight-minute animation that looks like a hung map
rather than a wrong number. Divide every duration by 1000, and grep for leftovers.

`getVisibleRegion` is the closest thing to `getMapBoundaries`, but it is not a drop-in: it returns
the four corners of the visible quadrilateral rather than an axis-aligned bounding box, which is
strictly more information under rotation and tilt. Derive a bounding box yourself if that is what
your code expects.

Every method returns a promise here. Awaiting them is how you sequence camera moves; there is no
completion callback.

### `Marker`

The upstream README's own mapping table, expanded:

| `react-native-maps` | `react-native-better-maps` | Notes |
| --- | --- | --- |
| `coordinate` | `coordinate` | |
| `identifier` | `id` | **Required here.** Used as the diff key |
| `title`, `description` | `title`, `subtitle` | `description` → `subtitle` |
| `image={require(...)}` | `image={require(...)}` | Also accepts `{ uri }`. **Ignored on Google-iOS** |
| `anchor={{ x, y }}` | `anchor={{ x, y }}` | **Ignored on Google-iOS** |
| `centerOffset` | `centerOffset` | **Ignored on Google-iOS** |
| `rotation` | `rotation` | **Ignored on Google-iOS** |
| `flat` | `flat` | **Ignored on Google-iOS** |
| `opacity` | `opacity` | **Ignored on Google-iOS** |
| `draggable` | `draggable` | |
| `onPress` | `onMarkerPress` on `MapView` | Handler lives on the map, receives the marker id |
| `tracksViewChanges` | — | No equivalent, and none needed — see below |
| `children` (custom view) | — | Not supported |
| `<Callout>` | — | Not supported |
| `pinColor` | — | Not implemented; use an `image` |
| `zIndex` | — | Not in `MarkerDescriptor`; draw order is the SDK's |
| — | `clusterable` | Set `false` to exempt a marker from clustering |

**If you are migrating an iOS app that used `react-native-maps` with the Google provider, read that
column carefully.** Six of the marker props map across by name and then do nothing, because
`GoogleMapOverlayController` sets `icon = nil` on every non-cluster marker. Your custom pins become
stock Google pins with no error. Either target the Apple provider on iOS or accept default pins —
details in [ios.md](ios.md#the-google-provider-on-ios-ignores-every-marker-visual).

**`tracksViewChanges` has no counterpart, and that is the point.** In `react-native-maps` it exists
because marker contents are React views that must be re-snapshotted; leaving it `true` is a classic
performance trap. Here markers are descriptors and bitmaps, so there is nothing to track. If you
were setting `tracksViewChanges={false}` as an optimisation, simply delete it.

### `Polyline`, `Polygon`, `Circle`

Same names, and the geometry props (`coordinates`, `center`, `radius`) carry over. Every overlay
needs an `id` here. Colour props take CSS-style strings rather than `processColor` values. Check
each prop against [api.md](api.md) rather than assuming parity — the sets are
similar but not identical.

## Custom marker views

The blocker, and worth being precise about.

`react-native-maps` supports `<Marker>{arbitraryJSX}</Marker>` by hosting a live `UIView` on MapKit
and snapshotting to a bitmap on Google Maps. `react-native-better-maps` v1.1.0 ignores `children`
entirely.

The repository has an ADR for adding this (`docs/adr/0004-custom-view-markers.md`), proposing a
separate `<MarkerView>` component with a hybrid live/snapshot strategy. **Its status is "Proposed"
and no such component exists in v1.1.0** — do not write code against it.

Your options today:

1. **Render to a bitmap yourself** with something like `react-native-view-shot`, cache the result,
   and pass it as `image`. Works, and keeps you on the fast bulk path.
2. **Pre-generate images** for the finite set of marker appearances you actually need (five pin
   colours, three sizes) and pick per marker. Cheapest and fastest.
3. **Absolutely-position React views over the map**, converting coordinates yourself. There is no
   `pointForCoordinate`, so you would need your own projection maths. Rarely worth it.
4. **Stay on `react-native-maps`** for that screen.

## Migrating from `react-native-maps` + a JS clustering library

If your current stack is `react-native-maps` with `react-native-clusterer`,
`react-native-map-clustering`, or Supercluster wired up by hand, the clustering layer is deleted
rather than ported.

Delete the clustering library, pass your full marker array to `markers`, and set
`clusteringEnabled`. Clustering then happens on a native background thread inside the map, and the
JS thread stops being involved in it at all.

Things that do not carry over:

- **`radius`, `minPoints`, `minZoom`, `maxZoom`, `extent`, `nodeSize`.** There is no configuration.
  Cell size, badge radii, and the merge gap are compile-time constants. See
  [clustering.md](clustering.md#there-is-no-minpoints-and-no-radius-prop).
- **Property aggregation (`clusterProperties`, `map`/`reduce`).** No equivalent.
  `onClusterPress(markerIds, coordinate)` gives you the member ids and you aggregate in JS.
- **`getLeaves`, `getChildren`, `getClusterExpansionZoom`.** No cluster hierarchy is exposed. You
  get the member id list on tap and nothing else.
- **Custom cluster renderers.** Badge appearance is native and not themeable beyond
  `clusterEnteringAnimation`.

If you depend on aggregated cluster properties or expansion-zoom queries, that is a genuine feature
gap, not a translation exercise. Note also that
`react-native-better-clustering` is a different library with a different engine — it is not the
clustering used here, and its API does not apply. Load that skill only when clustering on
`react-native-maps`.

## A migration order that works

1. **Get one map rendering** with no overlays: install, configure keys, confirm `onMapReady` fires.
   [setup.md](setup.md).
2. **Fix the camera wiring** before adding markers, so you are not debugging jank and correctness at
   once. [rendering.md](rendering.md).
3. **Port markers as descriptors**, using the bulk `markers` prop rather than JSX children if you
   have more than a few dozen. Give every marker a stable `id`.
4. **Enable clustering** and delete the JS clustering library.
5. **Port other overlays.**
6. **Handle the gaps** — callouts, custom views, missing imperative methods — deliberately, rather
   than discovering them at the end.
7. **Measure on a device** before concluding anything about performance.
   [performance.md](performance.md).
