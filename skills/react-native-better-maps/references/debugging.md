# Debugging

Runtime problems, organised by what you actually see. Build and installation failures are in
[setup.md](setup.md); performance is in [performance.md](performance.md).

Each entry gives symptoms, likely causes, what to inspect, and what a correct result looks like.

---

## The map is a blank grey rectangle

**Symptoms.** The view occupies the right space, but there is no map — grey or blank, sometimes with
a Google logo in the corner.

**Likely causes**, in order of how often they are the answer:

**1. Missing or invalid Google Maps API key.** The Google logo with no tiles is the signature.

*Inspect:*

```bash
# iOS: is the key present in the built Info.plist? (do not print the value)
/usr/libexec/PlistBuddy -c 'Print :GoogleMapsIosApiKey' ios/build/**/YourApp.app/Info.plist >/dev/null 2>&1 && echo 'present' || echo 'missing'

# Android: is the manifest meta-data present? Prefer logcat auth failures over dumping the key
adb logcat -s Google\ Maps\ Android\ API
```

*Expected:* `GoogleMapsIosApiKey` present on iOS; no `Authorization failure` in logcat on Android.
A logcat line reading `Ensure that the "Maps SDK for Android" is enabled` means the key exists but
the API is not enabled in the Google Cloud console, which is a different fix.

