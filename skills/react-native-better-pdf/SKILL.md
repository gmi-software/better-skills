---
name: react-native-better-pdf
description: >-
  react-native-better-pdf, the native PDF viewer for React Native and Expo (PdfView,
  PdfDocument, PdfCache). Use when writing, reviewing or debugging code that shows or reads
  PDFs with react-native-better-pdf, when adding a PDF viewer to a React Native app, and when
  migrating an app from react-native-pdf.
license: MIT
metadata:
  package: react-native-better-pdf
  version: "1.0.0"
  commit: e93ad5366ae4fe2a7f5d0eedcb05c44fe06abeb7
  verified: "2026-10-13"
  repository: https://github.com/gmi-software/react-native-better-pdf
  audience: library users
  tags: react-native, pdf, pdf-viewer, pdfkit, pdfrenderer, nitro, expo, ios, android, react-native-pdf, migration
---

# react-native-better-pdf

A Nitro View over the platform PDF engines: PDFKit on iOS, `PdfRenderer` on Android. JS sends configuration and commands; native code scrolls, zooms, renders, downloads and caches, and reports **settled** events (loaded, page changed, zoom ended, viewport stopped), never per-frame ones. Write code that configures the viewer and reacts to settled events; motion stays native.

## Ground truth: the installed package

This skill is verified against 1.0.0; a newer installed version may add APIs it does not list (`version` in `node_modules/react-native-better-pdf/package.json`). For exact signatures, read the package itself:

- `node_modules/react-native-better-pdf/src/PdfView.tsx`: every prop and ref method, with TSDoc.
- `node_modules/react-native-better-pdf/src/index.ts`: every export; all types come from the package root.
- `node_modules/react-native-better-pdf/README.md`: the full guide. List its sections with `grep -n '^## ' node_modules/react-native-better-pdf/README.md` and read the one you need.

Before the package is installed (e.g. while planning a migration), the same files are at https://github.com/gmi-software/react-native-better-pdf.

## Rules

