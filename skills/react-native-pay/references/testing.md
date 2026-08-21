# Testing

What can be tested automatically, what cannot, and what only a real device proves. Verified at
v0.0.16.

## The honest summary

| Layer | Exists? | What it proves |
| --- | --- | --- |
| JS unit tests (Jest) | **Yes** — helpers, hook, config plugin | JavaScript logic only |
| Native unit tests | **No** — no XCTest, no Robolectric, no instrumentation | — |
| Integration tests across the JS/native boundary | **No** | — |
| E2E | **No** — no Detox, no Maestro | — |
| Benchmarks | **No**, and none would be meaningful | — |
| Real-device payment validation | **Manual only** | Everything that matters |

A green CI run tells you the cart maths and the config plugin work. It tells you **nothing** about
whether a payment succeeds. For a payments library that gap is the whole story, so plan for manual
device validation as a release gate.

## Running the library's tests

From a checkout of the library:

```bash
cd package
bun install          # the repo's CI uses bun; npm/yarn work too
bun run test         # jest
bun run test:ci      # jest --runInBand --ci
bun run typecheck    # tsc --noEmit
bun run lint         # eslint --fix
```

Jest configuration (`package/jest.config.js`):

- preset `@react-native/jest-preset`, `testEnvironment: 'node'`
- `roots: ['<rootDir>/src']`, `testMatch: ['**/__tests__/**/*.test.ts']`
- `clearMocks: true`, plus a `jest.setup.js` that calls `jest.clearAllMocks()` after each test
- coverage excludes `src/**/*.nitro.ts` — spec files are type declarations with no runtime

Existing suites:

| File | Covers |
| --- | --- |
| `src/utils/__tests__/paymentHelpers.test.ts` | `createPaymentItem`, `calculateTotal`, `createPaymentRequest`, `formatAmount`, `parseAmount`, `isNetworkSupported`, `formatNetworkName` |
| `src/hooks/__tests__/usePaymentCheckout.integration.test.ts` | The hook, against a mocked Nitro module |
| `src/plugin/__tests__/{index,withApplePay,withGooglePay}.test.ts` | Entitlement, `Info.plist`, and manifest mutations |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, and `test:ci` on Ubuntu. There is **no native
build in CI** — nothing compiles the Swift or the Kotlin on a pull request. A change that breaks
iOS or Android compilation passes CI.

## Testing your own app

`HybridPaymentHandler` is created at module scope, so importing the package in a Jest environment
throws before your test body runs. Mock `react-native-nitro-modules`. This is the pattern the
library's own hook test uses:

```ts
const mockPayServiceStatus = jest.fn()
const mockStartPayment = jest.fn()

jest.mock('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject: jest.fn(() => ({
      payServiceStatus: (...args: any[]) => mockPayServiceStatus(...args),
      startPayment: (...args: any[]) => mockStartPayment(...args),
    })),
  },
}))

// import AFTER the mock
import { usePaymentCheckout } from '@gmisoftware/react-native-pay'
```

If you also render `ApplePayButton` or `GooglePayButton`, add `getHostComponent` to the mock — it
comes from the same module and is called at import time in `src/index.ts`.

**What the mock hides.** Everything that makes this library interesting:

- iOS returning a hardcoded success after a 1s delay.
- Google Pay's TEST-by-default environment.
- Android ignoring `supportedNetworks`.
- The blocking `payServiceStatus()` on Android.
- Whether the merchant identifier resolves.
- Whether the token your gateway receives is valid.

So mocked tests are useful for your cart logic, your error handling, and your UI states — and for
nothing about payments. Worth testing at this layer:

```ts
// failure resolves rather than rejecting — make sure your code handles that
mockStartPayment.mockResolvedValue({ success: false, error: 'Payment cancelled by user' })

// success shape, so your token-forwarding path is exercised
mockStartPayment.mockResolvedValue({
  success: true,
  transactionId: 'uuid',
  token: {
    paymentMethod: { type: 'unknown' },
    transactionIdentifier: 'uuid',
    paymentData: 'base64-or-gateway-json',
  },
})
```

Also mock a backend decline after sheet success and assert the UI lands on `failed`, not
"paid" — see the release gate below.

## Simulator and emulator

| Environment | Sheet opens? | Usable token? |
| --- | --- | --- |
| iOS Simulator | Yes, with Apple's test cards | **No** |
| Android emulator with Play Services | Yes, in `ENVIRONMENT_TEST` | **No** |
| Android emulator without Play Services | No — `isReadyToPay` fails | — |
| Expo Go | No — the module does not load | — |

Simulators are for layout, navigation, and state-machine work. Use them to confirm the button
renders, the sheet presents, and your cancellation path fires. Do not use them to conclude that a
payment works.

## Real-device validation

This is the part that actually gates a release.

### Apple Pay

Requirements: a physical device signed with a provisioning profile carrying the Apple Pay
capability, and a card provisioned in Wallet.

