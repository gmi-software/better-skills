# Providers

Platform and map-SDK differences. Verified against `src/ProviderConstants.ts`, `src/MapView.tsx`, `src/decorateMapComponent.ts`, `docs/installation.md`, and `plugin/src` at **1.29.0**.

**"Works on iOS" does not mean it works the same on Android.** Check the `@platform` comments on the prop you are about to use.

## What `provider` actually selects

```ts
provider?: 'google' | undefined  // PROVIDER_GOOGLE = 'google', PROVIDER_DEFAULT = undefined
```

| Platform | `provider` omitted / default | `provider={PROVIDER_GOOGLE}` |
| --- | --- | --- |
| Android | Google Maps | Google Maps (same native map) |
| iOS | MapKit (`AIRMap` / `RNMapsMapView`) | Google Maps (`AIRGoogleMap` / `RNMapsGoogleMapView`) |

There is no `'apple'` / `'mapkit'` / `'mapbox'` provider value. Do not invent one.

Android has no MapKit. Asking for Apple Maps on Android is meaningless.

## iOS: MapKit vs Google Maps

MapKit is the default pod (`react-native-maps/Maps`). It needs no Google key.

Google Maps on iOS is opt-in:

1. `pod 'react-native-maps/Google', :path => '../node_modules/react-native-maps'`
2. `[GMSServices provideAPIKey:@"…"]` as the **first** call in `didFinishLaunchingWithOptions` (docs)
3. iOS deployment target as required by the Google Maps SDK (installation docs: iOS 14+ for Google; podspec platform is iOS 15.1)
4. `NSLocationWhenInUseUsageDescription` — required by the Google Maps iOS SDK even if you never read location

Optional Podfile pins (must be set **before** the Google pod): `$RNMapsGoogleMapsVersion`, `$RNMapsGoogleMapsUtilsVersion`. Defaults in the podspec at 1.29.0: GoogleMaps `9.4.0`, Google-Maps-iOS-Utils `6.1.0`.

If Google pods are missing, `HAVE_GOOGLE_MAPS` is 0 and `PROVIDER_GOOGLE` is a runtime failure.

`customMapStyle`, `kmlSrc`, `Heatmap`, indoor APIs, `onPoiClick`, `showsMyLocationButton` are Google-oriented. `followsUserLocation`, `showsScale`, `cacheEnabled`, `appleLogoInsets`, `cameraZoomRange` are Apple-oriented. See [api-patterns.md](api-patterns.md).

Camera height: MapKit uses `altitude` (meters); Google uses `zoom`. For a cross-platform `camera` object, set **both** (library docs).

## Android: always Google Maps

Manifest:

```xml
<meta-data
  android:name="com.google.android.geo.API_KEY"
  android:value="YOUR_KEY"/>
```

Play Services maps `>= 18.0.0` (installation docs). Emulators need a Google Play / Google APIs image.

Android-only levers: `liteMode`, `googleRenderer` (`LATEST` default, or `LEGACY`), `zoomControlEnabled`, `toolbarEnabled`, `moveOnMarkerPress`, `poiClickEnabled`.

`googleMapId` enables cloud-based map styling on Google (iOS Google + Android).

## Expo

Config plugin (`app.plugin.js` / `plugin/src`), documented for **react-native-maps ≥ 1.22** and **Expo SDK ≥ 53**:

```json
{
  "expo": {
    "plugins": [
      [
        "react-native-maps",
        {
          "iosGoogleMapsApiKey": "YOUR_IOS_KEY",
          "androidGoogleMapsApiKey": "YOUR_ANDROID_KEY"
        }
      ]
    ]
  }
}
```

Plugin keys are only `iosGoogleMapsApiKey` and `androidGoogleMapsApiKey`. Do not invent other plugin options.

What the plugin does:

- Android: writes `com.google.android.geo.API_KEY` on the main application
- iOS: Info.plist `GMSApiKey`, AppDelegate `GMSServices.provideAPIKey`, Podfile Google subspec — **only when** `iosGoogleMapsApiKey` is set

No iOS Google key → Apple Maps path (no Google pod). That is why an Expo iOS build can "have a map" while Android is blank: Android always needs a key.

After changing the plugin, rebuild native (`npx expo prebuild` / a development build). Editing `app.json` does not patch an already-built binary.

Do not claim Expo Go cannot show any map. Apple Maps can work without a Google key. **Custom Google keys and the Google iOS subspec require a native rebuild** — they are not something you hot-reload into Expo Go. If Google tiles are blank in Expo, treat it as a key / rebuild / Play Services problem first.

`react-native-maps` is a native module. A JS-only Expo snack without native maps will not render it.

## Permissions

- `showsUserLocation`: runtime location permission first; otherwise it fails silently (docs). iOS usage string required.
- Tiles need network (`INTERNET` on Android).
- Google Maps iOS: location usage string even without the user dot.

## Blank, grey, or missing maps

| What you see | Typical cause |
| --- | --- |
| View is empty / zero height | Missing `style` size |
| Google logo, no tiles | API key, billing, or Maps SDK not enabled |
| Android grey, iOS fine | Android key / Play Services / `google_maps_api.xml` |
| iOS crash with Google provider | Google subspec / `provideAPIKey` missing |
| Works in Expo iOS, not Android | No `androidGoogleMapsApiKey` or no rebuild |

Do not "fix" this with clustering or `React.memo`.

## Performance is provider-specific

Custom view markers are especially expensive on Android (bitmap snapshots). Apple MapKit annotation views are a different cost model. Compare the **same dataset** on both devices before concluding the library is "slow on Android". Details: [performance.md](performance.md).
