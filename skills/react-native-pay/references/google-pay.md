# Android / Google Pay

Behaviour of `android/src/main/java/com/margelo/nitro/pay/*.kt` at v0.0.16.

## The TEST environment default

```kotlin
private fun determineEnvironment(envConfig: GooglePayEnvironment?): Int {
    return when (envConfig) {
        GooglePayEnvironment.PRODUCTION -> WalletConstants.ENVIRONMENT_PRODUCTION
        GooglePayEnvironment.TEST, null -> WalletConstants.ENVIRONMENT_TEST
    }
}
```

`null` and `'TEST'` collapse to the same branch. **Omitting `googlePayEnvironment` runs your
production build against Google Pay's test environment.** There is no warning, and the payment
sheet looks normal.

What happens in `TEST`:

- Tokens are test tokens. Your gateway rejects them, or worse, accepts them into a sandbox while
  the user believes they have paid.
- `merchantId` is **omitted entirely** from `merchantInfo` — it is added only in `PRODUCTION`.
- `googlePayGateway` and `googlePayGatewayMerchantId` fall back to the placeholder constants
  `"example"` and `"exampleGatewayMerchantId"`.
- `merchantName` falls back to `"Example Merchant"`, which the user sees in the sheet.

So a request with no Google configuration at all still opens a working-looking sheet. That is
convenient for a demo and dangerous for a release.

`PRODUCTION` validates up front and throws if anything is missing:

```kotlin
require(!request.googlePayMerchantId.isNullOrBlank())        // "googlePayMerchantId is required in PRODUCTION"
require(!request.googlePayGateway.isNullOrBlank())           // "googlePayGateway is required in PRODUCTION"
require(!request.googlePayGatewayMerchantId.isNullOrBlank()) // "googlePayGatewayMerchantId is required in PRODUCTION"
```

Those throws are caught by `startPayment` and surface as
`Failed to start payment: <message>` with `success: false`.

**Check this first** whenever an Android payment "works but never charges", or a token is rejected
by the gateway.

## `supportedNetworks` is ignored

`GooglePayRequestBuilder.createAllowedCardNetworks()` returns a fixed array:

```kotlin
put(PaymentConstants.NETWORK_VISA)        // "VISA"
put(PaymentConstants.NETWORK_MASTERCARD)  // "MASTERCARD"
put(PaymentConstants.NETWORK_AMEX)        // "AMEX"
put(PaymentConstants.NETWORK_DISCOVER)    // "DISCOVER"
```

`PaymentRequest.supportedNetworks` is never read anywhere in `android/`. Requesting JCB, Maestro,
Elo, or Interac has no effect on Android — those cards simply will not be offered. On iOS the same
field is honoured, so the two platforms will show different card lists from identical JavaScript.

`allowedAuthMethods` is likewise fixed to `["PAN_ONLY", "CRYPTOGRAM_3DS"]`.

## `canMakePayments` does not check the device

```kotlin
override fun canMakePayments(usingNetworks: Array<String>): Boolean {
    return usingNetworks.any { network ->
        PaymentConstants.SUPPORTED_NETWORKS.contains(network.lowercase())
    }
}
```

`SUPPORTED_NETWORKS` is `listOf("visa", "mastercard", "amex", "discover")`. That is the whole
implementation: a case-insensitive string comparison. It never touches `PaymentsClient`, never
asks whether Google Pay is installed, and never checks for a saved card.

`canMakePayments(['visa'])` returns `true` on a device with no Google Pay at all.

**Use `payServiceStatus()` instead** on Android — that one does call `isReadyToPay`.

## `payServiceStatus()` blocks

It is declared synchronous in the Nitro spec, and its Android implementation does:

```kotlin
Tasks.await(task, 5, TimeUnit.SECONDS)
```

**twice** — once with `existingPaymentMethodRequired = false` (→ `canSetupCards`) and once with
`true` (→ `canMakePayments`). Each is a network-backed Play Services call.

Consequences:

- Worst case ~10 seconds of blocking on the calling thread.
- Because the call is synchronous JSI, that thread is the JavaScript thread. The UI stops
  responding, and a long enough stall on the main thread can produce an ANR.
- `usePaymentCheckout` calls it in a **mount effect**, so any screen using the hook inherits the
  stall at mount.

Mitigations, in order of preference:

1. Do not read availability on a screen's critical path. Check it before navigating to checkout,
   or on app idle, and cache the result.
2. If you use the hook, mount it only on the checkout screen — not in a layout or provider that
   mounts early.
3. Show a loading state; `isCheckingStatus` is exposed for exactly this.

On failure it catches, logs `"Error checking status"`, and returns
`{ canMakePayments: false, canSetupCards: false }` — so a timeout looks identical to an
unsupported device.

Also note the first call uses `currentEnvironment`, which is initialised to `ENVIRONMENT_TEST` and
only updated by a `startPayment`. An availability check before the first payment therefore always
queries the test environment.

## The payment flow

1. `Wallet.getPaymentsClient(context, WalletOptions.setEnvironment(environment))`
2. `GooglePayRequestBuilder.createPaymentDataRequest(request, environment)` builds the JSON
3. `logPaymentRequest(...)` writes it to logcat (see below)
4. `reactContext.currentActivity` — `null` gives `No activity available to show payment UI`
5. `AutoResolveHelper.resolveTask(client.loadPaymentData(request), activity, 991)`
6. `onActivityResult` with request code `991`

Result handling:

| `resultCode` | Outcome |
| --- | --- |
| `RESULT_OK` | `PaymentData.getFromIntent` → mapped to a success result; a `null` intent gives `No payment data received` |
| `RESULT_CANCELED` | `Payment cancelled by user` |
| `AutoResolveHelper.RESULT_ERROR` | `Payment error: <statusMessage>`, or `Unknown error` |
| anything else | `Payment failed with result code: <n>` |

All of these **resolve** the promise with `success: false`. None reject.

The handler registers itself as an `ActivityEventListener` in `init`, so a `PaymentHandler`
instance must outlive the sheet. Since `HybridPaymentHandler` is created at module scope, that
holds in practice.

`paymentPromise` is a single nullable field. A second `startPayment` while a sheet is open
overwrites it and the first promise never settles.

## The request JSON

```json
{
  "apiVersion": 2,
  "apiVersionMinor": 0,
  "merchantInfo": {
    "merchantName": "<merchantName | \"Example Merchant\">",
    "merchantId": "<googlePayMerchantId — PRODUCTION only>"
  },
  "allowedPaymentMethods": [{
    "type": "CARD",
    "parameters": {
      "allowedAuthMethods": ["PAN_ONLY", "CRYPTOGRAM_3DS"],
      "allowedCardNetworks": ["VISA", "MASTERCARD", "AMEX", "DISCOVER"]
    },
    "tokenizationSpecification": {
      "type": "PAYMENT_GATEWAY",
      "parameters": {
        "gateway": "<googlePayGateway | \"example\">",
        "gatewayMerchantId": "<googlePayGatewayMerchantId | \"exampleGatewayMerchantId\">"
      }
    }
  }],
  "transactionInfo": {
    "totalPriceStatus": "FINAL",
    "totalPrice": "<sum of paymentItems, \"%.2f\" in Locale.US>",
    "totalPriceLabel": "Total",
    "currencyCode": "<currencyCode>",
    "countryCode": "<countryCode>",
    "displayItems": [
      { "label": "...", "type": "LINE_ITEM | PENDING", "price": "..." }
    ]
  }
}
```

Notes:

- `totalPriceStatus` is always `FINAL`, even if every item is `'pending'`.
- `totalPriceLabel` is always the literal `"Total"`.
- Prices format with `Locale.US`, so the decimal separator is always `.` regardless of device
  locale — which is what Google Pay requires.
- `tokenizationSpecification.type` is always `PAYMENT_GATEWAY`. `DIRECT` tokenization (decrypting
  tokens yourself) is not supported.

## Ignored request fields

`shippingType`, `shippingMethods`, `billingContactRequired`, `shippingContactRequired`, and
`applePayMerchantIdentifier` are all unread on Android. Google Pay's own shipping and billing
address options are not exposed.

## The token

```kotlin
PaymentToken(
  paymentMethod = ...,
  transactionIdentifier = UUID.randomUUID().toString(),
  paymentData = tokenizationData.getString("token")
)
```

- `paymentData` is Google's `tokenizationData.token` — for `PAYMENT_GATEWAY` this is normally a
  **gateway-specific JSON string**, not base64. The README's claim that `paymentData` is always
  base64 is true for iOS only.
- `transactionIdentifier` **and** `PaymentResult.transactionId` are two *different* freshly
  generated UUIDs. Neither comes from Google.
- `paymentMethod.type` is always `'unknown'`; `secureElementPass` and `billingAddress` are always
  `null`.
- `displayName` is `"<cardNetwork> <cardDetails>"`, e.g. `"VISA ••••1234"`.
- `mapCardNetwork` recognises VISA, MASTERCARD, AMEX, DISCOVER, JCB, MAESTRO, ELECTRON, ELO, and
  INTERAC, and **falls back to `PaymentNetwork.VISA`** for anything else — including
  `"privateLabel"` and the `"unknown"` default. Never use `network` for business logic on Android.

A `JSONException` while parsing gives `Failed to parse payment data: <message>`.

## GooglePayButton

`GooglePayButtonFactory` uses the official
`com.google.android.gms.wallet.button.PayButton`, so branding compliance comes for free.

Native defaults, despite TypeScript marking both props required: `buttonType` is `BUY`, `theme` is
`DARK`, `radius` is `null`.

`HybridGooglePayButton` logs to logcat under `HybridGooglePayButton` — including
`"Button reused - props unchanged"`, which is useful for confirming recycling behaviour.

The spec is `{ android: 'kotlin' }`, so the component exists on Android only.

## AndroidManifest

The library's own manifest is **empty**. The required
`com.google.android.gms.wallet.api.enabled` meta-data comes from the Expo config plugin with
`enableGooglePay: true`, or from your own manifest in bare React Native:

```xml
<meta-data
  android:name="com.google.android.gms.wallet.api.enabled"
  android:value="true" />
```

Missing that meta-data is the most common cause of "Google Pay isn't available".

## Logging

```kotlin
Log.d(PaymentConstants.TAG_PAYMENT_HANDLER, "Payment request: $request")
```

Tags: `HybridPaymentHandler` and `HybridGooglePayButton`.

```bash
adb logcat -s HybridPaymentHandler:V HybridGooglePayButton:V
```

This is genuinely the fastest way to diagnose Android payment problems — the log line shows the
exact JSON, so you can read off the environment, gateway, and merchant ID actually being used.

It is **not** gated on `BuildConfig.DEBUG`. The token is not logged, but merchant and gateway IDs
and line-item labels are. See [security.md](security.md#logging).

## Emulator

An emulator with Google Play Services can install Google Pay and show the sheet with test cards in
`ENVIRONMENT_TEST`. It cannot produce a chargeable token. Emulator images without Play Services
fail `isReadyToPay` outright. See [testing.md](testing.md).
