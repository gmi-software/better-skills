# Native architecture

How the package is wired together, and where the two platforms diverge. Verified at v0.0.16
(`2078fdd`).

## Layers

```text
your app
  │
  ├─ usePaymentCheckout            src/hooks/usePaymentCheckout.ts      (JS)
  ├─ helpers, types                src/utils, src/types                (JS)
  │
  ├─ HybridPaymentHandler          src/index.ts → createHybridObject   (JS boundary)
  ├─ ApplePayButton                src/index.ts → getHostComponent
  └─ GooglePayButton               src/index.ts → getHostComponent
       │
       │  Nitro specs: src/specs/*.nitro.ts
       │  nitrogen output: nitrogen/generated/{ios,android,shared}
       ▼
  ios/HybridPaymentHandler.swift   ──▶ PassKit
  ios/HybridApplePayButton.swift   ──▶ PKPaymentButton
  android/.../HybridPaymentHandler.kt      ──▶ Google Play Services Wallet
  android/.../HybridGooglePayButton.kt     ──▶ com.google.android.gms.wallet.button.PayButton
```

There is **no hand-written payment logic in C++**. The only C++ file in the package is
`android/src/main/cpp/cpp-adapter.cpp`, a nine-line `JNI_OnLoad` that calls nitrogen's
`registerAllNatives()`. The `cpp/**` glob in `NitroPay.podspec` matches nothing. The only native
code you would ever edit is Swift and Kotlin.

## Nitro specs

Three specs, in `src/specs/`:

```ts
// PaymentHandler.nitro.ts
export interface PaymentHandler
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  payServiceStatus(): PayServiceStatus              // synchronous
  startPayment(request: PaymentRequest): Promise<PaymentResult>
  canMakePayments(usingNetworks: string[]): boolean // synchronous
}
```

```ts
// ApplePayButton.nitro.ts  →  HybridView<..., { ios: 'swift' }>
// GooglePayButton.nitro.ts →  HybridView<..., { android: 'kotlin' }>
```

The platform maps in those type parameters are the reason the buttons are platform-exclusive: no
Android implementation of `ApplePayButton` is generated, so rendering it on Android fails to find a
component.

`nitro.json` binds spec names to implementations:

| Spec | iOS | Android |
| --- | --- | --- |
| `PaymentHandler` | `HybridPaymentHandler` (Swift) | `HybridPaymentHandler` (Kotlin) |
| `ApplePayButton` | `HybridApplePayButton` (Swift) | — |
| `GooglePayButton` | — | `HybridGooglePayButton` (Kotlin) |

`cxxNamespace` is `["pay"]`, `iosModuleName` is `NitroPay`, `androidCxxLibName` is `NitroPay`, and
the Kotlin package is `com.margelo.nitro.pay`.

Regenerate bindings after editing a spec:

```bash
cd package && bun run specs   # tsc && nitrogen --logLevel="debug"
```

Commit the regenerated `nitrogen/generated` output — it is checked in and shipped in the npm
`files` array.

## Two HybridObject instances

```ts
// src/index.ts
export const HybridPaymentHandler =
  NitroModules.createHybridObject<PaymentHandler>('PaymentHandler')
```

```ts
// src/hooks/usePaymentCheckout.ts
const HybridPaymentHandler =
  NitroModules.createHybridObject<PaymentHandler>('PaymentHandler')
```

Both run at **module scope**, so they execute on import, before any component renders. Two
consequences:

- Importing anything from the package without the native module present throws at import time, not
  at call time. This is why a Jest suite needs a `react-native-nitro-modules` mock —
  see [testing.md](testing.md).
- The hook and the exported handler are **separate native instances**. On Android that means two
  instances each registering as an `ActivityEventListener`, and each with its own
  `currentEnvironment` and `paymentPromise`. Mixing the hook's `startPayment` with the exported
  `HybridPaymentHandler.startPayment` in one app is untested territory; pick one.

## Where the platforms diverge

The specs are shared; the semantics are not. This table is the single canonical list — the
per-platform detail lives in [apple-pay.md](apple-pay.md) and
[google-pay.md](google-pay.md).

