# iOS / Apple Pay

Behaviour of `ios/HybridPaymentHandler.swift`, `ios/HybridApplePayButton.swift`,
`ios/ApplePayButtonFactory.swift`, and `ios/PassKitTypeMapper.swift` at v0.0.16.

## The authorization result is hardcoded

This is the most important fact about the iOS implementation.

`PaymentDelegate.paymentAuthorizationViewController(_:didAuthorizePayment:handler:)` schedules a
work item one second out on the main queue and then calls:

```swift
completion(PKPaymentAuthorizationResult(status: .success, errors: nil))
```

unconditionally. The source labels it `// Simulate payment processing`. Only afterwards is the
token converted and handed to JavaScript.

What this means in practice:

| Expectation | Reality |
| --- | --- |
| The sheet's tick means the payment succeeded | It means the user authorised. Nothing has been charged. |
| A backend decline can be shown in the sheet | It cannot. The result is decided before your backend is contacted. |
| `PKPaymentAuthorizationResult(status: .failure)` is reachable | It is not — no code path produces it. |
| Field-level errors (bad postcode, unsupported card) can be returned | They cannot; `errors` is always `nil`. |
| The sheet dismisses as fast as the OS allows | There is a fixed **1.0s** delay on every payment. |

Design around it: treat the sheet as consent capture. Show your own confirmation state after your
backend responds (`pending` → `succeeded` | `failed` — see [security.md](security.md)), and be
ready to tell a user their authorised payment failed — because on iOS, they will already have seen
a success animation.

`PKPaymentAuthorizationViewController` is used rather than the newer
`PKPaymentAuthorizationController`. It still works and is still what most gateway samples show,
but it is deprecated API, and it is the reason presentation goes through a root view controller
lookup rather than the OS presenting itself.

## Merchant identifier resolution

```text
1. request.applePayMerchantIdentifier — trimmed; used if non-empty
2. Info.plist "ReactNativePayApplePayMerchantIdentifiers"
     - if an array: the first entry that is non-empty after trimming
     - if a string: that value, if non-empty
3. nil → startPayment resolves with "No Apple Pay merchant identifier configured"
```

The entitlement `com.apple.developer.in-app-payments` is **not read at runtime**. It is required
for code signing and for the OS to permit Apple Pay, but native reads the `Info.plist` key. The
Expo config plugin writes both, which is why using the plugin makes this work and setting only the
entitlement by hand does not.

`PaymentRequest.applePayMerchantIdentifier`'s JSDoc says iOS "resolves the first configured
entitlement automatically". That is inaccurate; the list comes from `Info.plist`.

## Building the PKPaymentRequest

| Request field | PassKit mapping |
| --- | --- |
| `countryCode`, `currencyCode` | Set directly |
| `paymentItems` | `PKPaymentSummaryItem`, `type` mapped from `'final'`/`'pending'` |
| `merchantCapabilities` | `'3DS'` → `.capability3DS`, `'EMV'` → `.capabilityEMV`, `'Credit'` → `.capabilityCredit`, `'Debit'` → `.capabilityDebit`. **Anything else is silently ignored.** |
| `supportedNetworks` | Mapped through `PassKitTypeMapper.convertToPKPaymentNetwork`; unmappable names are dropped |
| `shippingType` | `'shipping'`, `'delivery'`, `'storePickup'`, `'servicePickup'`; unknown → `.shipping` |
| `billingContactRequired: true` | `requiredBillingContactFields = [.postalAddress, .name]` |
| `shippingContactRequired: true` | `requiredShippingContactFields = [.postalAddress, .name]` |
| `shippingMethods` | **Ignored.** Nothing reads it. |

### The synthetic total row

With **more than one** payment item, a final summary row is appended:

- Label: `merchantName` if set and non-empty, otherwise the literal `"Total"`.
- Amount: the sum of every item's `amount`.

With exactly one item, no extra row is added — Apple Pay uses that item as the total, so its label
becomes the "Pay <label>" text in the sheet.

Amounts convert through `NSDecimalNumber(decimal: Decimal(item.amount))`. The `Double` → `Decimal`
step happens after the value has already been through JavaScript's floating point, so compute
authoritative money server-side.

## Availability

```swift
canMakePayments  = PKPaymentAuthorizationViewController.canMakePayments()
canSetupCards    = PKPaymentAuthorizationViewController.canMakePayments(usingNetworks: [])
```

