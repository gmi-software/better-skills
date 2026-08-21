# API reference

Complete public surface, read from `package/src` at v0.0.16. Every identifier below is exported
from the package root — **there are no subpath exports**. Do not invent props or option keys.

```ts
import {
  HybridPaymentHandler,
  usePaymentCheckout,
  ApplePayButton,
  GooglePayButton,
} from '@gmisoftware/react-native-pay'
```

## HybridPaymentHandler

The Nitro HybridObject. Created at module import time, so importing the package without the
native module present throws immediately.

```ts
interface PaymentHandler {
  payServiceStatus(): PayServiceStatus            // synchronous
  startPayment(request: PaymentRequest): Promise<PaymentResult>
  canMakePayments(usingNetworks: string[]): boolean   // synchronous
}
```

| Method | Notes |
| --- | --- |
| `payServiceStatus()` | Real availability check on both platforms. **On Android this blocks the caller** for up to ~10s (two `isReadyToPay` awaits at 5s each). |
| `startPayment(request)` | Presents the sheet. **Resolves** with `success: false` on cancellation or error — it does not reject. |
| `canMakePayments(networks)` | iOS: genuine PassKit check. **Android: string comparison against a hardcoded list — it never queries the device.** Prefer `payServiceStatus()` on Android. |

Only one payment may be in flight. Both platforms hold a single pending promise; a second
`startPayment` overwrites the first, which then never settles.

## Types

### PaymentRequest

```ts
interface PaymentRequest {
  countryCode: string                 // required, ISO 3166-1 alpha-2
  currencyCode: string                // required, ISO 4217
  paymentItems: PaymentItem[]         // required
  merchantCapabilities: string[]      // required (iOS-only effect)
  supportedNetworks: string[]         // required (iOS-only effect)

  applePayMerchantIdentifier?: string
  merchantName?: string
  shippingType?: string
  shippingMethods?: PaymentItem[]
  billingContactRequired?: boolean
  shippingContactRequired?: boolean

  googlePayMerchantId?: string
  googlePayEnvironment?: GooglePayEnvironment
  googlePayGateway?: string
  googlePayGatewayMerchantId?: string
}
```

Traps in this type:

- `supportedNetworks` and `merchantCapabilities` are `string[]`, **not** unions. A typo compiles
  and is then silently dropped by the native mapper.
- `supportedNetworks` **has no effect on Android** — the request hardcodes Visa, Mastercard,
  Amex, and Discover.
- `merchantCapabilities` is Apple Pay only. Recognised values are exactly `'3DS'`, `'EMV'`,
  `'Credit'`, `'Debit'`; anything else is ignored.
- `shippingMethods` is accepted by the type and **read by neither platform's implementation**.
- `applePayMerchantIdentifier`'s JSDoc claims iOS falls back to "the first configured
  entitlement". It does not — it reads the `ReactNativePayApplePayMerchantIdentifiers` key from
  `Info.plist` ([apple-pay.md](apple-pay.md)).

`shippingType` maps to PassKit as `'shipping' | 'delivery' | 'storePickup' | 'servicePickup'`,
defaulting to `shipping` for unrecognised values.

### PaymentItem

```ts
type PaymentItemType = 'final' | 'pending'

interface PaymentItem {
  label: string
  amount: number    // major currency units, e.g. 4.99
  type: PaymentItemType
}
```

`amount` is a `number`, so it carries the usual floating-point caveats. Compute authoritative
totals on your backend in minor units.

### PaymentResult

```ts
interface PaymentResult {
  success: boolean
  transactionId?: string   // client-generated UUID — NOT a gateway reference
  token?: PaymentToken
  error?: string           // human-readable; there are no error codes
}
```

There is no error enum. Distinguish cases by matching `error` against the literals native emits:

| Platform | Emitted `error` strings |
| --- | --- |
| iOS | `Payment cancelled by user`, `Payment sheet was dismissed before authorization`, `No Apple Pay merchant identifier configured`, `Unable to present payment authorization`, `Unable to create payment authorization` |
| Android | `Payment cancelled by user`, `No payment data received`, `No activity available to show payment UI`, `Payment error: <status>`, `Payment failed with result code: <n>`, `Failed to start payment: <message>`, `Failed to parse payment data: <message>` |

