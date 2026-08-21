# Security boundary and backend responsibilities

Where this library's job ends and yours begins. Every claim here was verified by reading the
package source at v0.0.16 (`2078fdd`).

## What the library does with money: nothing

Grepping the entire package — `src/`, `ios/`, `android/src/` — for network, persistence, and
credential APIs returns no matches:

| Searched for | Found |
| --- | --- |
| `URLSession`, `NSURLConnection` (iOS network) | none |
| `OkHttp`, `Retrofit`, `HttpURLConnection` (Android network) | none |
| `fetch`, `axios` (JS network) | none |
| `Keychain`, `KeyStore` (secure storage) | none |
| `UserDefaults`, `SharedPreferences` (storage) | none |

**SOURCE FACT:** the library cannot charge a card, cannot reach a gateway, and cannot persist
anything. It presents an OS sheet and returns a token.

The `googlePayGateway` value you pass (`'stripe'`, `'braintree'`, `'adyen'`, …) is not a client
the library calls. It is a string placed in the Google Pay `tokenizationSpecification` so that
**Google** encrypts the card data with your gateway's public key. The library never sees a
decrypted card number, and neither do you.

## The division of responsibility

```text
┌─ LIBRARY ────────────────────────────────────────────────┐
│  Build a native payment request                          │
│  Present the OS payment sheet                            │
│  Receive the OS-issued encrypted token                   │
│  Resolve it to JS as PaymentResult                       │
└──────────────────────────────────────────────────────────┘
                          │  PaymentResult.token
                          ▼
┌─ YOUR APP ───────────────────────────────────────────────┐
│  POST the token to YOUR backend over TLS                 │
│  Send an order ID — never a client-computed amount       │
│  Show pending → succeeded | failed from YOUR backend     │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─ YOUR BACKEND ───────────────────────────────────────────┐
│  Authenticate the caller against the referenced order    │
│  Look up the authoritative amount from the order         │
│  Call the gateway with a SECRET key                      │
│  Authorise / capture, handle 3DS, store the result       │
│  Reconcile via webhooks                                  │
└──────────────────────────────────────────────────────────┘
```

## The three hard rules

### 1. Secret keys never ship to the device

Anything in the app bundle is extractable. This includes `.env` files consumed at build time,
values inlined by Babel, and strings in `app.config.js` — all of them end up in the binary.

| Value | Client? | Why |
| --- | --- | --- |
| `googlePayGateway` (e.g. `'stripe'`) | Yes | Public identifier |
| `googlePayGatewayMerchantId` | Yes | Public, gateway-issued |
| `googlePayMerchantId` | Yes | Public, from Google Pay Business Console |
| `applePayMerchantIdentifier` | Yes | Public, in your entitlements anyway |
| Gateway **secret** key (`sk_live_…`) | **Never** | Can create charges |
| Apple Pay **merchant private key** / payment processing certificate | **Never** | Belongs on the server that decrypts tokens |
| Webhook signing secret | **Never** | Server-side verification only |

If an integration needs a secret on the client to work, the integration is wrong.

### 2. The amount is decided by the backend

`PaymentResult` arrives from a device the user controls. A modified client can send any amount.

```ts
// WRONG — the client decides what to charge
await fetch('/api/pay', {
  method: 'POST',
  body: JSON.stringify({ token: result.token, amount: total }),
})

// RIGHT — the backend looks up what this order costs
await fetch('/api/pay', {
  method: 'POST',
  body: JSON.stringify({ token: result.token, orderId }),
})
```

The same applies to currency and to any discount or tax the client computed. The device's
`paymentItems` exist to render the sheet, not to authorise a charge.

### 3. Tokens are short-lived credentials

`PaymentResult.token.paymentData` is the encrypted payload:

- **iOS** — base64 of PassKit's `PKPaymentToken.paymentData`.
- **Android** — the Google Pay `tokenizationData.token` string, typically gateway-specific JSON.

Do not log it, do not write it to disk or async storage, do not put it in analytics or crash
reports, and do not send it anywhere but your own backend. Tokens are single-use and expire.

Because the two platforms produce different formats, your backend must branch on which one it
received. Send the platform alongside the token rather than sniffing the payload.

## Crash reporting and analytics must not leak tokens

`paymentData` is a credential. Any path that serialises `PaymentResult`, `result.token`, or a
request body into a third-party pipeline can exfiltrate it:

| Sink | Risk |
| --- | --- |
| Crash reporters (Sentry, Crashlytics, Bugsnag, …) | `JSON.stringify(result)`, breadcrumbs, "last API request", attachment dumps |
| Analytics / session replay | Event properties, form-field capture, network logging |
| Remote logging | `console` bridges, structured logs that include the full result |
| Error wrappers | `new Error(JSON.stringify(result))` or attaching `result` to a custom error |

Hard rules for the client:

1. **Never attach `PaymentResult` or `token` to a crash or analytics event.** Log only
   `success`, a coarse error class, `orderId`, and platform.
2. **Scrub before capture.** If a global error handler or network middleware records payloads,
   strip `paymentData` / `token` / Authorization bodies before they leave the device.
3. **Do not put the token in URL query strings, deep links, or navigation params** — those land in
   screenshots, OS logs, and analytics referrer fields.
4. **Do not persist the token** in AsyncStorage, MMKV, files, or Redux/persisted state "for retry".
   Hold it in memory only until the backend acknowledges, then drop it.

Treat a token in a crash report the same as a leaked secret: rotate assumptions, investigate
scope, and fix the capture path.

