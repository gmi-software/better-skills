# react-native-pdf → react-native-better-pdf mapping

Reference for step 4 of [migrate-from-react-native-pdf.md](migrate-from-react-native-pdf.md). react-native-pdf's side was read from its 7.0.5 source.

## Behaviour that changes silently

None of these causes a type error; all of them change what users see.

| Topic | react-native-pdf | react-native-better-pdf | To keep the old behaviour |
| --- | --- | --- | --- |
| Page numbers | 1-based (`page`, `setPage`, `onPageChanged`, `onPageSingleTap`) | 0-based everywhere | Convert at the boundary: `- 1` in, `+ 1` out |
| TLS certificates | `trustAllCerts` defaults to `true` | Always validated | Not possible; fix the server's certificate |
| Progress value | `onLoadProgress(fraction)`, `0…1` | `onLoadProgress({ loadedBytes, totalBytes? })` | `totalBytes === undefined ? undefined : loadedBytes / totalBytes` |
| Loading UI | `xx.xx%` text, or `renderActivityIndicator` | Nothing | Render your own until `onLoad` / `onError` |
| Background | `#EEE` behind the pages | Transparent | `style={{ backgroundColor: '#EEE' }}` |
| Fit | `fitPolicy` default `2` (whole page) | `'width'` when vertical and continuous; `'page'` with `horizontal`, `enablePaging` or `singlePage` | `fitPolicy="page"` |
| Max zoom | `maxScale` default `3` | `4` | `maxScale={3}` |
| Page gap | `spacing` default `10` | `pageSpacing` default `8` | `pageSpacing={10}` |
| Safe area (iOS) | PDFKit adds it as an inset | No automatic insets, like `ScrollView` | A `SafeAreaView` around the viewer, or `contentInset` |
| Short documents | Centred vertically | Start at the top | Nothing to keep (the old behaviour was a reported bug) |
| `borderRadius` | Did not clip pages on iOS | Clips the document on both platforms | Nothing |
| Current page | Platform-specific | The page under the viewport centre, the last page once scrolled to the end, on both platforms | Nothing |
| Remote cache | Opt-in (`source.cache`), keyed by the URL | Always for the app session; across launches with `cache: 'persistent'`; keyed by URL + headers, or `cacheKey` | `cache: true` → `cache: 'persistent'` |
| Existing downloads | Files in react-native-pdf's cache | Not reused: the first open after the migration downloads again | Nothing |
| Expired copy | Deleted after `expiration`; offline that is an error | Revalidated after `maxAgeMs`; offline the old copy is shown with `isStale: true` | Nothing; show an "offline copy" hint from `isStale` |
| Persistent copies | Kept in a cache directory | Never purged by the OS, no size limit: the app removes them | `PdfCache.remove(source)` when a document goes away, `PdfCache.clear()` on sign-out |
| Errors | `Error` objects, platform-specific messages | A plain `PdfError` object with a stable `code` (not an `Error`: `String(error)` is `[object Object]`) | Match on `error.code`; log `error.code` and `error.message` |

## Imports and types

| react-native-pdf | react-native-better-pdf |
| --- | --- |
| `import Pdf from 'react-native-pdf'` | `import { PdfView } from 'react-native-better-pdf'` |
| `PdfProps` | `PdfViewProps` |
| `PdfRef` | `PdfViewRef` |
| `Source` | `PdfSource` (`PdfUriSource` for `{ uri }` objects) |
| `PdfError` (`Error & { status? }`) | `PdfError` (`{ code, message, httpStatus?, page?, nativeDescription? }`); `status` → `httpStatus` |
| `TableContent` (`{ title, pageIdx, children, mNativePtr }`) | `PdfOutlineItem` (`{ title, page?, children }`) |
| `TextSelectionChangeEvent` | `PdfTextSelectionChangeEvent` (`{ text }`) |

## Sources

