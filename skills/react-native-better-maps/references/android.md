# Android

What differs on Android, verified against `android/src/main/java/com/margelo/nitro/nitromaps/` at
v1.1.0 (`b9a1783`).

## SDK levels and dependencies

| | Value | Where |
| --- | --- | --- |
| `minSdkVersion` | **24** | `android/gradle.properties` (`NitroMaps_minSdkVersion`) |
| `compileSdkVersion` / `targetSdkVersion` | 35 | same file |
| NDK | 27.1.12297006 | same file |
| Kotlin | 2.1.0 | `android/build.gradle` |
| Java | 17 | `android/build.gradle` |
| Namespace | `com.margelo.nitro.nitromaps` | `android/build.gradle` |

Dependencies: `react-android`, `react-native-nitro-modules`,
`com.google.android.gms:play-services-maps:19.0.0`, and
`com.google.maps.android:android-maps-utils:3.8.2`.

That last one is **declared but never imported** — no Kotlin source references
`com.google.maps.android`, and clustering is the library's own `MarkerClusterEngine` rather than the
utility library's `ClusterManager`. Worth knowing for two reasons: it inflates your dependency graph
for nothing, and if you are debugging clustering, `ClusterManager` documentation does not apply
here. See [clustering.md](clustering.md).

Each of those Gradle properties can be overridden from your app's root `gradle.properties`, which
is the supported way to raise `minSdkVersion` or pin a different `compileSdkVersion`.

## One provider only

`resolveMapProvider` lists `['google']` for Android. That is both the only supported value and the
default.

Passing `provider="apple"` on Android throws from JavaScript before any native code runs:

```text
Map provider "apple" is not supported on android. Supported providers: google.
```

This is a plain `Error` thrown during render, so it surfaces as a red screen or your error
boundary, not a native crash. If you render the same screen on both platforms, either omit
`provider` entirely (each platform picks its own default) or branch on `Platform.OS`.

