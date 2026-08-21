# Debugging

Structured troubleshooting for `@gmisoftware/react-native-pay` v0.0.16. Each entry gives symptoms,
likely causes, what to inspect, and what a healthy result looks like.

## First: get the error string

Every failure path resolves rather than rejects, so the message is in `result.error`, not in a
`catch`:

```ts
const result = await HybridPaymentHandler.startPayment(request)
console.log(JSON.stringify(result, null, 2))
```

Do not leave that `JSON.stringify(result)` in production builds — `result.token.paymentData` is a
credential. Scrub tokens before any crash reporter or analytics sink
([security.md](security.md#crash-reporting-and-analytics-must-not-leak-tokens)).

The complete set of error strings, and which platform produces each, is in
[api.md](api.md#paymentresult). Matching the exact string is the fastest way to find the
responsible code path.

On Android, also open logcat — it prints the request JSON that was actually sent:

```bash
adb logcat -s HybridPaymentHandler:V HybridGooglePayButton:V
```

There is no equivalent on iOS; the Swift implementation logs nothing.

---

## The app throws on import

**Symptoms.** A red screen before any of your code runs. Messages mentioning `PaymentHandler`,
`HybridObject`, `NitroModules`, or "cannot find" a native module.

**Likely causes.** In order of frequency: running in Expo Go, no native rebuild after installing,
New Architecture disabled, pods not installed.

`createHybridObject('PaymentHandler')` runs at module scope in both `src/index.ts` and
`src/hooks/usePaymentCheckout.ts`, so this fires on import rather than on first use.

**Inspect.**

```bash
node -p "require('@gmisoftware/react-native-pay/package.json').version"
grep newArchEnabled android/gradle.properties
grep -i nitropay ios/Podfile.lock
```

**Expected.** `newArchEnabled=true`; `NitroPay` present in `Podfile.lock`.

**Next step.** Rebuild natively — `npx expo run:ios` / `npx expo run:android`, or Xcode/Gradle for
bare projects. Expo Go can never work; you need a development build.

---

## Apple Pay button does not appear

Work through these in order; they are ordered by how often each is the cause.

**1. Wrong platform.** `ApplePayButton` is declared `{ ios: 'swift' }` in its Nitro spec. There is
no Android implementation. Render it behind `Platform.OS === 'ios'`.

**2. Zero size.** `HybridApplePayButton` creates a `PKPaymentButton` pinned to all four edges of a
plain `UIView`. That view has no intrinsic content size, so a parent with no height gives you a
0pt-tall button. Give it explicit dimensions:

```tsx
<ApplePayButton buttonType="buy" buttonStyle="black" style={{ height: 48 }} onPress={pay} />
```

Apple's guidance is a minimum height of 30pt; 44–48pt is a comfortable tap target.

**3. Style invisible against the background.** `buttonStyle="white"` on a white background looks
like nothing at all. Try `"black"` to rule it out.

**4. The device genuinely cannot pay.** Check, but do not confuse this with the button rendering:

```ts
console.log(HybridPaymentHandler.payServiceStatus())
```

`canMakePayments: false` means the device or region does not support Apple Pay. The button will
still render — the library does not hide it for you. Hiding it is your decision, and Apple's
guidelines expect you to when payment is unavailable.

Note that `canSetupCards` from `payServiceStatus()` is effectively always `false` on iOS by
construction — see [apple-pay.md](apple-pay.md#availability). Do not read anything into it.

---

## Google Pay reports unavailable

**Symptoms.** `payServiceStatus().canMakePayments === false`, or the sheet never opens.

**Likely causes**, in order:

**1. Missing manifest meta-data.** The library's own `AndroidManifest.xml` is empty. The wallet
meta-data comes from the config plugin, and `enableGooglePay` defaults to `false`.

```bash
grep -A2 wallet.api.enabled android/app/src/main/AndroidManifest.xml
```

Expected:

```xml
<meta-data android:name="com.google.android.gms.wallet.api.enabled" android:value="true" />
```

Absent? Set `enableGooglePay: true` in the plugin and re-run `npx expo prebuild --clean`. Note the
plugin *removes* the meta-data when the flag is false, so a stale `android/` directory can carry a
deletion forward.

**2. No Play Services.** An emulator image without Google APIs cannot run Google Pay. Use a
"Google Play" system image.

**3. No card in the wallet.** `payServiceStatus().canMakePayments` uses
`existingPaymentMethodRequired: true`, so it is `false` until a card is saved. `canSetupCards` uses
`false` for that flag and stays `true` — that difference is the actual signal:

| `canSetupCards` | `canMakePayments` | Meaning |
| --- | --- | --- |
| `true` | `true` | Ready to pay |
| `true` | `false` | Google Pay works; the user has no saved card |
| `false` | `false` | Google Pay unsupported, or the check timed out |

**4. It timed out.** Both `isReadyToPay` calls have a 5s timeout, and the catch block returns
`{false, false}` — indistinguishable from unsupported. Look for `Error checking status` in logcat.

**5. Do not use `canMakePayments(networks)` here.** On Android it is a hardcoded string comparison
that never touches the device, so it returns `true` regardless
([google-pay.md](google-pay.md#canmakepayments-does-not-check-the-device)).

---

## The gateway rejects the token

**Symptoms.** The sheet completes, `success: true`, and your backend's gateway call fails with
"invalid token", "test token in live mode", or similar.

**Likely cause on Android: the TEST environment default.** `googlePayEnvironment` is optional, and
omitting it means `ENVIRONMENT_TEST`. Tokens from the test environment are not chargeable.

**Inspect.** Logcat prints the environment on every request:

```bash
adb logcat -s HybridPaymentHandler:V | grep -i environment
```

**Expected for a production build.** `Environment: PRODUCTION`. If you see `TEST`, set
`googlePayEnvironment: 'PRODUCTION'` on the request.

While you are there, check the `Payment request:` line — in `TEST` the gateway silently falls back
to the literals `"example"` / `"exampleGatewayMerchantId"`, and `merchantId` is omitted entirely.
Seeing those placeholders in a build you thought was configured confirms the diagnosis.

**Likely cause on iOS: the wrong certificate.** The token is encrypted to your Payment Processing
Certificate. If your gateway generated the CSR, they hold the key; if you generated it, they need
it. A merchant ID mismatch between the sheet and the certificate produces a token nobody can
decrypt.

**Also check the format.** `paymentData` is base64 on iOS and a gateway JSON string on Android. A
backend that base64-decodes unconditionally will corrupt the Android token. Branch on platform, or
send the platform alongside the token.

---

## `startPayment` fails immediately

Match the error string:

| Error | Platform | Cause |
| --- | --- | --- |
| `No Apple Pay merchant identifier configured` | iOS | Neither `request.applePayMerchantIdentifier` nor the `Info.plist` key is set. The entitlement alone is not read. |
| `Unable to create payment authorization` | iOS | PassKit refused the `PKPaymentRequest` — usually an empty `supportedNetworks` after unmappable names were dropped, or an invalid country/currency code. |
| `Unable to present payment authorization` | iOS | No foreground-active window scene. The app is backgrounded or mid-launch. |
| `No activity available to show payment UI` | Android | `reactContext.currentActivity` was null. Same shape of problem. |
| `Failed to start payment: googlePay… is required in PRODUCTION` | Android | A required production field is missing. |
| `Failed to start payment: <other>` | Android | Any other exception while building or launching; the full stack is in logcat under `Failed to start payment`. |

For the merchant identifier case specifically:

```bash
plutil -p ios/*/Info.plist | grep -A3 ReactNativePayApplePayMerchantIdentifiers
```

Expected: an array containing your `merchant.` identifier. Absent means the config plugin did not
run, or ran without `merchantIdentifier`.

---

## The user was charged twice, or the promise never settles

**Cause.** Both platforms hold a single pending completion. A second `startPayment` while a sheet
is open overwrites the first, and the first `await` hangs forever.

**Inspect.** Look for a pay button that is not disabled during processing, or a `startPayment` in
an effect that can re-run.

**Fix.** Serialise. With the hook, gate on `isProcessing`:

```tsx
<ApplePayButton onPress={isProcessing ? undefined : startPayment} ... />
```

The hook sets `isProcessing`, but it does not itself refuse a concurrent call.

---

## The checkout screen freezes for several seconds on Android

**Cause.** `payServiceStatus()` is a synchronous JSI call that awaits two `isReadyToPay` tasks, 5s
timeout each. `usePaymentCheckout` calls it in a mount effect, so the stall lands wherever the hook
mounts.

**Inspect.** Time it:

```ts
const t = Date.now()
HybridPaymentHandler.payServiceStatus()
console.log('payServiceStatus took', Date.now() - t, 'ms')
```

**Expected.** Tens of milliseconds when Play Services responds normally. Anything approaching
5,000ms or 10,000ms means a timeout.

**Fix.** Check availability off the critical path — before navigating to checkout, or on app idle —
and cache it. Do not mount `usePaymentCheckout` in a layout or provider that renders early.

---

## The Apple Pay sheet shows success but nothing was charged

This is not a bug you can fix in your app; it is how the library works. iOS calls
`completion(PKPaymentAuthorizationResult(status: .success, errors: nil))` unconditionally, one
second after authorization, before your backend has seen anything
([apple-pay.md](apple-pay.md#the-authorization-result-is-hardcoded)).

Design accordingly: the sheet means "authorised", your own UI means "paid". Show `pending` after
the sheet closes and resolve to `succeeded` | `failed` when your backend replies
([security.md](security.md#backend-ui-contract-pending-succeeded-failed)).

---

## The card list differs between iOS and Android

Expected. Android hardcodes Visa, Mastercard, Amex, and Discover and never reads
`supportedNetworks`; iOS honours the field. Requesting JCB, Maestro, Elo, or Interac affects iOS
only. See [google-pay.md](google-pay.md#supportednetworks-is-ignored).

---

## Amounts are slightly wrong

Amounts are JavaScript `number`s all the way to native. iOS converts through
`Decimal(item.amount)`, Android formats with `"%.2f"` in `Locale.US`. Both inherit whatever
floating-point error the JS arithmetic already introduced — `0.1 + 0.2` is `0.30000000000000004`
before it ever reaches native.

Compute totals in integer minor units in your own code, convert once at the boundary, and have the
backend recompute authoritatively before charging.

## What not to do

Do not "reinstall everything" as a first move. Every failure above has a specific, checkable cause,
and the error string plus logcat will identify it in under a minute. Clean rebuilds are only
warranted for prefab/CMake errors and for stale `android/`/`ios/` directories after a plugin
change — and in the latter case the targeted fix is `npx expo prebuild --clean`.