`canMakePayments` is the correct check: the device supports Apple Pay.

`canSetupCards` passes an **empty networks array**, which no card can satisfy, so it is
effectively always `false`. Despite the name it does not tell you whether the user could add a
card. Do not build UI on it. (`PKPaymentAuthorizationViewController.canMakePayments(usingNetworks:capabilities:)`
would be the real basis for that question.)

`HybridPaymentHandler.canMakePayments(usingNetworks:)` maps your strings to `PKPaymentNetwork`
values and asks PassKit — a genuine check, unlike its Android counterpart.

## Cancellation

There is no PassKit callback distinguishing "user tapped cancel" from "sheet went away", so the
delegate infers it from elapsed time. `markPresented()` records the presentation date, and on
finish without authorization:

| Time since presentation | `error` |
| --- | --- |
| ≥ 0.75s | `Payment cancelled by user` |
| < 0.75s | `Payment sheet was dismissed before authorization` |

Both come back as `success: false`. Treat them as the same user-facing outcome; the distinction is
a heuristic, not a signal.

## Presentation

`getRootViewController()` walks `UIApplication.shared.connectedScenes`, keeps `UIWindowScene`s
whose `activationState == .foregroundActive`, finds the key window, and then walks down through
navigation controllers, tab bar controllers, and presented controllers to the topmost one.

It returns `nil` — producing `Unable to present payment authorization` — when there is no
foreground-active scene or no key window. In practice: the app is backgrounded, mid-launch, or in
an unusual multi-window state.

## The token

```swift
PaymentToken(
  paymentMethod: ...,
  transactionIdentifier: pkToken.transactionIdentifier,   // real, from PassKit
  paymentData: pkToken.paymentData.base64EncodedString()  // base64 of the raw blob
)
```

`paymentData` is base64-encoded encrypted data. Your backend base64-decodes it and either hands it
to your gateway or decrypts it with your Payment Processing Certificate. It is **not** a Stripe
source ID or any other gateway token — the library's README example over-simplifies this.

`PaymentResult.transactionId`, separately, is a fresh `UUID()` generated locally. Only
`token.transactionIdentifier` carries a real Apple value.

`paymentMethod` is fully populated on iOS: `displayName`, `network`, `type`,
`secureElementPass` (iOS 13.4+), and `billingAddress` as a `CNContact` (iOS 13.0+, and only when
`billingContactRequired` was set).

## ApplePayButton

`ApplePayButtonFactory` constructs a real
`PKPaymentButton(paymentButtonType:paymentButtonStyle:)`, so the button is Apple's own and
satisfies their branding requirements.

Native defaults exist even though TypeScript marks both props required: `buttonType` defaults to
`.buy` and `buttonStyle` to `.black`.

`afterUpdate()` calls `setupButton()`, which removes the old `PKPaymentButton` and builds a new one
with fresh Auto Layout constraints. **Every prop update destroys and rebuilds the button** — there
is no "props unchanged" early return like the Android implementation has. Keep `onPress` stable
(`useCallback`) and avoid deriving `buttonType`/`buttonStyle` from frequently-changing state.

The button is declared `{ ios: 'swift' }` in its Nitro spec, so it exists only on iOS. Branch on
`Platform.OS` rather than relying on it degrading.

`mapButtonStyle` has a `default: return .automatic` branch that is unreachable from the three
declared style values — a leftover, not a supported option.

## Threading

Everything is main-queue: `startPayment` immediately hops via `DispatchQueue.main.async`,
presentation is main, and the delegate's success path schedules onto main. There is no background
work, and PassKit requires this.

`paymentCompletion`, `currentPaymentRequest`, and `delegate` are single stored properties with no
locking. A second `startPayment` while a sheet is open overwrites `paymentCompletion`, and the
first promise never settles. Guard against concurrent calls in JavaScript.

## Simulator

The iOS Simulator can present the sheet with Apple's test cards, but tokens it produces are not
usable and the flow is not representative. Real Apple Pay validation needs a physical device with
a provisioned card. See [testing.md](testing.md).

## Debugging

There is **no logging** in the iOS implementation — no `print`, `NSLog`, or `OSLog`. Observability
comes from the returned `error` strings and from breakpoints. The full list of iOS error strings
is in [api.md](api.md#paymentresult).