*Next:* [setup.md](setup.md#do-you-need-a-google-maps-api-key). Remember that after editing
`app.json` you must re-run `npx expo prebuild` — editing the config alone changes nothing in an
already-generated project.

**2. The view has no size.** A `MapView` with no explicit dimensions and no flexed parent lays out
at zero height and renders as nothing.

*Inspect:* give it `style={{ flex: 1 }}` inside a flexed parent, or a literal `height`. Toggle a
background colour on the container to confirm the box exists.

**3. Missing Google Play services on Android.** Only on emulators without a Play system image.

*Inspect:* `adb logcat -s GooglePlayServicesUtil`. *Next:* recreate the AVD with a Google Play
image.

---

## `Map provider "…" is not supported on …`

**Symptoms.** A JavaScript error at render, red screen or error boundary.

**Cause.** Exactly what it says. `src/providers.ts` allows `apple` and `google` on iOS, `google`
only on Android, and nothing anywhere else. `openstreetmap` and `mapbox` type-check but are not
implemented on either platform.

**Fix.** Omit `provider` and let each platform pick its default (`apple` on iOS, `google` on
Android), or branch on `Platform.OS`. See
[android.md](android.md#providers-that-do-not-exist-yet).

---

## The map stutters while panning

Almost always a React problem rather than a map problem, and the diagnosis order matters.

**Inspect first:** does your component re-render during the gesture?

```tsx
const renders = useRef(0);
renders.current += 1;
console.log('render', renders.current);
```

*Expected:* **two renders per gesture at most**, if you set state from the region callbacks. This
library's `onRegionChange` and `onRegionChangeComplete` each fire once per gesture, not per frame.

*If the count climbs continuously,* something in your own code is driving it — an animation, a
timer, a subscription, a parent list — because no map event fires at that rate. Find that first;
nothing else on this list will help until you do.

*If it is two per gesture but each one rebuilds thousands of descriptors,* that is the cost to
attack. [rendering.md](rendering.md) has both cases.

**If renders are stable,** measure before changing anything:
[performance.md](performance.md). Then, in order: enable clustering, stabilise the marker
array identity, disable entering animations.

---

## Markers vanish when I zoom out

**Not a bug.** With `clusteringEnabled` false and more than 500 markers, `MarkerViewportFilter`
caps how many render based on the visible latitude span — 2,000 at the closest zooms, down to 200
when `latitudeDelta ≥ 2.0`.

**Fix:** enable clustering. That is the supported way to keep everything represented at low zoom.
There is no prop that disables the cap. See
[clustering.md](clustering.md#viewport-filtering-clustering-off).

---

## Custom marker images never appear at all on iOS

**Symptoms.** Every marker is a stock red Google pin. `image`, `rotation`, `opacity`, and `anchor`
all appear to be ignored. Cluster badges look right. The same code is correct on Android.

**Check first:** are you on `provider="google"`? This is not a bug in your image loading.

**Cause.** `GoogleMapOverlayController.updateMarker` sets five fields on a single marker — position,
title, snippet, draggability, identity — then assigns `marker.icon = nil` and hardcodes
`groundAnchor = (0.5, 1)`. The descriptor arrives with your image intact and is discarded there.
Cluster badges take a different path (`clusterIcon(count:)`), which is why they still render and
make the failure look selective.

**Fix.** There is no JS-side workaround. Either use `provider="apple"` on iOS, or accept default
pins under Google. If you need identical custom pins on both platforms, Apple-on-iOS plus
Google-on-Android is the only combination that delivers them today. See
[ios.md](ios.md#the-google-provider-on-ios-ignores-every-marker-visual).

---

## A marker's image does not update

**Symptoms.** You change `image` on an existing marker and the old bitmap stays.

**Check first:** if *no* marker image has ever worked and you are on Google-iOS, read the previous
section instead — that is a different problem.

**Cause.** The diff's `renderVersion` hash covers id, coordinate, title, subtitle, `draggable`, and
`clusterable`. It does **not** cover `image`, `anchor`, `rotation`, `opacity`, or `flat`. A marker
that is retained across a diff — same `id`, same position — will not necessarily repaint when only
one of those fields changes.

**Fix.** Change the marker's `id` when its appearance changes (for example `pin-42:selected`). That
forces a remove-and-add and a guaranteed repaint. See
[clustering.md](clustering.md#diffing).

---

## A marker image loads on iOS but not on Android

**Cause.** Android validates remote marker image URIs and rejects loopback, link-local, and
site-local addresses along with `localhost`, `*.local`, and cloud metadata hosts. iOS applies no
such check. A dev-server URL like `http://localhost:3000/pin.png` or `http://10.0.2.2/pin.png` is
therefore iOS-only.

**Inspect:**

```bash
adb logcat | grep -i 'marker image'
```

*Expected:* a `Log.w` line naming the URI and the rejection reason.

**Fix.** Serve the image from a public host, or bundle it with `require()`. Full rule list in
[android.md](android.md#remote-marker-images-are-restricted).

---

## `showsScale` / `followsUserLocation` does nothing

Both are real props that silently do nothing on some platforms.

| Prop | Apple iOS | Google iOS | Android |
| --- | --- | --- | --- |
| `showsScale` | Works | No-op | No-op |
| `followsUserLocation` | MapKit `userTrackingMode = .follow` | KVO on `myLocation`, animates camera | Empty follow block — location layer only |

Android's `followsUserLocation` is an empty `if` block with an explanatory comment — the Google Maps
Android SDK has no follow mode. Drive the camera yourself from a location subscription. See
[android.md](android.md#props-with-no-effect-on-android).

---

## The user-location dot never appears on Android

**Cause.** `isMyLocationEnabled` is only set when `ACCESS_FINE_LOCATION` or
`ACCESS_COARSE_LOCATION` is already granted, and **the library never requests the permission**. A
manifest entry is not a grant on API 23+.

**Inspect:**

```bash
adb shell dumpsys package <your.package.name> | grep -A 20 'runtime permissions'
```

*Expected:* `android.permission.ACCESS_FINE_LOCATION: granted=true`.

**Fix.** Request it before setting `showsUserLocation`. There is no error callback; the prop just
has no visible effect.

---

## `customMapStyle` behaves differently across providers

**Cause.** Under the Google provider the JSON goes to the SDK and is applied in full. Under Apple,
`CustomMapStyleParser` extracts only POI visibility, transit visibility, and a flat-elevation hint,
and ignores everything else — colours, road weights, labels. Invalid JSON silently falls back to
the plain configuration rather than throwing.

There is no fix beyond expectation-setting; MapKit has no equivalent of Google's style system. See
[ios.md](ios.md#props-that-behave-differently-under-apple).

`mapType="terrain"` has the same shape of problem: it is identical to `standard` on Apple.

---

## `onPoiPress` never fires on iOS

**Cause.** Apple only makes POIs selectable while a handler is attached:
`mapView.selectableMapFeatures = onPoiPress == nil ? [] : .pointsOfInterest`. If the handler is
attached conditionally, or recreated in a way that briefly makes it undefined, selection is off.

Also check the payload: `category` can be `'unknown'` on iOS 16 and 17 for categories Apple only
added in 18. The raw value is in `rawCategory`. Treat `unknown` as normal.

On Android, `MapView.tsx` only forwards a Google POI event when both `name` and `placeId` are
non-null — a POI missing either is silently dropped.

---

## `animateCamera` seems to hang, or never arrives

**Symptoms.** You call `animateCamera` and the map creeps imperceptibly or appears frozen. The
promise does not settle for a very long time. Nothing errors.

**Cause.** `duration` is in **seconds**. Nothing in the type signature says so. Ported
`react-native-maps` code passes milliseconds, so `animateCamera(camera, 500)` requests an
eight-minute animation and does exactly that.

**Fix.** Divide by 1000: `animateCamera(camera, 0.5)`. Omitting the argument gives 0.25 s on all
three backends. Grep your codebase for `animateCamera` calls with a second argument above ~10 — none
of them are intentional. See [api.md](api.md#imperative-handle).

---

## The camera jumps back after I move it

**Cause.** `region` is a controlled prop. If you pass a `region` from state and never update it,
every re-render re-applies the same value and yanks the camera back.

**Fix.** Set `region` once for the initial camera and then leave it alone, driving later moves with
`animateCamera` / `setCamera` on the ref. If you must keep it in state, update it from
`onRegionChangeComplete`, never from `onRegionChange`. See
[rendering.md](rendering.md).

---

## Changing `googleMapId` remounts the map

**Not a bug.** Android applies the map ID in `GoogleMapOptions` at `MapView` construction and the
setter throws if it is changed afterwards, so `HybridMapView` recreates the adapter instead. The
camera resets and overlays are rebuilt.

**Fix.** Treat `googleMapId` as a mount-time constant. If it genuinely must change, re-apply your
camera after the remount.

Note that a cloud map ID and `customMapStyle` are mutually exclusive — that is Google's rule, not
this library's.

---

## Native logs, in general

Android logs under the tag `NitroMaps`:

```bash
adb logcat -s NitroMaps Google\ Maps\ Android\ API GooglePlayServicesUtil
```

At v1.1.0 that tag is used in exactly two places, both in `MarkerIconFactory` — a rejected remote
marker image URI and a failed image load. There is no general-purpose tracing to turn on.

**The iOS side logs nothing.** There is no `os_log`, `Logger`, or `NSLog` anywhere in `ios/`, so
there is no log stream to filter and no verbose mode to enable. Debugging iOS behaviour means
attaching Xcode's debugger and setting breakpoints in the Swift sources, or using Instruments. If
you are already building from source, adding a temporary `print` in the adapter is the pragmatic
move.

For a crash, symbolicate before reading: Android native stack traces from `adb logcat` need
`ndk-stack`, and iOS crash reports need the matching dSYM. An unsymbolicated trace attached to an
issue is rarely actionable.

---

## Filing a useful issue

Include, at minimum: library version, React Native version, Expo SDK version if applicable,
platform and OS version, physical device or simulator, provider, marker count, whether clustering
is on, whether the build is debug or release, and a minimal reproduction. "The map is slow" with
none of that cannot be acted on. See [contributing.md](contributing.md).