These are ordinary strings with no stability guarantee. Prefer branching on `success`.

### PaymentToken

```ts
interface PaymentToken {
  paymentMethod: PaymentMethod
  transactionIdentifier: string
  paymentData: string    // iOS: base64 PKPaymentToken.paymentData
                         // Android: Google Pay tokenizationData.token
}
```

`paymentData` is the only field your backend needs, and its format differs per platform. Send the
platform along with it.

### PaymentMethod

```ts
interface PaymentMethod {
  displayName?: string
  network?: PaymentNetwork
  type: PaymentMethodType
  secureElementPass?: PKSecureElementPass   // iOS 13.4+ only
  billingAddress?: CNContact                // iOS 13.0+ only
}

type PaymentMethodType = 'unknown' | 'debit' | 'credit' | 'prepaid' | 'store'
```

On Android: `type` is always `'unknown'`, `secureElementPass` and `billingAddress` are always
`null`, `displayName` is `"<cardNetwork> <cardDetails>"`, and an unrecognised network falls back
to `'visa'`. Display only.

### PaymentNetwork

```ts
type PaymentNetwork =
  | 'visa' | 'mastercard' | 'amex' | 'discover' | 'jcb' | 'maestro'
  | 'electron' | 'elo' | 'idcredit' | 'interac' | 'privateLabel'
```

Only the first four work on Android, and only they are in the shared `CommonNetworks` constant.

### Other types

```ts
type GooglePayEnvironment = 'TEST' | 'PRODUCTION'

interface PayServiceStatus {
  canMakePayments: boolean
  canSetupCards: boolean
}
type ApplePayStatus = PayServiceStatus   // deprecated alias
```

`canSetupCards` is derived on iOS from `canMakePayments(usingNetworks: [])` — an empty array — so
it is effectively always `false` there. Do not build UI on it.

`PKPass`, `PKSecureElementPass`, and `CNContact` are also exported, mirroring the PassKit and
Contacts shapes. They are populated on iOS only.

## usePaymentCheckout

```ts
function usePaymentCheckout(
  config: UsePaymentCheckoutConfig
): UsePaymentCheckoutReturn
```

### Config

| Option | Type | Default |
| --- | --- | --- |
| `merchantName` | `string` | — |
| `countryCode` | `string` | `'US'` |
| `currencyCode` | `string` | `'USD'` |
| `supportedNetworks` | `string[]` | `['visa', 'mastercard', 'amex', 'discover']` |
| `merchantCapabilities` | `string[]` | `['3DS']` |
| `applePayMerchantIdentifier` | `string` | — |
| `googlePayMerchantId` | `string` | — |
| `googlePayEnvironment` | `GooglePayEnvironment` | — → native treats as **`TEST`** |
| `googlePayGateway` | `string` | — |
| `googlePayGatewayMerchantId` | `string` | — |

### Return

```ts
interface UsePaymentCheckoutReturn {
  canMakePayments: boolean
  canSetupCards: boolean
  isCheckingStatus: boolean

  items: PaymentItem[]
  total: number
  addItem: (label: string, amount: number, type?: 'final' | 'pending') => void
  addItems: (items: Array<{ label: string; amount: number; type?: 'final' | 'pending' }>) => void
  removeItem: (index: number) => void
  updateItem: (index: number, updates: Partial<PaymentItem>) => void
  clearItems: () => void

  startPayment: () => Promise<PaymentResult | null>
  isProcessing: boolean
  result: PaymentResult | null
  error: Error | null

  reset: () => void
  paymentRequest: PaymentRequest
}
```

Behaviour worth knowing:

- Availability is read **once**, in a mount effect. It does not refresh when the user adds a card
  or the app returns from background. On Android that effect is a blocking call.
- `startPayment()` returns `null` (not a `PaymentResult`) when the cart is empty, and sets
  `error` to `Cart is empty`.
- A failed payment sets both `result` (with `success: false`) and `error`.
- `reset()` clears `result`, `error`, and `isProcessing` — **not** the cart. Use `clearItems()`.
- With an empty cart, `paymentRequest` still contains one placeholder item labelled `Total` at
  amount `0`.

**Memoize the config object.** `paymentRequest` is a `useMemo` keyed on `config`, so an inline
object literal rebuilds it — and therefore `startPayment`'s identity — on every render:

```ts
const config = useMemo(
  () => ({ currencyCode: 'USD', googlePayEnvironment: 'PRODUCTION' as const }),
  []
)
const checkout = usePaymentCheckout(config)
```

## Buttons

Both are Nitro HybridViews and each is declared for **one platform only**. Rendering the wrong one
crashes rather than degrading.

```tsx
{Platform.OS === 'ios' ? (
  <ApplePayButton
    buttonType="buy"
    buttonStyle="black"
    onPress={startPayment}
    style={{ width: 200, height: 48 }}
  />
) : (
  <GooglePayButton
    buttonType="pay"
    theme="dark"
    radius={8}
    onPress={startPayment}
    style={{ width: 200, height: 48 }}
  />
)}
```

### ApplePayButton (iOS only)

| Prop | Type | Required |
| --- | --- | --- |
| `buttonType` | `'buy' \| 'setUp' \| 'book' \| 'donate' \| 'continue' \| 'reload' \| 'addMoney' \| 'topUp' \| 'order' \| 'rent' \| 'support' \| 'contribute' \| 'tip'` | yes |
| `buttonStyle` | `'white' \| 'whiteOutline' \| 'black'` | yes |
| `onPress` | `() => void` | no |

### GooglePayButton (Android only)

| Prop | Type | Required |
| --- | --- | --- |
| `buttonType` | `'buy' \| 'book' \| 'checkout' \| 'donate' \| 'order' \| 'pay' \| 'subscribe' \| 'plain'` | yes |
| `theme` | `'dark' \| 'light'` | yes |
| `radius` | `number` | no |
| `onPress` | `() => void` | no |

`buttonType` and `buttonStyle`/`theme` are required with no defaults. Give both buttons explicit
dimensions — neither self-sizes.

## Helpers

```ts
const CommonNetworks: { VISA: 'visa'; MASTERCARD: 'mastercard'; AMEX: 'amex'; DISCOVER: 'discover' }

function createPaymentItem(label: string, amount: number, type?: 'final' | 'pending'): PaymentItem
function calculateTotal(items: PaymentItem[]): number
function createPaymentRequest(options: Partial<PaymentRequest> & { amount: number; label: string }): PaymentRequest
function sanitizePaymentRequest(request: PaymentRequest): PaymentRequest
function formatAmount(amount: number): string          // 29.9 -> "29.90"
function parseAmount(amountString: string): number
function isNetworkSupported(network: string, supportedNetworks: string[]): boolean  // case-insensitive
function formatNetworkName(network: PaymentNetwork): string   // 'amex' -> "American Express"
```

`createPaymentRequest` applies the same defaults as the hook: `countryCode: 'US'`,
`currencyCode: 'USD'`, the four common networks, and `merchantCapabilities: ['3DS']`. It builds
exactly one payment item from `label` and `amount`.

`sanitizePaymentRequest` strips `undefined` properties, which matters because Nitro serialises
explicit `undefined` differently from an absent key.

## Direct usage without the hook

```ts
import {
  HybridPaymentHandler,
  createPaymentRequest,
} from '@gmisoftware/react-native-pay'
import { Platform } from 'react-native'

const request = createPaymentRequest({
  amount: 24.99,
  label: 'Annual subscription',
  currencyCode: 'EUR',
  countryCode: 'DE',
  merchantName: 'Example Store',
  ...(Platform.OS === 'android' && {
    googlePayEnvironment: 'PRODUCTION',
    googlePayMerchantId: 'YOUR_GOOGLE_MERCHANT_ID',
    googlePayGateway: 'stripe',
    googlePayGatewayMerchantId: 'YOUR_GATEWAY_MERCHANT_ID',
  }),
})

const result = await HybridPaymentHandler.startPayment(request)

if (!result.success) {
  // includes user cancellation
  return
}

// Send to YOUR backend. Never charge from the client.
await api.confirmOrder({
  orderId,
  platform: Platform.OS,
  token: result.token!.paymentData,
})
```

Why `googlePayEnvironment` is set explicitly: omitting it silently selects `TEST`
([google-pay.md](google-pay.md)). Why the amount is not sent to the backend:
[security.md](security.md).
