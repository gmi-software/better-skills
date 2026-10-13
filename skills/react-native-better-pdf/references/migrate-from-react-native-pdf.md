# Migrating from react-native-pdf

A procedure for replacing [react-native-pdf](https://github.com/wonday/react-native-pdf) 7.x with react-native-better-pdf. Work through the steps in order; each ends on a check that must hold before the next step. The prop, callback, method and type tables, the silent behaviour changes and the before/after recipes are in [react-native-pdf-mapping.md](react-native-pdf-mapping.md): step 4 works from it.

A migration preserves what users see. Where the new library behaves differently, keep the old behaviour explicitly, and report what you kept so the owner can decide later.

## 1. Preflight

1. **New Architecture.** Read the React Native version from `package.json`. It must be 0.81 or newer with the New Architecture on. From 0.82 it always is. On 0.81 check `newArchEnabled=true` in `android/gradle.properties`, and for Expo that `app.json` does not set `"newArchEnabled": false`. On the legacy architecture, stop: report that the app must move to the New Architecture first.
2. **Blockers.** react-native-pdf bundles PDFium, which covers every Android version; this library uses the platform renderer. Each item below removes something the app may do today. When one applies, put it to the user before converting anything and continue once they accept it; when no one can be asked, continue and lead the report with it.
   - The app opens password-protected documents (a `password` prop, or an error path for protected files) and supports Android below 15: there, unless the device has SDK extension 13 (Android 12–14), they fail with `unsupported-pdf`. Compare against `minSdkVersion`.
   - The app relies on text selection on Android below 15 (same exception).
   - `source.method` / `source.body` (POST downloads): those downloads move to app code (see the mapping's Sources table).
   - The app ships on Windows.
3. **Changes the report carries.** These need no decision now; step 7 lists them:
   - Certificates are always validated. `trustAllCerts` defaulted to `true`, so this applies to every app with remote documents that did not set `trustAllCerts={false}`.
   - Android draws highlights, notes, free text and form fields (stamps from Android 17), not shapes, ink, underline or strike-out annotations; iOS draws all of them. Whether this matters depends on the app's documents.

**Check:** the React Native version and architecture are confirmed, and every blocker that applies is accepted (or reported as unconfirmed).

## 2. Inventory

Find every place the app touches react-native-pdf:

```sh
grep -rnE "react-native-pdf|react-native-blob-util" --exclude-dir=node_modules --exclude-dir=ios/Pods --exclude-dir=.git .
ls patches 2>/dev/null | grep -i pdf
```

This also finds Jest mocks (`jest.mock('react-native-pdf', …)`, `__mocks__/react-native-pdf.js`), Jest config (`transformIgnorePatterns`), Expo config plugins (`@config-plugins/react-native-pdf`, `@config-plugins/react-native-blob-util` in `app.json` / `app.config.*`), and `patch-package` patches. For each component file, write down:

- the props, callbacks and ref methods it uses (`ref.current.setPage(n)`, `setNativeProps({ page })`);
- the types it imports (`PdfRef`, `PdfProps`, `Source`, `PdfError`, `TableContent`);
- every page number that crosses the component's boundary: state, navigation params, deep links, values in storage, analytics, server APIs. react-native-pdf's are 1-based.

**Check:** every line of the grep output belongs to an entry in the inventory.

## 3. Dependencies

Use the package manager the lockfile shows:

```sh
npm uninstall react-native-pdf
npm install react-native-better-pdf react-native-nitro-modules
```

- Uninstall `react-native-blob-util` only when the inventory shows no other use of it.
- If the app already has `react-native-nitro-modules`, keep one copy at `>=0.37.0`.
- Delete `patch-package` patches for react-native-pdf; the patched behaviour moves into step 4 (a patched-in `nightMode` becomes `colorScheme="dark"`).
- Expo: remove the react-native-pdf config plugin (and the blob-util one with its package) from the app config; this library needs none.
- iOS: `cd ios && pod install`. Expo: `npx expo prebuild`.

**Check:** `package.json` lists `react-native-better-pdf` and `react-native-nitro-modules` and no longer lists `react-native-pdf`, and the app config has no react-native-pdf plugin.

## 4. Convert every site

For each inventory entry, convert every prop, callback, method and type with [react-native-pdf-mapping.md](react-native-pdf-mapping.md). The package is installed now: confirm any signature the mapping leaves open in `node_modules/react-native-better-pdf/src/PdfView.tsx`.

- **Page numbers change base at the boundary.** State inside the component becomes zero-based; text shown to people adds 1. Values stored or sent in the old 1-based form keep their format so existing data stays valid: convert where they are read (`- 1`) and written (`+ 1`).
- **Keep the old look.** Where the old code relied on a react-native-pdf default that changed, pass the old value: `fitPolicy="page"`, `maxScale={3}`, `pageSpacing={10}`, `backgroundColor: '#EEE'` in `style`. Every viewer of a remote document without `renderActivityIndicator` showed progress text: give it an indicator until `onLoad` / `onError`.
- **Safe area on iOS.** PDFKit used to add the safe area as an inset. Where the screen has no header above the viewer (`headerShown: false`, a modal, no navigator), place the viewer in a `SafeAreaView`, or use `contentInset` under translucent bars. When the file does not show which applies, leave it as a device check in the report.
- **Controlled props become imperative.** `page` becomes `initialPage` plus `goToPage`; `scale` becomes `initialScale` plus `zoomTo`. The mapping's "The `page` prop" recipe shows how to do it without snapping the reader back.
- **Errors shown to people** get the app's own text per `error.code`; `message` goes to logs.
- **Links** keep opening the schemes the old code opened. Where it opened every URL, open only `https:`, `http:` and `mailto:` (a PDF is untrusted input) and report the change.
- **Props without a counterpart are deleted**, each recorded for the report.
- The types carry the conversion: a remaining type error points at an unconverted site. Every conversion type-checks on its own, without `as any` or `@ts-ignore`.

**Check:** every prop, callback, method and type in the inventory has its replacement in the code or a recorded removal.

## 5. Tests

- Replace react-native-pdf's Jest mock with the stub in [setup-and-troubleshooting.md](setup-and-troubleshooting.md#jest), and remove react-native-pdf from the Jest config.
- Update assertions on the old positional callback arguments and on 1-based pages.

**Check:** no test or Jest config refers to react-native-pdf.

## 6. Verify

```sh
grep -rnE "react-native-pdf|onLoadComplete|onPageChanged|onPageSingleTap|onPressLink|onScaleChanged|\.setPage\(|trustAllCerts|renderActivityIndicator|progressContainerStyle|cacheFileName|enableAntialiasing|enableAnnotationRendering|usePDFKit" --exclude-dir=node_modules --exclude-dir=ios/Pods --exclude-dir=.git .
```

Then run the project's type check, lint and tests. Build the native app when the environment allows it (`npx expo run:ios`, `npx react-native run-android`, …); otherwise the report says that a native rebuild is still needed.

**Check:** every hit the grep still returns is a comment that explains the migration (e.g. why a stored page stays 1-based) or a changelog entry; no code, config or mock refers to react-native-pdf; type check, lint and tests pass.

## 7. Report

Tell the user:

- blockers from step 1 that are not yet accepted, first;
- the files converted, and the props deleted without a counterpart;
- the old defaults kept explicitly (step 4), which they may drop to adopt the new ones;
- behaviour that changed on purpose: link schemes, error texts, the loading indicator, certificates now validated, annotations Android does not draw;
- caching: the first open after the update downloads again; offline, an expired copy is now shown (`isStale`) instead of an error; `'persistent'` copies stay until the app removes them, so name where `PdfCache.remove` / `PdfCache.clear()` belong (document deletion, sign-out);
- what to try on a device: remote documents, every 1-based boundary from the inventory, password-protected documents and search on an older Android device, the loading indicator, the first page on iOS below the status bar;
- whether the native app still needs a rebuild;
- in one line, what the app can now use that react-native-pdf lacked: search, reading-position restore (`initialViewport` / `onViewportChange`), downloading ahead (`PdfCache`), forms, page overlays.