`openstreetmap` and `mapbox` exist in the `MapProvider` union but are not implemented on either
platform; the same JS guard rejects them before they reach native. See
[Providers that do not exist yet](#providers-that-do-not-exist-yet).

## Props with no effect on Android

Two props type-check, apply cleanly, and do nothing.

**`showsScale`.** `GoogleMapProviderAdapter` stores it in `_showsScale` and never reads it again —
the setter has no body beyond the assignment. The Google Maps Android SDK exposes no scale-bar
control, so there is nothing to wire it to. It is also a no-op under the Google provider on iOS;
only Apple MapKit implements it. See [ios.md](ios.md).

The types try to stop you: `GoogleMapViewProps` declares `showsScale?: never`, so writing
`<MapView provider="google" showsScale />` is a type error. **The guard does not apply when you
omit `provider`.** `ExistingDefaultProviderProps` allows `showsScale?: boolean`, because on iOS the
default provider is Apple and the prop is real there. Cross-platform code that omits `provider` and
sets `showsScale` therefore compiles and works on iOS while doing nothing on Android.

**`followsUserLocation`.** The Android implementation is explicitly empty:

```kotlin
if (hasFineLocationPermission || hasCoarseLocationPermission) {
  map?.isMyLocationEnabled = true
  if (_followsUserLocation == true) {
    // Google Maps does not have a direct follow mode; host apps can animate camera separately.
  }
}
```

The comment is the whole implementation. `showsUserLocation` works — the blue dot appears — but
the camera will not track the user. If you need follow behaviour on Android, subscribe to location
yourself and drive `animateCamera` from your own code.

This is **Android-only**. Apple iOS uses MapKit `userTrackingMode = .follow`. Google iOS follows
via KVO on `GMSMapView.myLocation` (`GoogleMapProviderAdapter.swift`). See
[debugging.md](debugging.md#showsscale--followsuserlocation-does-nothing).

## EdgePadding: max() vs per-edge

Android has **three** `EdgePadding` consumers. They do not all collapse.

`EdgePadding.toPaddingPixels()` returns `max(top, right, bottom, left)` as one integer
(`EdgePadding+Pixels.kt`).

| Call site | Source | Behaviour |
| --- | --- | --- |
| `fitToCoordinates` | `GoogleMapProviderAdapter.fitToCoordinates` | `padding.toPaddingPixels()` → `CameraUpdateFactory.newLatLngBounds(bounds, paddingPx)` |
| Controlled `region` (`applyRegion`) | `GoogleMapProviderAdapter.applyRegion` | `_mapPadding.toPaddingPixels()` → same single-int bounds padding |
| `mapPadding` prop (`applyMapPadding`) | `GoogleMapProviderAdapter.applyMapPadding` | per-edge `setPadding(left, top, right, bottom)` |

`toPaddingInsets()` in the same file preserves each edge but has **no call sites** at v1.1.0.

iOS converts the struct to a real `UIEdgeInsets` on both providers, so all four edges are
respected there.

The mismatch is easy to hit with `fitToCoordinates` (and with setting `region` while
`mapPadding` is asymmetric):

```tsx
// iOS: 320 dp reserved at the bottom only.
// Android fitToCoordinates / applyRegion: 320 used as a single bounds padding (max of the four).
mapRef.current?.fitToCoordinates(coords, { top: 24, right: 24, bottom: 320, left: 24 });
```

`mapPadding={{ bottom: 320, left: 24, right: 24, top: 24 }}` **does** inset the Google Map
per-edge on Android. Do not "fix" bottom-sheet `mapPadding` by making it symmetric.

For `fitToCoordinates` / `region` camera updates, either branch on `Platform.OS` and pass
symmetric padding on Android sized to the space you actually need, or fit to an unpadded
bounding box and offset the camera yourself.

## User location requires a runtime permission

`applyUserLocationSettings` calls `ContextCompat.checkSelfPermission` for `ACCESS_FINE_LOCATION`
and `ACCESS_COARSE_LOCATION` and only enables `isMyLocationEnabled` if at least one is granted.

**The library does not request the permission for you.** The Expo config plugin adds the manifest
entries, and manifest entries are not a grant on API 23+. If the blue dot never appears, check
whether you ever prompted:

```bash
adb shell dumpsys package <your.package.name> | grep -A 20 'runtime permissions'
```

Request it with `expo-location`, `PermissionsAndroid`, or whatever your app already uses, then set
`showsUserLocation`. There is no callback to tell you the permission check failed — the prop simply
has no visible effect.

## `googleMapId` is fixed at adapter creation

`GoogleMapOptions().apply { mapId(...) }` is applied when the `MapView` is constructed, and the
setter enforces that afterwards:

```kotlin
check(normalizeGoogleMapId(value) == googleMapIdAtCreation) {
  "googleMapId is applied when the Google MapView is created. Recreate the adapter to change it."
}
```

Changing the prop on a mounted map remounts the native view. Cloud-based styling requires a map ID
and disables `customMapStyle` (Google's own rule, not this library's) — pick one approach.

## Remote marker images are restricted

`MarkerIconFactory` validates every `http`/`https` marker image URI before fetching. Android
rejects, iOS does not. Rejections are logged with `Log.w` and the marker keeps its default icon —
there is no JS-visible error.

Rejected:

| Rule | Examples |
| --- | --- |
| Non-`http(s)` scheme, missing scheme, missing host | `ftp://…`, `//host/x.png` |
| URI contains user info | `https://user:pass@host/x.png` |
| `localhost`, `*.localhost`, `*.local` | `http://localhost:3000/pin.png` |
| `metadata.google.internal`, `metadata.goog` | cloud metadata endpoints |
| Resolves to loopback, any-local, link-local, or site-local | `http://10.0.2.2/pin.png`, `http://192.168.1.5/pin.png` |

The address check resolves the host with `InetAddress.getByName` on the loading thread. Numeric
literals are checked before the fetch as well as during it.

**This is why a marker image served from your dev machine works on iOS and not on Android.** It is
a deliberate guard against pointing marker fetches at internal addresses, not a bug. For local
development, serve images from a public host or bundle them as assets.

Timeouts are 10 s for both connect and read. Fetches run on a dedicated executor, and results are
posted to the main thread via a `Handler`. A generation counter per marker discards results whose
marker has since been given a different icon, so a slow fetch cannot overwrite a newer one.

## Icon caching

Two `LruCache` instances, both capped at **64 entries**: one for `BitmapDescriptor`, one for
resolved sizes. iOS uses an unbounded `NSCache` instead. If you render more than 64 distinct marker
images in a session, Android will re-decode evicted entries; iOS will not. That difference shows up
as Android-only churn under memory profiling.

## Lifecycle

The adapter owns a raw `com.google.android.gms.maps.MapView` and drives its lifecycle by hand:

- `mapView.onCreate(null)` at construction — **no saved instance state is restored**, so a
  configuration change rebuilds the map rather than restoring it.
- `onResume` / `onPause` on attach and detach from the window.
- `onDestroy` in `prepareForRecycle`.

If the map goes black after backgrounding, or after a rotation, that path is where to look; capture
`adb logcat` around the transition before filing anything.

## Threading and cadence

| Work | Thread |
| --- | --- |
| Spatial index, clustering, viewport filter, diffing | Background |
| Diff application to `GoogleMap` | Main |
| Marker image loading | Dedicated executor, delivered to main |

Refresh cadence: **180 ms throttle** during a live gesture, **120 ms debounce** after it settles.
Entering animations are capped at **96 markers per diff** and **24 per live diff** — a tighter
budget than iOS, because marker churn on the Google backend is more expensive per item. See
[performance.md](performance.md).

## Cluster tap zoom

Without an `onClusterPress` handler, Android animates `newLatLngBounds` to the members' bounds with
**72 dp** of padding. iOS scales the bounding box by 1.6× with a 0.01° floor instead. The results
are visually similar and numerically different — do not assert equality across platforms.

## Providers that do not exist yet

`MapProvider` is `'apple' | 'google' | 'openstreetmap' | 'mapbox'`, and `MapViewPropsForProvider`
has full prop types for all four, including `never`-typed exclusions for the unimplemented ones.
There are even type tests for them in `type-tests/provider-props.ts`.

None of that means they work. Native has explicit rejections — `error("Map provider … is not
supported on Android.")` in Kotlin, `UnavailableMapProviderAdapter` in Swift — and the JS guard in
`src/providers.ts` throws before either is reached.

**Treat the type union as forward-looking, not as a compatibility statement.** Only `apple` (iOS)
and `google` (both) render a map at v1.1.0.

## Emulator

The Android emulator is usable for correctness and useless for performance: it is typically far
slower than real hardware, in ways that do not scale predictably. A pan that stutters on the
emulator may be perfectly smooth on a mid-range phone, and a threshold tuned against emulator
numbers will be wrong.

The emulator needs a Google Play system image for the Maps SDK to work at all. On an image without
Play services the map renders blank with a `GooglePlayServicesUtil` warning in logcat:

```bash
adb logcat -s GooglePlayServicesUtil Google\ Maps\ Android\ API
```

The host machine is reachable at `10.0.2.2` from the emulator, but see
[Remote marker images are restricted](#remote-marker-images-are-restricted) — that address is
site-local and will be rejected for marker images.
