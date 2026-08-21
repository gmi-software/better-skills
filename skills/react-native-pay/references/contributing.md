# Contributing to the library

For changes to `@gmisoftware/react-native-pay` itself. Repository:
<https://github.com/gmi-software/react-native-pay>. Verified at v0.0.16 (`2078fdd`).

## Repository layout

A bun/yarn workspace monorepo with three workspaces:

```text
package/    the published npm package
example/    an Expo app for manual verification
docs/       a Docusaurus site, deployed to gh-pages on push to main
```

```text
package/
├── src/
│   ├── index.ts                  public exports; creates the HybridObject
│   ├── specs/*.nitro.ts          Nitro specs — the API contract
│   ├── types/                    hand-written TypeScript types
│   ├── hooks/usePaymentCheckout.ts
│   ├── utils/paymentHelpers.ts
│   └── plugin/                   Expo config plugin
├── ios/                          Swift implementation
├── android/src/main/java/com/margelo/nitro/pay/   Kotlin implementation
├── nitrogen/generated/           generated bindings — CHECKED IN
├── nitro.json                    spec → implementation binding
├── NitroPay.podspec
└── android/{build.gradle,gradle.properties,CMakeLists.txt,fix-prefab.gradle}
```

## Getting set up

```bash
git clone https://github.com/gmi-software/react-native-pay.git
cd react-native-pay
bun install                # CI uses bun; yarn is the declared packageManager

cd package
bun run typecheck
bun run test
bun run lint
```

Running the example app:

```bash
# from the repo root
bun run ios        # expo run:ios
bun run android    # expo run:android
```

Both are `expo run:*`, so they build a development client. Expo Go cannot load this package.

Docs site:

```bash
bun run docs:start
bun run docs:build
```

## The change loop

Which files you touch depends on the layer:

| Change | Files |
| --- | --- |
| A new method or field on the API | `src/specs/*.nitro.ts` → regenerate → both native implementations |
| A type only used in JS | `src/types/` |
| Hook or helper behaviour | `src/hooks/`, `src/utils/` + tests |
| iOS behaviour | `ios/*.swift` |
| Android behaviour | `android/src/main/java/com/margelo/nitro/pay/*.kt` |
| Expo configuration | `src/plugin/*` + tests |
| Build requirements | `android/gradle.properties`, `android/build.gradle`, `NitroPay.podspec` |

### Changing a Nitro spec

```bash
cd package
bun run specs        # tsc && nitrogen --logLevel="debug"
```

Then:

1. Commit the regenerated `nitrogen/generated/` output — it is checked in and shipped.
2. Implement on **both** platforms, or the build breaks on the one you skipped. A spec declared
   `{ ios: 'swift'; android: 'kotlin' }` requires both.
3. Rebuild the example app natively. `bun run typecheck` will not catch a missing native
   implementation.

If a member should be platform-exclusive, express that in the spec's platform map — as
`ApplePayButton` (`{ ios: 'swift' }`) and `GooglePayButton` (`{ android: 'kotlin' }`) do — rather
than by leaving one side unimplemented.

### Synchronous vs asynchronous

`payServiceStatus()` and `canMakePayments()` are declared synchronous in the spec. On Android,
`payServiceStatus()` therefore blocks the JS thread on two `Tasks.await` calls. Any new
synchronous member is subject to the same constraint: if the native side can block, do not declare
it synchronous.

## Local verification checklist

CI runs lint, typecheck, and Jest on Ubuntu — **there is no native build in CI**. Nothing compiles
your Swift or Kotlin on a pull request. That makes local verification non-optional:

```bash
cd package
bun run lint
bun run typecheck
bun run test:ci
bun run specs        # if you touched a spec; commit the output
```

Then, for any native change:

- Build and run the example app on a **real iOS device** and a **real Android device**.
- Complete a payment on each and confirm the token still parses.
- Confirm cancellation still resolves with `success: false`.

Say in the pull request which devices and OS versions you used. There is no automation that can
substitute for it.

## Areas that need work

These are visible in the source and are good, well-scoped contributions. Each is documented
elsewhere in this skill.

**The hardcoded iOS success result.** `PaymentDelegate` calls
`completion(PKPaymentAuthorizationResult(status: .success, errors: nil))` unconditionally after a
1s delay, commented `// Simulate payment processing`. Doing this properly means letting JavaScript
report the backend outcome before the sheet resolves — an API change (a completion callback, or a
second promise) plus a migration path. Discuss the design in an issue first.
[apple-pay.md](apple-pay.md#the-authorization-result-is-hardcoded)

**`supportedNetworks` ignored on Android.** `GooglePayRequestBuilder.createAllowedCardNetworks()`
returns a fixed array. Mapping `request.supportedNetworks` through to it, with a fallback for
unmappable names, is a contained change.
[google-pay.md](google-pay.md#supportednetworks-is-ignored)

**`canMakePayments` on Android does not query the device.** It compares strings against
`PaymentConstants.SUPPORTED_NETWORKS`. A real implementation would call `isReadyToPay` — which
means the member can no longer be synchronous, so this is an API change.
[google-pay.md](google-pay.md#canmakepayments-does-not-check-the-device)

**The TEST-by-default environment.** `determineEnvironment` maps `null` to `ENVIRONMENT_TEST`. Any
fix here is a breaking change, so it needs a decision on whether to require the field, warn, or
default to `PRODUCTION`.
[google-pay.md](google-pay.md#the-test-environment-default)

**`canSetupCards` on iOS.** Derived from `canMakePayments(usingNetworks: [])`, which no card can
satisfy, so it is effectively always `false`. Passing the request's networks would make it
meaningful. [apple-pay.md](apple-pay.md#availability)

**Concurrency.** Both platforms hold a single pending promise/completion, so an overlapping
`startPayment` orphans the first. Rejecting the second call would be an improvement over silently
dropping the first.

**`shippingMethods` is dead.** Present in `PaymentRequest`, read by neither platform. Either
implement it or remove it from the type.

**Logging on Android.** `Log.d(..., "Payment request: $request")` is not gated on
`BuildConfig.DEBUG`. Gating it, or redacting merchant identifiers, is a small change.
[security.md](security.md#logging)

**No native tests.** No XCTest target, no Robolectric. Adding either would also require extending
CI with a native build job. [testing.md](testing.md)

**Documentation inaccuracies in the source.** `PaymentRequest.applePayMerchantIdentifier`'s JSDoc
says iOS resolves the identifier from entitlements; native reads `Info.plist`. The same claim
appears in `UsePaymentCheckoutConfig`. Both are one-line fixes.

## Conventions

Prettier settings come from `package/package.json`: single quotes, no semicolons, two-space
indent, `trailingComma: 'es5'`, `quoteProps: 'consistent'`. ESLint extends `@react-native` plus
`prettier`. `bun run lint` applies fixes.

Kotlin lives in `com.margelo.nitro.pay` — that namespace comes from Nitro's conventions, not from
GMI, and changing it would break the generated bindings.

Releases run through `release-it` (`bun run release` in `package/`).

## Opening a pull request

State plainly:

1. Which layer changed — JS, spec, iOS, Android, plugin.
2. Whether `nitrogen/generated` was regenerated.
3. Which real devices you tested on, with OS versions.
4. Whether the change is breaking, and for whom. At `0.0.x` the API is unstable, but published
   behaviour changes still deserve a note.
5. For anything touching the security boundary — logging, token handling, what crosses to JS —
   say so explicitly and explain why it is still safe.

Report a suspected vulnerability privately through the repository's GitHub Security Advisories
rather than in a public issue or pull request.
