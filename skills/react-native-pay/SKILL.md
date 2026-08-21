---
name: react-native-pay
description: >-
  Expert guide to @gmisoftware/react-native-pay — Apple Pay and Google Pay for React
  Native through Nitro Modules, with a unified usePaymentCheckout hook and native
  ApplePayButton / GooglePayButton views. Use when adding Apple Pay or Google Pay,
  configuring merchant IDs, entitlements, or the Expo config plugin, when the pay
  button does not appear or Google Pay reports unavailable, when handling a payment
  token on a backend, when testing payments, and when reasoning about what this
  library does and does not do with money.
license: MIT
metadata:
  package: "@gmisoftware/react-native-pay"
  version: "0.0.16"
  commit: 2078fdda8bdef87b51d20039d7684a255f0baadc
  verified: "2026-08-21"
  repository: https://github.com/gmi-software/react-native-pay
  audience: library users and library contributors
  tags: react-native, payments, apple-pay, google-pay, passkit, wallet, nitro, expo, ios, android, checkout
---

# react-native-pay

Skill for **`@gmisoftware/react-native-pay`**. Presents the platform payment sheet (Apple Pay /
Google Pay) and returns a payment token to JavaScript.

**This library does not charge anyone.** It tokenizes. Everything after that is your backend.

Paths like `package/src/...` are relative to a **library checkout**, not this skills repo.

## Version verification

```text
Package:            @gmisoftware/react-native-pay
Version:            0.0.16
Commit:             2078fdda8bdef87b51d20039d7684a255f0baadc
Verification date:  2026-08-21
```

`0.0.x` — treat the API as unstable; re-verify against the installed copy.

```bash
npm view @gmisoftware/react-native-pay version
node -p "require('@gmisoftware/react-native-pay/package.json').version"
```

## When to use

- Adding Apple Pay or Google Pay to React Native / Expo
- Merchant IDs, entitlements, Expo config plugin
- Button missing / Google Pay unavailable
- Backend token handling and gateway choice
- Testing payments; judging whether an integration is safe to ship
- Changing Nitro specs / Swift / Kotlin / config plugin

## When NOT to use

| Situation | Instead |
| --- | --- |
| Card fields, PayPal, subscriptions billing | Your gateway's React Native SDK |
| Charging, refunds, webhooks, reconciliation | Gateway **server** SDK |
| Apple Pay on the web | Apple's web Payment Request docs |
| Wallet passes / loyalty cards | PassKit pass APIs |
| Showing backend decline inside the Apple Pay sheet | Not possible today — see limitations |

## Core architecture

```text
JS builds PaymentRequest
  → HybridPaymentHandler.startPayment(request)
  → OS sheet (PassKit / Google Pay)
  → encrypted token → PaymentResult
  → YOUR CODE → YOUR BACKEND → gateway charge
```

| Export | Role |
| --- | --- |
| `HybridPaymentHandler` | Availability + `startPayment` |
| `usePaymentCheckout` | Cart state, availability, status |
| `ApplePayButton` / `GooglePayButton` | Platform-exclusive native buttons |

`usePaymentCheckout` and the exported `HybridPaymentHandler` each call `createHybridObject` at
module scope — two native instances. Pick one; do not mix
([architecture.md](references/architecture.md)).

Full surface: [api.md](references/api.md). No subpath exports.

## Security boundary (read first)

| Question | Answer |
| --- | --- |
| Network requests in the library? | **No** |
| Stores credentials/tokens? | **No** |
| Contacts a payment gateway? | **No** (gateway name is OS config only) |
| Charges the card? | **No** |
| Raw token exposed to JS? | **Yes** — `PaymentResult.token.paymentData` |

```text
LIBRARY:  present sheet, return token
YOU:      send token to backend over TLS
BACKEND:  authorise/capture with SECRET keys
```

1. **Never put gateway secrets in the client** (source, `.env`, `app.config.js`, binary).
2. **Never trust client-reported amounts** — backend recomputes from its order record.
3. **Treat the token as short-lived** — do not log, persist, or send off-backend.
4. **Crash/analytics must not capture `paymentData`.**
5. **UI contract is `pending` → `succeeded` | `failed`** from the backend — not the sheet.
6. **Authorise the caller against the referenced order** before charging.

Details: [security.md](references/security.md).

## Critical behaviours

1. **Apple Pay sheet always reports success** — hardcoded `.success` after 1s; sheet success ≠
   payment succeeded ([apple-pay.md](references/apple-pay.md)).
2. **Google Pay defaults to TEST** — omitting `googlePayEnvironment` → test tokens that cannot
   charge; set `'PRODUCTION'` explicitly ([google-pay.md](references/google-pay.md)).
3. **`canMakePayments` differs** — iOS queries the device; Android is a string list check. Prefer
   `payServiceStatus().canMakePayments` on Android.
4. **Failures resolve, they do not reject** — check `result.success`, do not rely on `try/catch`.

## Problem → reference routing

| Problem | Start here |
| --- | --- |
| Safe to ship? Backend responsibilities | [security.md](references/security.md) |
| Token → gateway (Stripe / Braintree / Adyen) | security + [api.md](references/api.md) |
| TEST vs PRODUCTION Google Pay | [google-pay.md](references/google-pay.md) |
| **Setup / Expo / native wiring** | [setup.md](references/setup.md) |
| Apple Pay from scratch | setup → [apple-pay.md](references/apple-pay.md) |
| Google Pay from scratch | setup → [google-pay.md](references/google-pay.md) |
| Button missing / unavailable | [debugging.md](references/debugging.md) |
| Exact API / field names | [api.md](references/api.md) |
| Testing on simulator/device; release gate | [testing.md](references/testing.md) |
| Native architecture | [architecture.md](references/architecture.md) |
| Contributing to the library | [contributing.md](references/contributing.md) |

## Common mistakes

- Shipping Stripe/Braintree **secret** keys in the app
- Treating sheet success as a successful charge
- Omitting `googlePayEnvironment: 'PRODUCTION'`
- Gating Android UI on `canMakePayments` alone
- `try/catch` around `startPayment` for cancellation
- Using Expo Go (Nitro requires a development build)
- Logging or sending `PaymentResult` to crash/analytics
- Inventing APIs (`processPayment`, `stripeSecretKey`, `onPaymentCaptured` — none exist)
- Mixing `usePaymentCheckout` with the exported `HybridPaymentHandler.startPayment`

## Troubleshooting

1. Module missing / Expo Go → [setup.md](references/setup.md)
2. Availability / button → platform refs + [debugging.md](references/debugging.md)
3. Wrong money / token shape → [security.md](references/security.md)
4. Confusing sheet result → critical behaviours above

## Known limitations

| Limitation | Consequence |
| --- | --- |
| iOS sheet always succeeds | Backend decline cannot appear in Apple Pay UI |
| Android ignores custom `supportedNetworks` | Hardcoded Visa/MC/Amex/Discover |
| One payment at a time | Second `startPayment` overwrites the first |
| Buttons are platform-exclusive | Branch on `Platform.OS` |
| `transactionId` is a client UUID | Not a gateway idempotency key |
| No Expo Go | Development build required |
| Simulator/emulator tokens unusable | Sheet may open; live charge needs a signed device |

## Accuracy

Never invent configuration keys or claim "PCI compliant". Describe what crosses the boundary.
Jest mocks Nitro — green tests do not prove a payment works.
