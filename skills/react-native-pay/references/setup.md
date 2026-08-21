# Setup and installation

Verified against v0.0.16 (`2078fdd`). Every requirement below is cited to where it is actually
enforced, not merely documented.

## Requirements

| Requirement | Value | Enforced by |
| --- | --- | --- |
| React Native | New Architecture required | Nitro Modules; no version floor is declared (`react-native: "*"`) |
| `react-native-nitro-modules` | `>=0.36.0` | peer dependency |
| `expo` | `>=53.0.0` | peer dependency — needed for the config plugin, not at runtime |
| Android minSdk | **26** | `android/gradle.properties` |
| Android compileSdk / targetSdk | **36** | `android/gradle.properties` |
| Google Play Services Wallet | `19.3.0` | `android/build.gradle` |
| iOS deployment target | RN's `min_ios_version_supported` | `NitroPay.podspec` — it inherits rather than pinning |
| Expo Go | **Not supported** | Native Nitro code cannot load in Expo Go |

The package declares no `dependencies` at all, and `react` / `react-native` peers are both `"*"`.
The real floor is whatever your Nitro Modules version needs.

## Install

```bash
# Expo
npx expo install @gmisoftware/react-native-pay react-native-nitro-modules

# bare React Native
npm install @gmisoftware/react-native-pay react-native-nitro-modules
cd ios && pod install && cd ..
```

Then rebuild the native app — this is not a JavaScript-only change.

## Expo configuration

The config plugin has exactly two options:

```json
{
  "expo": {
    "plugins": [
      [
        "@gmisoftware/react-native-pay",
        {
          "merchantIdentifier": "merchant.com.yourcompany.app",
          "enableGooglePay": true
        }
      ]
    ]
  }
}
```

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `merchantIdentifier` | `string \| string[]` | none | Adds the `com.apple.developer.in-app-payments` entitlement **and** the `ReactNativePayApplePayMerchantIdentifiers` key in `Info.plist` |
| `enableGooglePay` | `boolean` | **`false`** | Adds `com.google.android.gms.wallet.api.enabled` meta-data to `AndroidManifest.xml` |

Two failure modes are built into those defaults:

- **Omit `merchantIdentifier`** and the Apple Pay half of the plugin returns the config untouched.
  No entitlement, no `Info.plist` key, and at runtime `startPayment` fails with
  `No Apple Pay merchant identifier configured`.
- **Omit `enableGooglePay`** and it defaults to `false`, at which point the plugin *actively
  removes* the wallet meta-data. Google Pay then reports itself unavailable.

Apply the plugin and rebuild:

```bash
npx expo prebuild --clean
npx expo run:ios
npx expo run:android
```

`--clean` matters here: entitlements and manifest meta-data are written during prebuild, so an
existing `ios/` or `android/` directory will keep the old values.

### What the plugin does not do

- No Gradle or `minSdk` changes.
- No Apple Pay **Payment Processing Certificate** — that is a manual Apple Developer step.
- No Google Pay merchant registration.
- No gateway configuration.
- Nothing for bare React Native; there you edit the native projects yourself.

## Apple Pay setup (iOS)

Four steps, in order. Three are outside this library.

1. **Create a Merchant ID.** Apple Developer → Certificates, Identifiers & Profiles → Identifiers
   → Merchant IDs. The format is `merchant.<reverse-dns>`.
2. **Create a Payment Processing Certificate** for that Merchant ID. Your gateway supplies the
   CSR, or you generate one and give the gateway the private key. This is what allows the token
   to be decrypted server-side.
3. **Enable the Apple Pay capability** on your app ID. The config plugin writes the entitlement;
   the capability must exist on the provisioning profile or the build fails to sign.
4. **Pass the Merchant ID.** Either via the plugin (recommended) or per-request with
   `applePayMerchantIdentifier`.

Native resolution order for the merchant identifier — worth knowing because it contradicts the
type's own JSDoc:

```text
1. request.applePayMerchantIdentifier, if a non-empty string
2. Info.plist ReactNativePayApplePayMerchantIdentifiers — first non-empty entry
3. otherwise: startPayment fails with "No Apple Pay merchant identifier configured"
```

It never reads the entitlement directly. Details: [apple-pay.md](apple-pay.md).

## Google Pay setup (Android)

1. **Enable `enableGooglePay: true`** in the plugin. Without it, nothing else matters.
2. **Register with Google Pay** at the Google Pay & Wallet Console to obtain a merchant ID, and
   complete their integration review before going live.
3. **Get gateway values** from your payment provider: the gateway name (`'stripe'`,
   `'braintree'`, `'adyen'`, …) and your gateway merchant ID.
4. **Pass all four Google fields** on the request for production:

```ts
googlePayEnvironment: 'PRODUCTION',
googlePayMerchantId: '...',
googlePayGateway: 'stripe',
googlePayGatewayMerchantId: '...',
```

In `TEST`, the last three are optional and fall back to the placeholders `'example'` /
`'exampleGatewayMerchantId'`. In `PRODUCTION` all three are required and their absence throws —
surfaced to JavaScript as `Failed to start payment: ...`.

`googlePayEnvironment` defaults to `TEST` when omitted, silently. See
[google-pay.md](google-pay.md).

There is a `GOOGLE_PAY_ENVIRONMENT=TEST` entry in the library's `android/gradle.properties`. It is
**dead configuration** — no Kotlin or Java source reads it. Changing it does nothing.

## Verifying the install

```bash
# the version actually installed
node -p "require('@gmisoftware/react-native-pay/package.json').version"

# native pieces present
ls node_modules/@gmisoftware/react-native-pay/ios
ls node_modules/@gmisoftware/react-native-pay/android/src

# iOS: the pod is named NitroPay, not the npm package name
grep -i nitropay ios/Podfile.lock

# Android: entitlement / manifest results after prebuild
grep -A2 in-app-payments ios/*/*.entitlements
grep wallet.api.enabled android/app/src/main/AndroidManifest.xml
```

Then, in the app:

```ts
import { HybridPaymentHandler } from '@gmisoftware/react-native-pay'

console.log(HybridPaymentHandler.payServiceStatus())
```

If that returns an object rather than throwing, the native module is linked. On Android, call it
off the initial render path — it blocks (see [google-pay.md](google-pay.md)).

## Build failure checklist

| Symptom | Cause | Fix |
| --- | --- | --- |
| `PaymentHandler` not found / HybridObject missing | New Architecture off, Expo Go, or no native rebuild | Enable New Arch, use a development build, rebuild |
| Throws on **import**, before any call | `HybridPaymentHandler` is created at module scope | Native module missing — this is the same problem as above, surfacing earlier |
| iOS: unresolved `NitroPay` | Pod not installed | `cd ios && pod install` |
| iOS: code signing fails after adding the plugin | Apple Pay capability missing from the provisioning profile | Add the capability in the Developer portal, regenerate the profile |
| Android: prefab / CMake errors | Nitro native library linkage | The package ships `android/fix-prefab.gradle`, which reorders prefab publication after the `.so` build — confirm it is applied |
| Android: `minSdkVersion 26 cannot be smaller` | Your app targets below 26 | Raise your app's `minSdkVersion` |
| Jest: throws on import | No Nitro mock | See [testing.md](testing.md) |

## What a successful build does not prove

Linking proves the module loads. It does not prove a payment works. Both platforms need a real
signed device with a real card in the wallet before any of this is verified — see
[testing.md](testing.md).
