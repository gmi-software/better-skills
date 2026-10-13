# Setup and troubleshooting

## Requirements

| | |
| --- | --- |
| React Native | 0.81+, New Architecture (Fabric); Nitro Views do not run on the legacy renderer |
| Peer dependency | `react-native-nitro-modules >=0.37.0` |
| iOS | 15.1+ |
| Android | `minSdkVersion` 24+; some features need a newer Android (matrix below) |
| Expo | SDK 54+ with a development build; Expo Go is not supported |

## Install

```sh
npm install react-native-better-pdf react-native-nitro-modules   # or yarn / pnpm / bun add
```

- Bare React Native: `cd ios && pod install`, then a new native build on both platforms.
- Expo: no config plugin; `npx expo prebuild`, then `npx expo run:ios` / `run:android` (or an EAS development build).
- No Metro config: `pdf` is one of Metro's default asset extensions, so `require('./doc.pdf')` works as is.

## Jest

The package ships no Jest mock, and its native view cannot run under Jest. Stub the module in a file listed in Jest's `setupFiles` (or at the top of a test):

```js
jest.mock('react-native-better-pdf', () => {
  const React = require('react');
  const { View } = require('react-native');

  const PdfView = React.forwardRef(function PdfView({ children, ...props }, ref) {
    React.useImperativeHandle(ref, () => ({
      goToPage: jest.fn(),
      zoomTo: jest.fn(),
      goToViewport: jest.fn(),
      getOutline: jest.fn(async () => []),
      getPageSizes: jest.fn(async () => []),
      renderPage: jest.fn(async () => ({ uri: 'file:///page.png', width: 1, height: 1 })),
      print: jest.fn(async () => ({ isSubmitted: false })),
      getFormFields: jest.fn(async () => []),
      setFormFieldValues: jest.fn(async () => {}),
      exportDocument: jest.fn(async () => ({ filePath: '/tmp/export.pdf' })),
      search: jest.fn(),
      searchNext: jest.fn(),
      searchPrevious: jest.fn(),
      clearSearch: jest.fn(),
      getStats: jest.fn(() => null),
    }));
    return React.createElement(View, props, children);
  });

  const errorClass = (name) =>
    class extends Error {
      constructor({ code, message, httpStatus }) {
        super(message);
        this.name = name;
        this.code = code;
        this.httpStatus = httpStatus;
      }
    };
  const PdfOpenError = errorClass('PdfOpenError');
  const PdfDownloadError = errorClass('PdfDownloadError');

  return {
    PdfView,
    PdfPageOverlay: ({ children }) => children ?? null,
    PdfDocument: { open: jest.fn() },
    PdfCache: {
      download: jest.fn(),
      getEntry: jest.fn(async () => undefined),
      remove: jest.fn(async () => false),
      getByteSize: jest.fn(async () => 0),
      clear: jest.fn(async () => {}),
    },
    PdfOpenError,
    PdfDownloadError,
  };
});
```

The stub passes every prop to a `View`, so a test drives events through the props: with React Native Testing Library, `fireEvent(screen.getByTestId('pdf'), 'load', { pageCount: 3, firstPageWidth: 595, firstPageHeight: 842, isStale: false })`, then `'pageChange'` with `{ page: 1, pageCount: 3 }`, `'error'` with `{ code: 'network-error', message: '' }`.

## Android capability matrix

Several Android features come from the platform renderer's newer API: on Android 15+, and on Android 12–14 when the device has SDK extension 13 (the PDF module updated through Google Play system updates).

| Capability | iOS | Android 15+, or 12–14 with SDK extension 13 | Other Android versions |
| --- | --- | --- | --- |
| Viewing, zoom, layouts, offline, overlays, dark pages, outline, page sizes, page images, printing, `PdfDocument`, links | Yes | Yes | Yes |
| Password-protected documents | Yes | Yes (no outline or metadata) | `unsupported-pdf` |
| Search | Yes | Yes | `isSupported: false` |
| Text selection | Yes | Yes, one page at a time | Long presses ignored |
| Forms: fill in, set from code, export | Yes | Yes | Read only: `getFormFields` works, `setFormFieldValues` rejects, `exportDocument` copies the file |
| Annotations drawn | All | Highlights, notes, free text, form fields; stamps from Android 17; no shapes, ink, underline, strike-out | Form fields |
| Screen readers read page text | Yes | Yes | The page label only |

## Common problems

| Problem | Cause and fix |
| --- | --- |
| The viewer does not appear in Expo Go | Expo Go cannot load native modules: use a development build |
| An error about `BetterPdfView` right after installing | The native app was not rebuilt: `pod install` and a new build |
| Errors about the legacy architecture | Enable the New Architecture |
| A protected document fails with `unsupported-pdf` on Android | The device is below Android 15 without SDK extension 13 |
| A remote document fails with `invalid-pdf` | The server answered with something else, often a login page: check the URL and `headers` |
| A remote document fails with `network-error` that worked with react-native-pdf | The server's certificate is invalid; react-native-pdf accepted it by default (`trustAllCerts`) |
| A signed URL or rotating token downloads the document on every open | Set `cacheKey` on the source |
| Tapping a URL link does nothing | The viewer never opens URLs: open them in `onLinkPress` |
| `onPageTap` arrives about 300 ms late | It waits for a double tap: `enableDoubleTapZoom={false}` |
| The first page sits under the status bar or a header | No safe-area insets: a `SafeAreaView`, or `contentInset` for translucent bars |
| The viewer scrolls to the top of the page after every scroll | The page from `onPageChange` is fed back into `goToPage`: keep the reported page and requested jumps apart ([navigation-and-layout.md](navigation-and-layout.md)) |
| A `data:` URI fails with `invalid-source` | Base64 sources are unsupported: write a file ([sources-and-caching.md](sources-and-caching.md#base64-data)) |