| react-native-pdf | react-native-better-pdf | Notes |
| --- | --- | --- |
| `{ uri }`, `{ uri, headers }` | same | `http(s)://`, `file://`, Android `content://` |
| `require('./x.pdf')` | same | No Metro config needed |
| `{ uri: 'bundle-assets://…' }` | `require('./x.pdf')` | Bundle the file as a JS asset |
| `cache: true` | `cache: 'persistent'` | Session caching is always on |
| `cacheFileName` | `cacheKey` | Identifies the stored copy instead of URL + headers |
| `expiration` (seconds) | `maxAgeMs` (milliseconds) | An older copy is revalidated (`ETag` / `Last-Modified`), not deleted, and still shown offline |
| `method`, `body` | — | `GET` only. Download in app code to a file and open `{ filePath }`, e.g. `ReactNativeBlobUtil.config({ path }).fetch('POST', url, headers, body)` |
| `{ uri: 'data:application/pdf;base64,…' }` | — | Write the data to a file and open the file: [sources-and-caching.md](sources-and-caching.md#base64-data) |

## Props

| react-native-pdf | react-native-better-pdf | Notes |
| --- | --- | --- |
| `page` | `initialPage` (0-based) + `ref.goToPage()` | Applied once on load; see the recipe below |
| `scale` | `initialScale` + `ref.zoomTo()` | Relative to the fitted page |
| `minScale`, `maxScale` | same | `maxScale` default 3 → 4 |
| `spacing` | `pageSpacing` | Default 10 → 8 |
| `password` | same | Android: 15+, or 12–14 with SDK extension 13; elsewhere `unsupported-pdf` |
| `horizontal`, `enablePaging`, `singlePage`, `scrollEnabled`, `enableDoubleTapZoom`, `showsVerticalScrollIndicator`, `showsHorizontalScrollIndicator` | same | Same names and defaults |
| `enableRTL` | same | Horizontal layouts only (iOS: with `enablePaging`); page numbers stay in document order |
| `enableTextSelection` | same | `false` now really turns selection off; Android selects too (15+) |
| `fitPolicy={0 \| 1 \| 2}` | `fitPolicy="width" \| "height" \| "page"` | `0` → `'width'`, `1` → `'height'`, `2` → `'page'` |
| `nightMode` (a common patch) | `colorScheme="dark"` | Both platforms; hues kept |
| `style` and other `View` props | same | |
| `enableAntialiasing`, `enableAnnotationRendering`, `usePDFKit` | — | Delete: always on / always PDFKit on iOS |
| `trustAllCerts` | — | Delete; see the silent changes |
| `renderActivityIndicator`, `progressContainerStyle` | — | Delete; render your own indicator |

## Callbacks

Positional arguments become one event object.

| react-native-pdf | react-native-better-pdf |
| --- | --- |
| `onLoadComplete(numberOfPages, path, { width, height }, tableContents)` | `onLoad({ pageCount, firstPageWidth, firstPageHeight, filePath, isStale })`: `filePath` is `path` (absolute, no `file://`); the outline comes from `ref.getOutline()`, every page's size from `ref.getPageSizes()` |
| `onPageChanged(page, numberOfPages)`, 1-based | `onPageChange({ page, pageCount })`, 0-based |
| `onLoadProgress(fraction)` | `onLoadProgress({ loadedBytes, totalBytes? })` |
| `onError(error)` | `onError({ code, message, httpStatus?, page?, nativeDescription? })` |
| `onPageSingleTap(page, x, y)`, 1-based, view coordinates | `onPageTap({ page, x, y })`, 0-based, PDF points from the page's top-left (code that converted view coordinates to page coordinates is deleted) |
| `onPressLink(url)` | `onLinkPress({ url })`; links to other pages are followed natively and not reported |
| `onScaleChanged(scale)` | `onScaleChange({ scale })`, once per settled zoom |
| `onTextSelectionChange({ nativeEvent: { type, text } })` | `onTextSelectionChange({ text })`, once per settled selection; `''` when cleared |

## Methods

| react-native-pdf | react-native-better-pdf |
| --- | --- |
| `ref.current.setPage(n)`, 1-based | `ref.current?.goToPage(n - 1)`; animated unless `{ animated: false }` |
| `ref.current.setNativeProps({ page: n })` | `ref.current?.goToPage(n - 1)` |

## Error messages → codes

```diff
- onError={(error) => {
-   if (String(error).includes('Password')) askForPassword();
- }}
+ onError={(error) => {
+   if (error.code === 'password-required') askForPassword();
+   else if (error.code === 'invalid-password') showWrongPassword();
+   else if (error.code === 'unsupported-pdf') showProtectedUnsupported(); // older Android
+   else showError(messageFor(error.code)); // the app's own text; log error.message
+ }}
```

Code that showed `String(error)` or the error text to people shows the app's own text per code instead.

| Situation | `error.code` |
| --- | --- |
| No file, unreadable `file://` | `file-not-found` |
| Unsupported URI | `invalid-source` |
| Connection failed, TLS error, timeout | `network-error` |
| Non-2xx response (`error.httpStatus`) | `http-error` |
| Not a PDF (often a login page), corrupt | `invalid-pdf` |
| Encrypted, no password | `password-required` |
| Wrong password | `invalid-password` |
| Encrypted PDF on an Android device without password support | `unsupported-pdf` |
| A page could not be rendered (`error.page`) | `page-render-failed` |
| Out of memory | `out-of-memory` |

## Recipes

### Page indicator

```diff
- const [page, setPage] = useState(1);
- <Pdf onPageChanged={(p, n) => { setPage(p); setTotal(n); }} />
- <Text>{page} / {total}</Text>
+ const [page, setPage] = useState(0);
+ <PdfView onPageChange={(e) => { setPage(e.page); setTotal(e.pageCount); }} />
+ <Text>{page + 1} / {total}</Text>
```

### The `page` prop

react-native-pdf apps often feed one state both into `page` and from `onPageChanged`. Here those are two things: the page the reader is on (from `onPageChange`, for display) and a jump the app requests. Only a requested jump calls `goToPage`; feeding the reported page back into `goToPage` snaps the reader to the top of their page after every scroll.

Jumps requested by the app's own UI (buttons, a table of contents) call the ref in the handler:

```tsx
const pdf = useRef<PdfViewRef>(null);
<Button title="Next" onPress={() => pdf.current?.goToPage(page + 1)} />;
```

A target that arrives as a prop (a deep link, a parent screen) goes through an effect:

```tsx
useEffect(() => {
  pdf.current?.goToPage(targetPage - 1); // targetPage is 1-based, from outside
}, [targetPage]);

<PdfView ref={pdf} initialPage={targetPage - 1} source={source} />;
```

The effect's first run lands before the document has loaded, where `initialPage` already opens on the target; later runs navigate.

### Download progress

Every `<Pdf>` without `renderActivityIndicator` showed react-native-pdf's progress text, so every converted viewer of a remote document gets an indicator. Progress events come only while downloading: a stored copy or a local file goes straight to `onLoad`, so base the indicator on `onLoad` / `onError`, not on progress reaching 1.

```diff
- <Pdf
-   onLoadProgress={(fraction) => setProgress(fraction)}
-   renderActivityIndicator={(progress) => <ProgressBar value={progress} />}
- />
+ const [progress, setProgress] = useState<number | undefined>();
+ const [isLoaded, setIsLoaded] = useState(false);
+ <View style={{ flex: 1 }}>
+   <PdfView
+     style={{ flex: 1 }}
+     onLoadProgress={({ loadedBytes, totalBytes }) =>
+       setProgress(totalBytes === undefined ? undefined : loadedBytes / totalBytes)
+     }
+     onLoad={() => setIsLoaded(true)}
+     onError={() => setIsLoaded(true)}
+   />
+   {!isLoaded && <ProgressBar value={progress} />}
+ </View>
```

### Links

```diff
- onPressLink={(url) => Linking.openURL(url)}
+ onLinkPress={({ url }) => {
+   if (url.startsWith('https://')) Linking.openURL(url); // a PDF is untrusted input
+ }}
```

### Thumbnails

```diff
- <TouchableOpacity onPress={() => open(page)}>
-   <Pdf source={source} singlePage page={page} style={styles.thumb} />
- </TouchableOpacity>
+ <Pressable onPress={() => open(page)}>
+   <PdfView source={source} singlePage initialPage={page - 1} style={styles.thumb} />
+ </Pressable>
```

A `singlePage` view ignores touches, so the `Pressable` gets the tap and a surrounding list scrolls. For image files instead, see [pages-and-documents.md](pages-and-documents.md).

### Table of contents

```diff
- onLoadComplete={(pages, path, size, tableContents) => setToc(tableContents)}
+ onLoad={() => {
+   pdf.current
+     ?.getOutline()
+     .then(setToc)
+     .catch(() => setToc([])); // rejects for encrypted documents on Android
+ }}
```

`item.page` is zero-based, and `undefined` for entries that only group others or link elsewhere (react-native-pdf: `pageIdx` `-1`, or omitted).

### Selected text

```diff
- onTextSelectionChange={({ nativeEvent }) =>
-   setSelected(nativeEvent.type === 'selectionChanged' ? nativeEvent.text : '')
- }
+ onTextSelectionChange={({ text }) => setSelected(text)}
```

### Tap to toggle toolbars

```diff
- onPageSingleTap={() => setChromeVisible((v) => !v)}
+ onPageTap={() => setChromeVisible((v) => !v)}
```

Taps on the gaps between pages are not reported. Add `enableDoubleTapZoom={false}` when the ~300 ms double-tap wait matters more than double-tap zoom.

### Cache options

```diff
  source={{
    uri,
-   cache: true,
-   cacheFileName: documentId,
-   expiration: 24 * 60 * 60,
+   cache: 'persistent',
+   cacheKey: documentId,
+   maxAgeMs: 24 * 60 * 60 * 1000,
  }}
+ onLoad={({ isStale }) => setOfflineBanner(isStale)}
```

A URL or headers carrying a token that changes between opens needs `cacheKey`, or each open downloads again. `'persistent'` copies stay until the app removes them: `PdfCache.remove(source)` when a document is deleted or access is revoked, `PdfCache.clear()` on sign-out. Tell the owner where those calls belong when that code is outside the migrated files. See [sources-and-caching.md](sources-and-caching.md).
