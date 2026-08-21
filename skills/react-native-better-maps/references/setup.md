# Setup and installation

Verified against v1.1.0 (`b9a1783`). Every requirement is cited to where it is enforced.

## Requirements

| Requirement | Value | Enforced by |
| --- | --- | --- |
| React Native | **>= 0.78.0** | peer dependency |
| `react-native-nitro-modules` | **>= 0.35.0** | peer dependency |
| New Architecture | **Required** | Nitro HybridViews do not exist on Paper |
| iOS deployment target | **16.0** | `react-native-better-maps.podspec` |
| Android `minSdkVersion` | **24** | `android/gradle.properties` |
| Android `compileSdkVersion` / `targetSdkVersion` | **35** | `android/gradle.properties` |
| Android NDK | **27.1.12297006** | `android/gradle.properties` |
| Kotlin | **2.1.0** | `android/build.gradle` |
| Java source/target | **17** | `android/build.gradle` |
| Expo Go | **Not supported** | Native Nitro code cannot load in Expo Go |

Bundled native dependencies you do not install yourself:

| Dependency | Version | Platform |
| --- | --- | --- |
| `GoogleMaps` (CocoaPods) | unpinned — resolved by CocoaPods | iOS, **unconditional** |
| `MapKit`, `CoreLocation` | system frameworks | iOS |
| `com.google.android.gms:play-services-maps` | 19.0.0 | Android |
| `com.google.maps.android:android-maps-utils` | 3.8.2 | Android |

Note the iOS Google Maps SDK is an **unconditional** podspec dependency, because the library target
itself compiles `GoogleMapProviderAdapter.swift`. Your app links and ships it even if you only ever
use `provider="apple"`. That is a deliberate decision (`docs/adr/0002`), and it costs binary size.

## Install

```bash
# Expo
npx expo install react-native-better-maps react-native-nitro-modules

# bare React Native
npm install react-native-better-maps react-native-nitro-modules
cd ios && pod install && cd ..
```

Then rebuild the native app. This is not a JavaScript-only change:

```bash
npx expo prebuild --clean     # Expo, after adding the plugin
npx expo run:ios
npx expo run:android
```

If you are on bare React Native, build through Xcode and Gradle as usual.

## Do you need a Google Maps API key?

| Setup | Key needed? |
| --- | --- |
| iOS with `provider="apple"` (the default) | **No** |
| iOS with `provider="google"` | **Yes** — `GoogleMapsIosApiKey` in `Info.plist` |
| Android (always Google) | **Yes** — `com.google.android.geo.API_KEY` meta-data |

Get keys from the Google Cloud Console with the **Maps SDK for iOS** and **Maps SDK for Android**
APIs enabled. Prefer **separately restricted** iOS and Android keys (package name + SHA-1 on
Android; bundle id on iOS) rather than one unrestricted key shared across platforms. They are
separate API enablements as well; a key that works on one platform will not work on the other
unless you explicitly allow both.

## Expo config plugin

```json
{
  "expo": {
    "plugins": [
      [
        "react-native-better-maps",
        {
          "googleMapsApiKey": "AIza...",
          "locationPermission": "Show your position on the map"
        }
      ]
    ]
  }
}
```

| Option | Type | Effect |
| --- | --- | --- |
| `googleMapsApiKey` | `string` | Used for both platforms when the platform-specific keys are omitted |
| `iosGoogleMapsApiKey` | `string` | Overrides it for iOS → `GoogleMapsIosApiKey` in `Info.plist` |
| `androidGoogleMapsApiKey` | `string` | Overrides it for Android → `com.google.android.geo.API_KEY` meta-data |
| `locationPermission` | `string \| false` | The string becomes `NSLocationWhenInUseUsageDescription`; on Android it adds `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` |
| `locationAlwaysPermission` | `string \| false` | The string becomes `NSLocationAlwaysAndWhenInUseUsageDescription`; on Android it adds `ACCESS_BACKGROUND_LOCATION` |

Behaviour worth knowing:

- The permission options are **the description strings themselves**, not booleans. Passing `true`
  does nothing useful; pass the sentence the user will read.
- `locationAlwaysPermission` alone also grants the foreground permissions, and on iOS its string is
  reused for `NSLocationWhenInUseUsageDescription` if `locationPermission` was omitted.
- With no API keys and no permission strings, the plugin is a no-op on both platforms — it returns
  the config untouched. That is fine for an Apple-only iOS app.
- The plugin only writes keys and permissions. It does **not** change `minSdkVersion`, add Gradle
  dependencies, or configure anything else.
- It is wrapped in `createRunOncePlugin`, so listing it twice is harmless.

Apply it with a clean prebuild, because `Info.plist` and `AndroidManifest.xml` are written during
prebuild and an existing native directory keeps the old values:

```bash
npx expo prebuild --clean
```

## Bare React Native configuration

The config plugin does nothing for you here. Add the same values by hand.

**iOS** — `ios/<App>/Info.plist`:

```xml
<key>GoogleMapsIosApiKey</key>
<string>AIza...</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>Show your position on the map</string>
```