| Behaviour | iOS | Android |
| --- | --- | --- |
| Native API | PassKit (`PKPaymentAuthorizationViewController`, deprecated) | Play Services Wallet (`PaymentsClient`) |
| `supportedNetworks` | Honoured | **Ignored** — four networks hardcoded |
| `merchantCapabilities` | Honoured (`3DS`/`EMV`/`Credit`/`Debit`) | Ignored |
| `canMakePayments()` | Real PassKit capability check | String comparison against a fixed list |
| `payServiceStatus()` | Instant, in-process | Blocks up to ~10s on two `isReadyToPay` awaits |
| `canSetupCards` | Always effectively `false` (empty networks array) | Real `isReadyToPay` with `existingPaymentMethodRequired: false` |
| Environment switch | None — Apple has no test environment flag | `googlePayEnvironment`, defaults to `TEST` |
| Authorization result | Hardcoded `.success` after 1s | Genuine `Activity` result code |
| `token.transactionIdentifier` | Real PassKit value | Fresh `UUID` |
| `result.transactionId` | Fresh `UUID` | Fresh `UUID` (a *different* one) |
| `token.paymentData` | base64 of PassKit's encrypted blob | Google's gateway token string |
| `paymentMethod.type` | Real (`credit`/`debit`/`prepaid`/`store`/`unknown`) | Always `unknown` |
| `paymentMethod.network` | Real | Real network name, but unknown values fall back to `visa` |
| `secureElementPass`, `billingAddress` | Populated when available | Always `null` |
| Billing/shipping contact fields | Honoured | Ignored |
| Logging | None at all | `Log.d` on every request |
| Button reuse | Rebuilt on every prop update | Early-returns when props are unchanged |
| Total row | Synthetic row added when >1 item | `totalPrice` computed; label always `"Total"` |

Everything in the "Ignored" rows type-checks and runs without error. That is the trap: identical
JavaScript produces materially different sheets.

## Threading and concurrency

**iOS.** `startPayment` immediately hops to `DispatchQueue.main.async`; PassKit requires main-queue
presentation. The delegate's success path schedules on main as well. `paymentCompletion`,
`currentPaymentRequest`, and `delegate` are plain stored properties with no synchronisation.

**Android.** `startPayment` runs on the caller's thread (the JS thread) up to
`AutoResolveHelper.resolveTask`, then the result arrives on the main thread via
`onActivityResult`. `payServiceStatus()` blocks the caller with `Tasks.await`.

Neither platform guards against overlapping payments. Both keep exactly one pending
completion/promise field, so:

```ts
// don't do this — the first promise never settles
void HybridPaymentHandler.startPayment(a)
void HybridPaymentHandler.startPayment(b)
```

Serialise in JavaScript. `usePaymentCheckout` gives you `isProcessing` for exactly this, but it
does **not** itself reject a concurrent call — it sets state and calls through.

## Build configuration

| | Value | File |
| --- | --- | --- |
| Android minSdk | 26 | `android/gradle.properties` |
| Android compileSdk / targetSdk | 36 | `android/gradle.properties` |
| Kotlin | 2.1.20 | `android/gradle.properties` |
| NDK | 29.0.14206865 | `android/gradle.properties` |
| AGP | 8.13.0 | `android/build.gradle` |
| Java source/target | 1.8 | `android/build.gradle` |
| Play Services Wallet | 19.3.0 | `android/build.gradle` |
| iOS platforms | `min_ios_version_supported`, visionOS 1.0 | `NitroPay.podspec` |
| Pod name | `NitroPay` | `NitroPay.podspec` |

`android/build.gradle` applies `fix-prefab.gradle`, a workaround that reorders prefab publication
relative to the native build. If you see prefab or CMake errors, confirm it is still applied.

Note that the podspec declares `:visionos => 1.0`, but there is no visionOS-specific code and
PassKit's availability there is untested by this package. Treat visionOS as unverified.

`GOOGLE_PAY_ENVIRONMENT=TEST` in `android/gradle.properties` is **dead configuration** — no source
file reads it. The environment comes from the request at runtime.

## What is not here

- No C++ implementation beyond the generated JNI entry point.
- No native unit tests (no XCTest, no Robolectric, no instrumentation).
- No Objective-C++ beyond nitrogen's generated autolinking.
- No `AndroidManifest.xml` content of its own — the library's manifest is empty.
- No `DIRECT` Google Pay tokenization; only `PAYMENT_GATEWAY`.
- No shipping-method or contact-selection callbacks on either platform.