1. **Sandbox tester.** Create one in App Store Connect, sign into iCloud with it on the device, and
   add one of Apple's [sandbox test cards](https://developer.apple.com/apple-pay/sandbox-testing/).
   Real cards are never charged in sandbox.
2. **Run a payment** and capture `result.token.paymentData`.
3. **Decrypt it server-side** with your Payment Processing Certificate, or hand it to your gateway.
   This step is what proves the merchant ID and certificate are correctly paired — nothing on the
   device can tell you.
4. **Confirm your own UI** shows `pending` after the sheet closes, because the sheet already
   showed success before your backend was consulted ([security.md](security.md)).

Checks to run explicitly, since they are easy to miss:

- Cancel the sheet. Confirm you get `success: false` with `Payment cancelled by user`, and that
  your UI recovers.
- Dismiss it within ~0.75s. The error changes to
  `Payment sheet was dismissed before authorization` — same user intent, different string.
- Run with the app freshly launched, and while a modal is already presented, to exercise the root
  view controller lookup.

### Google Pay

Requirements: a physical device with Google Play Services and a card in Google Wallet.

1. **Join the Google Pay test group** and follow Google's
   [test card guidance](https://developers.google.com/pay/api/android/guides/resources/test-card-suite).
2. **Run in `TEST` first.** Confirm the sheet opens and the token parses.
3. **Then run in `PRODUCTION`** with real merchant and gateway IDs, and confirm your gateway
   accepts the token. This is the only way to catch the TEST-default trap before your users do.

Verify the environment from logcat rather than from your source:

```bash
adb logcat -s HybridPaymentHandler:V | grep -i environment
```

Checks worth making explicitly:

- Press back on the sheet → `Payment cancelled by user`.
- Airplane mode during `payServiceStatus()` → confirm it times out and your UI does not appear
  frozen for ten seconds.
- A card network outside Visa/Mastercard/Amex/Discover → confirm it is *not* offered, which is
  expected on Android.

### Cross-platform token handling

Run one payment on each platform and store both tokens. Your backend must handle:

- iOS: base64-encoded PassKit `paymentData`.
- Android: a gateway-specific JSON string.

A backend that assumes one format silently corrupts the other. This is the single most common
integration bug and it is invisible until a real device produces a real token.

## Release gate: backend decline after iOS sheet success

**Do not ship** until this path is proven on a physical iOS device (Android is worth running too,
but iOS is mandatory because the sheet cannot show failure).

Why it is a gate: iOS hardcodes
`PKPaymentAuthorizationResult(status: .success, …)` after authorization
([apple-pay.md](apple-pay.md#the-authorization-result-is-hardcoded)). The user always sees Apple's
success animation **before** your backend runs. If your app treats sheet success as paid, every
gateway decline becomes a silent lie.

Procedure:

1. Complete Apple Pay on device so the sheet shows its success tick and `result.success === true`.
2. Force the backend (or a test double behind the real endpoint) to **decline** the charge —
   insufficient funds simulation, deliberately invalid gateway credentials in a staging env, or an
   order the server rejects after authz.
3. Assert the app UI:
   - enters `pending` when the sheet closes (not "Payment successful");
   - then shows `failed` with a recoverable message when the backend declines;
   - does **not** mark the order paid, clear the cart as fulfilled, or unlock entitlement.
4. Repeat once with a backend **success** and confirm `pending` → `succeeded`.

If step 3 fails, the integration is not release-ready — fix the UI contract
([security.md](security.md#backend-ui-contract-pending-succeeded-failed)) before any other
polish.

Also confirm during this run that crash/analytics tooling does not receive `paymentData`
([security.md](security.md#crash-reporting-and-analytics-must-not-leak-tokens)).

## A minimal manual test matrix

| # | Case | Platform | Expected |
| --- | --- | --- | --- |
| 1 | Button renders with explicit height | both | Visible, tappable |
| 2 | Availability check | both | `payServiceStatus()` returns quickly and truthfully |
| 3 | Happy path | both | `success: true`, token present, gateway accepts |
| 4 | User cancels | both | `success: false`, `Payment cancelled by user` |
| 5 | No merchant ID configured | iOS | `No Apple Pay merchant identifier configured` |
| 6 | Missing production gateway fields | Android | `Failed to start payment: … required in PRODUCTION` |
| 7 | No card in wallet | both | Sheet offers to add one; your UI handles unavailability |
| 8 | **Backend declines after authorization** | **iOS required** (both ideal) | Sheet already said success; UI goes `pending` → `failed` |
| 9 | Double tap on the pay button | both | Only one sheet; second call does not orphan a promise |

Case 8 is the release gate above. Teams forget it, and it is guaranteed to happen in production
sooner or later.

## Adding tests to the library

New JS tests go in `src/**/__tests__/*.test.ts` and are picked up automatically.

Native tests would be a genuine contribution — there is no XCTest target and no Robolectric setup
today. If you add one, note that CI has no native build step, so the workflow needs extending as
well. Discuss the approach in an issue first;
see [contributing.md](contributing.md).