1. **Zero-based pages** everywhere: `onPageChange`, `onPageTap`, `initialPage`, `goToPage`, `renderPage`, outline items, overlays, viewports. Add 1 only in text shown to people.
2. **Initial props apply once per loaded document**: `initialPage`, `initialScale`, `initialViewport`. Later navigation goes through the ref: `goToPage(page, { animated })`, `zoomTo(scale)`, `goToViewport(viewport)`. Where the document opens comes from the initial props: ref calls before `onLoad` are not reliably applied. Out-of-range pages are clamped to the document.
3. **Scale is relative to the fitted page** (`fitPolicy`): `1` is fitted, `zoomTo(1)` resets, `minScale` / `maxScale` default to `1` / `4`.
4. **Sources compare by value.** An inline `source={{ uri }}` literal is fine: re-renders never reload. A changed password always reloads. Without a `cacheKey`, a changed `uri` or `headers` reloads; with one, only a changed key does (signed URLs, rotating tokens). The forms: `{ uri, headers? }` (`https://`, `http://`, `file://`, Android `content://`), `{ filePath }` (absolute path, no `file://`), and `require('./doc.pdf')` (Metro needs no config). Base64 data is written to a file first, then opened as a file.
5. **The app owns the loading UI.** Render an indicator until `onLoad` or `onError`. `onLoadProgress` reports bytes, `{ loadedBytes, totalBytes? }`, at most every 100 ms plus a final event before `onLoad`; `totalBytes` is `undefined` when the server sends no size. It fires only while a remote document downloads: local files, bundled assets and stored copies open without it.
6. **Match errors on `error.code`**, identical on both platforms: `invalid-source`, `file-not-found`, `network-error`, `http-error` (with `httpStatus`), `invalid-pdf`, `password-required`, `invalid-password`, `unsupported-pdf` (Android only: an encrypted file the device's renderer cannot open), `page-render-failed` (with `page`), `out-of-memory`. `message` is English that may change between versions: show people your own text per code, and log `code` with `message`. `PdfDocument.open` and `PdfCache.download` reject with `PdfOpenError` / `PdfDownloadError`, carrying the same `code`.
7. **URL links are reported, never opened.** Open them in `onLinkPress` after checking the scheme: a PDF is untrusted input. Links to other pages are followed natively.
8. **Taps:** `onPageTap` gives `{ page, x, y }` in PDF points from the page's top-left, after a ~300 ms wait for a possible double tap. `enableDoubleTapZoom={false}` delivers it at once.
9. **The app places the box.** The viewer adds no safe-area insets (keep it in a `SafeAreaView`, or use `contentInset` under translucent bars) and is transparent around the pages (set `style.backgroundColor`). `style.borderRadius` clips the document.
10. **Android gates some features.** Search, text selection, password-protected files and form filling need Android 15+, or Android 12–14 with SDK extension 13. Elsewhere search reports `isSupported: false`, protected files fail with `unsupported-pdf`, and `setFormFieldValues` rejects. Build the UI for these outcomes: hide search on `isSupported: false`, explain `unsupported-pdf`.
11. **Close what you open.** A `PdfDocument` holds its file until `close()`: call it in `finally`. `renderPage` writes files to the cache directory that the app owns: move them to keep them, delete them when done.
12. **New Architecture only; rebuild after installing.** Install with the peer `react-native-nitro-modules`, then rebuild the native app (`pod install` and a new build). Expo: a development build (`npx expo prebuild`, `npx expo run:ios` / `run:android`), no config plugin; Expo Go cannot load it.

## Minimal viewer

```tsx
import { useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { PdfView } from 'react-native-better-pdf';

export function Reader({ uri }: { uri: string }) {
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(0);

  return (
    <View style={{ flex: 1 }}>
      <PdfView
        style={{ flex: 1, backgroundColor: '#E4E4E7' }}
        source={{ uri }}
        onLoad={(event) => {
          setPageCount(event.pageCount);
          setIsLoading(false);
        }}
        onError={(error) => {
          setIsLoading(false);
          console.warn(error.code, error.message);
        }}
        onPageChange={({ page }) => setPage(page)}
        onLinkPress={({ url }) => {
          if (url.startsWith('https://')) Linking.openURL(url);
        }}
      />
      {isLoading && <ActivityIndicator style={StyleSheet.absoluteFill} />}
      <Text>{pageCount > 0 ? `${page + 1} / ${pageCount}` : ''}</Text>
    </View>
  );
}
```

Type the ref with `useRef<PdfViewRef>(null)`; its async methods (`getOutline`, `getPageSizes`, `renderPage`, `print`, form methods) are for after `onLoad`.

## Where to go next

| Task | Read |
| --- | --- |
| Replacing react-native-pdf in an app | [references/migrate-from-react-native-pdf.md](references/migrate-from-react-native-pdf.md): a step-by-step procedure, followed in order |
| Remote documents: headers, tokens, signed URLs, offline reading, downloading ahead (`PdfCache`), base64 data | [references/sources-and-caching.md](references/sources-and-caching.md) |
| Page jumps, a table of contents, restoring the reading position, horizontal / paged / right-to-left / single-page layouts, facing pages, translucent bars, dark pages | [references/navigation-and-layout.md](references/navigation-and-layout.md) |
| Thumbnails, page images, covers and metadata for document lists (`PdfDocument`), page sizes, printing | [references/pages-and-documents.md](references/pages-and-documents.md) |
| Search UI, text selection, forms (AcroForm), React views on pages (`PdfPageOverlay`: signatures, markers, pins) | [references/search-forms-overlays.md](references/search-forms-overlays.md) |
| Install and build problems, Expo, Jest mocks, the Android capability matrix, common problems | [references/setup-and-troubleshooting.md](references/setup-and-troubleshooting.md) |