Note the key is `GoogleMapsIosApiKey`, a name specific to this library — not one of Google's own.
Native reads it via `Bundle.main.object(forInfoDictionaryKey:)` and calls
`GMSServices.provideAPIKey` the first time a Google map is created.

**Android** — `android/app/src/main/AndroidManifest.xml`, inside `<application>`:

```xml
<meta-data
  android:name="com.google.android.geo.API_KEY"
  android:value="AIza..." />
```

Plus the location permissions, if you use `showsUserLocation`:

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

Also raise your app's `minSdkVersion` to at least 24 in `android/build.gradle` if it is lower.

## Verifying the install

Confirm keys are **present** without printing their values — never log or echo the key string into
chat, CI logs, or screenshots.

```bash
node -p "require('react-native-better-maps/package.json').version"

# iOS: the pod is named NitroMaps, not the npm package name
grep -i -E 'NitroMaps|GoogleMaps' ios/Podfile.lock

# after prebuild: presence only (no values)
# iOS — exits 0 if GoogleMapsIosApiKey exists; does not print the string
/usr/libexec/PlistBuddy -c 'Print :GoogleMapsIosApiKey' ios/*/Info.plist >/dev/null 2>&1 && echo 'iOS GoogleMapsIosApiKey: present' || echo 'iOS GoogleMapsIosApiKey: missing'

# Android — key name present in the manifest, value redacted
grep -q 'com.google.android.geo.API_KEY' android/app/src/main/AndroidManifest.xml && echo 'Android geo.API_KEY meta-data: present' || echo 'Android geo.API_KEY meta-data: missing'
```

Then render a minimal map. If `onMapReady` fires, the native view is alive:

```tsx
import { MapView } from 'react-native-better-maps';

<MapView
  style={{ flex: 1 }}
  region={{ latitude: 37.78, longitude: -122.43, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
  onMapReady={() => console.log('map ready')}
/>
```

## Build and startup failure checklist

| Symptom | Cause | Fix |
| --- | --- | --- |
| `MapView` not found / HybridView missing | New Architecture off, Expo Go, or no native rebuild | Enable `newArchEnabled`, use a development build, rebuild |
| iOS: unresolved `NitroMaps` | Pods not installed | `cd ios && pod install` |
| iOS: `GoogleMaps` not found | Pod install ran before the package was added | Re-run `pod install`; the dependency comes from this package's podspec |
| iOS: deployment target error | Your app targets below 16.0 | Raise it; the podspec requires 16.0 |
| Android: `minSdkVersion 24 cannot be smaller` | App below 24 | Raise your app's `minSdkVersion` |
| Android: `Duplicate class com.google.android.gms...` | Another library pulls a conflicting Play Services Maps version | Align versions with a Gradle resolution strategy |
| **Grey map, no tiles, Google provider** | Missing or restricted API key | See below |
| Throws during render: `Map provider "…" is not supported` | `openstreetmap`, `mapbox`, or a provider not available on that platform | Only `apple` (iOS) and `google` are implemented |
| Nothing renders, no error | The view has no size | Give `MapView` `flex: 1` or explicit dimensions |

### The grey map

A grey or blank Google map is nearly always configuration, not code. Work down this list:

1. **Is the key present?** Confirm the key name exists without printing the value (see
   [Verifying the install](#verifying-the-install)). On iOS a missing key throws
   `react-native-better-maps: provider="google" on iOS requires GoogleMapsIosApiKey in the
   host app Info.plist.` — check the native log, because the JS side stays silent.
2. **Did prebuild run since you added the plugin?** `npx expo prebuild --clean`.
3. **Is the right API enabled** in Google Cloud — *Maps SDK for iOS* / *Maps SDK for Android*, not
   just "Maps JavaScript API"?
4. **Is billing enabled** on the Google Cloud project? Maps SDKs refuse to serve tiles without it.
5. **Are key restrictions correct?** An Android key restricted by package name also needs the
   signing certificate's SHA-1 fingerprint, and a debug build uses the debug keystore's fingerprint,
   not your release one. This is the single most common cause of "works on my machine".
6. **Read logcat.** Google's Android SDK logs the actual authorisation failure:

```bash
adb logcat | grep -i -E 'Google Maps|Authorization|API key'
```

The iOS Google SDK is quieter; look for `GMSServices` messages in the Xcode console.

There is one substituted value the native side guards against: a key that still looks like an
unexpanded build variable (`$(SOMETHING)`) is rejected as missing, so a misconfigured
`Info.plist` substitution produces the missing-key error rather than a confusing SDK failure.

## Simulator and emulator

| Environment | Works? |
| --- | --- |
| iOS Simulator, Apple provider | Yes |
| iOS Simulator, Google provider | Yes, with a valid key |
| Android emulator with Google Play services | Yes, with a valid key |
| Android emulator **without** Play services | No — Google Maps cannot initialise |
| Expo Go | No |

Performance on a simulator is not representative in either direction: the Simulator has no GPU
constraints your users have, and an emulator is usually far slower. Do all performance work on a
physical device in a release build — see [performance.md](performance.md).