## Backend UI contract: pending → succeeded | failed

The OS sheet is not your payment UI. On iOS the sheet **always** shows success after
authorization ([apple-pay.md](apple-pay.md)); that animation must not be mirrored as "paid" in
your app.

Drive checkout from your backend's outcome only:

| App state | When | User-facing meaning |
| --- | --- | --- |
| `pending` | Sheet closed with `result.success === true`, backend request in flight (or not yet started) | Payment authorised; charge not confirmed |
| `succeeded` | Backend reports authorisation/capture success (or webhook confirms it) | Money moved / order paid |
| `failed` | Backend declines, gateway errors, network failure after retries, or webhook says failed | Authorisation did not become a charge |

```text
sheet closes (success: true)
  → UI: pending
  → POST token + orderId to backend
  → backend: authz + charge
  → UI: succeeded | failed
```

Do not:

- Show "Payment successful" from `result.success` alone.
- Clear the cart or unlock fulfilment on sheet success.
- Assume Android sheet success is safer — it still only means Google returned payment data, not
  that your gateway captured funds.

Cancellation and presentation failures (`success: false`) stay out of this contract: return the
user to checkout without entering `pending`.

## Authorise the caller against the referenced order

A payment endpoint that accepts `{ token, orderId }` without proving the caller owns that order
is an open charge surface: anyone who obtains a token (or tricks a victim into producing one) can
attach it to an arbitrary order.

Required server checks before calling the gateway:

1. **Authenticate** the request (session, signed token, or equivalent).
2. **Authorise** that the authenticated principal may pay **this** `orderId` (owner, permitted
   payer, or same checkout session). Reject mismatches with `403`, not with a gateway call.
3. **Load the order** from your datastore; refuse unknown, already-paid, cancelled, or expired
   orders.
4. **Charge the order's amount and currency**, never values from the client body.
5. **Bind the attempt** to the order (idempotency key = your order / payment-attempt ID), so
   retries do not double-capture.

Optional but strongly recommended: short-lived server-issued checkout session IDs, one-time
payment-intent records, and webhook reconciliation so a killed app cannot leave you unsure
whether money moved.

## What your backend must do

1. **Authenticate the caller and authorise them against the referenced order** (see above).
2. **Resolve the real amount** from your own order record.
3. **Forward the token to your gateway** using its server SDK and a secret key. For Apple Pay,
   some gateways instead require you to decrypt the token yourself with your Apple payment
   processing certificate — a server-only operation.
4. **Be idempotent.** Retries and duplicate submissions happen. Do not use
   `PaymentResult.transactionId` for this — it is a client-generated random UUID (see below).
   Use your own order ID.
5. **Treat the gateway's response as the truth**, not the sheet's success. On iOS especially, the
   sheet shows success before your backend has been asked anything. Reflect that truth in the
   app as `pending` → `succeeded` | `failed`.
6. **Reconcile through webhooks.** The app can be killed between authorisation and your response.

## Identifier trustworthiness

| Field | iOS | Android | Trust it? |
| --- | --- | --- | --- |
| `result.transactionId` | random `UUID()` | random `UUID.randomUUID()` | **No.** Client-generated, not a gateway reference |
| `result.token.transactionIdentifier` | real PassKit identifier | random `UUID.randomUUID()` | iOS only, and only for correlation |
| `result.token.paymentData` | base64 PassKit payload | Google Pay token string | Yes — this is the payload that matters |
| `result.token.paymentMethod.network` | real PassKit network | unknown networks fall back to `visa` | Display only |
| `result.success` | see below | see below | Means "the user authorised", not "money moved" |

On Android, both `transactionId` and `transactionIdentifier` are freshly generated UUIDs from
`PaymentMapper.mapPaymentDataToResult` — two *different* random values, neither derived from
Google Pay.

## Logging

`android/.../HybridPaymentHandler.kt` calls `logPaymentRequest`, which writes the full Google Pay
request JSON at `Log.d` under the tag `HybridPaymentHandler`. It is not gated on
`BuildConfig.DEBUG`.

What that exposes: merchant name, merchant ID, gateway, gateway merchant ID, currency, country,
and line-item labels and prices. What it does not expose: the payment token, or any card data.
`handlePaymentSuccess` logs only the string `"Payment successful"`.

Android release builds normally strip `Log.d` via R8/ProGuard rules, but that depends on your
app's configuration — verify it rather than assuming it if the line-item labels are sensitive.

There is no equivalent logging in the iOS implementation.

Your app's logging is a separate risk: if you `console.log(result)` or send `result` to a crash
reporter, you can leak `paymentData` even though the library does not. See
[Crash reporting and analytics must not leak tokens](#crash-reporting-and-analytics-must-not-leak-tokens).

## Compliance framing

This document describes behaviour, not compliance status. What is factual:

- Card numbers never reach your app or your backend — the OS hands over a token encrypted for
  your gateway. This is the property that keeps most integrations out of the heavier PCI DSS
  scopes.
- That property holds only if your backend does not handle raw card data by some other route.
- Whether your specific integration qualifies for a given SAQ is a question for your acquirer and
  your assessor, and no library can answer it for you.

Apple and Google each impose their own merchant terms and branding rules for the buttons and
flows. Those are contractual obligations, independent of anything in this code.

## Related

- Exact field names and types: [api.md](api.md)
- Why the iOS sheet always shows success: [apple-pay.md](apple-pay.md)
- The TEST/PRODUCTION trap: [google-pay.md](google-pay.md)
