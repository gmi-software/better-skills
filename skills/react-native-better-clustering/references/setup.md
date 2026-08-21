# Setup / installation

Source: `package/package.json` peers, library `README.md`, `docs/docs/setup/installation.md`, example `package.json`, podspec / Android gradle. Paths relative to the **library** checkout.

Native architecture detail: [architecture.md](architecture.md). Platform crash deltas: [debugging.md](debugging.md).

## Requirements (verified)

| Requirement | Detail |
| --- | --- |
| React Native | **0.78+** with **New Architecture** enabled (Nitro) |
| Package version | `react-native-better-clustering@1.0.0` (verify against your lockfile) |
| Expo | Development build only — **Expo Go cannot load** this Nitro module |
| Map rendering | `react-native-maps` required for the root `MapView` export; headless `/engine` can run without maps |

### Peer dependencies (`package/package.json`)

| Peer | Constraint | Notes |
| --- | --- | --- |
| `react` | `*` | |
| `react-native` | `*` | New Arch |
| `react-native-nitro-modules` | `*` | Required — HybridObject runtime |
| `react-native-reanimated` | `>=4.0.0` | Cluster bubble fade (`ClusterMarker`) |
| `react-native-worklets` | `>=0.6.0` | Required peer; **not imported** by library source — Reanimated 4 needs it |
| `react-native-maps` | `*` | `peerDependenciesMeta.optional: true`, but **required** for the main `MapView` export |

Example app pins (not peer floors): `react-native-maps@^1.26.0`, `react-native-reanimated@^4.5.0`, `react-native-worklets@^0.10.0`.

## Bare React Native

```bash
npm install react-native-better-clustering react-native-nitro-modules react-native-maps react-native-reanimated react-native-worklets
cd ios && pod install && cd ..
```

Rebuild the native app after install.

Add the Worklets Babel plugin **last** in `babel.config.js` (library README / installation docs):

```js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: ['react-native-worklets/plugin'],
}
```

Confirm New Architecture is on (`newArchEnabled=true` / RN New Arch project setting), then rebuild.

### Android Google Maps key

Blank Android map is almost always the Maps API key, not clustering. Add to `AndroidManifest.xml`:

```xml
<meta-data
  android:name="com.google.android.geo.API_KEY"
  android:value="YOUR_GOOGLE_MAPS_API_KEY"/>
```

## Expo

```bash
npx expo install react-native-better-clustering react-native-nitro-modules react-native-maps react-native-reanimated react-native-worklets
```

`babel-preset-expo` adds the Worklets plugin — no Babel change needed for Expo.

Add the `react-native-maps` config plugin to `app.json` / `app.config.*`. At **react-native-maps 1.29.0** the plugin accepts only these two keys — there is no `googleMapsApiKey` option:

```json
{
  "expo": {
    "plugins": [
      [
        "react-native-maps",
        {
          "iosGoogleMapsApiKey": "YOUR_IOS_GOOGLE_MAPS_API_KEY",
          "androidGoogleMapsApiKey": "YOUR_ANDROID_GOOGLE_MAPS_API_KEY"
        }
      ]
    ]
  }
}
```

Then:

```bash
npx expo prebuild --clean
npx expo run:ios
# or
npx expo run:android
```

This package has **no** Expo config plugin of its own; maps key comes from the `react-native-maps` plugin (or bare manifest).

## iOS install bits

Clustering is **C++**. Podspec `NitroMapCluster` compiles `package/cpp/**` and nitrogen-generated bridge files. No hand-written Swift clusterer.

After adding the JS package: `cd ios && pod install` and a native rebuild. Expo: `expo prebuild` then `expo run:ios`.

Unresolved `NitroMapCluster` / HybridObject registry → missing `pod install` or Old Architecture.

Podspec does **not** set explicit C++ optimization flags — Debug vs Release follows Xcode project settings ([performance.md](performance.md)).

## Android install bits

Clustering is **C++** via CMake (`libNitroMapCluster.so`). Kotlin is a load stub plus generated OnLoad.

Gradle library (`package/android/build.gradle`):

- `minSdk 24`, `compile/targetSdk 36`, NDK `27.1.12297006` (`gradle.properties`)
- `IS_NEW_ARCHITECTURE_ENABLED` from root `newArchEnabled`
- CMake `-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON` (16 KB page devices)
- Debug native: `-O1 -g`; release: `-O2`
- `fix-prefab.gradle` forces prefab to include the `.so`

Packaging excludes `libc++_shared.so` and other RN/Nitro `.so`s so the app does not double-pack them.

Prefab without the `.so` → app cmake cannot link `NitroMapCluster`. Missing ABI → check `reactNativeArchitectures` vs the device.

## Failure checklist

| Symptom | Check |
| --- | --- |
| Module / HybridObject missing | New Arch off; Expo Go; forgot native rebuild / `pod install` |
| Blank Android map | Google Maps API key / Maps SDK enabled |
| Reanimated / worklets runtime errors | Worklets Babel plugin missing (bare); peers not installed |
| Link / cmake / prefab errors | Android bits above + [architecture.md](architecture.md) |
| iOS unresolved `NitroMapCluster` | `pod install` + rebuild |

## Verifying the install

```bash
# version actually installed
rg '"version"' node_modules/react-native-better-clustering/package.json

# native pieces present (required for the engine to build)
ls node_modules/react-native-better-clustering/cpp
ls node_modules/react-native-better-clustering/nitrogen
```

Then render a small MapView with Marker children. If clusters appear when zoomed out and split when zoomed in, the native engine is loaded.

## What setup does not prove

A successful `pod install` / `assembleDebug` proves the module links. It does **not** prove map FPS or clustering performance — measure on a **release** (or release-like) **device** build ([performance.md](performance.md)).
