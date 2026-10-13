# Page images, documents without a view, printing

## Which tool

| Need | Use |
| --- | --- |
| Thumbnails that stay on screen (a strip, a grid) | A `singlePage` `PdfView` per thumbnail: no files |
| An image file to hand elsewhere (an `<Image>` list, sharing, upload) | `renderPage` on the view's ref, or on a `PdfDocument` |
| Titles, page counts, covers or metadata without showing the document; checking a password before opening the viewer | `PdfDocument` |
| Every page's size, e.g. for layout around the viewer | `getPageSizes()` on the ref or a `PdfDocument` |

## Thumbnails

```tsx
<Pressable onPress={() => pdf.current?.goToPage(page)} style={{ width: 56, height: 76 }}>
  <PdfView source={source} singlePage initialPage={page} style={{ flex: 1 }} />
</Pressable>
```

A `singlePage` view ignores touches: the `Pressable` gets the tap and a surrounding `ScrollView` scrolls. Its fit defaults to the whole page. Each thumbnail is a viewer of its own, so keep a strip to the pages a reader can use (the library's example caps its strip at 12).

## Page images

```tsx
const image = await pdf.current?.renderPage(page, {
  width: 160 * PixelRatio.get(), // pixels; the height follows the page
  format: 'jpeg',                // default 'png'
  quality: 0.8,                  // JPEG only, default 0.9
}); // { uri, width, height }
if (image) setThumb(image);

{thumb && <Image source={{ uri: thumb.uri }} style={{ width: 160, aspectRatio: thumb.width / thumb.height }} />}
```

- `width` is 1–4096 pixels, and an image holds at most 4096 × 4096 pixels' worth: a very tall page needs a smaller width.
- The page as displayed (crop box, rotation), on white, with the annotations the viewer draws; without page overlays and without dark-page inversion.
- Rendered off the main thread by a separate renderer: the view keeps scrolling.
- The file lands in the app's cache directory (`BetterPdf/renders`) and belongs to the app: move it to keep it, delete it when done. The OS may clear cache files when storage runs low.

## PdfDocument

```ts
import { PdfDocument, PdfOpenError } from 'react-native-better-pdf';

try {
  const document = await PdfDocument.open(source, { password, onProgress, signal });
  try {
    const { title, author, createdAtMs } = await document.getMetadata();
    const cover = await document.renderPage(0, { width: 300 });
    setItem({ title, pageCount: document.pageCount, cover: cover.uri, isStale: document.isStale });
  } finally {
    document.close();
  }
} catch (error) {
  if (error instanceof PdfOpenError && error.code === 'password-required') askForPassword();
}
```

- `open` takes one source of any form `PdfView` accepts, downloads it (or uses the stored copy) the same way, and rejects with `PdfOpenError` carrying the view's error `code`. Offline it opens an outdated copy and `isStale` is `true`.
- `getMetadata()`: `title`, `author`, `subject`, `keywords`, `creator`, `producer`, `createdAtMs`, `modifiedAtMs` (milliseconds since the epoch: `new Date(createdAtMs)`). Missing entries are `undefined`. Android rejects for encrypted documents.
- `getPageSizes`, `getOutline` and `renderPage` work like the view's ref methods.
- Calls on one document run one after another: twenty covers requested at once render one at a time.
- `close()` in `finally`: an open document keeps its file open until then. Calls after `close()` reject.

## Page sizes

`getPageSizes()` resolves to `{ width, height }` per page in PDF points, as displayed (crop box, rotation applied). `onLoad` already reports the first page's: `firstPageWidth`, `firstPageHeight`.

## Printing

```tsx
const result = await pdf.current?.print({ jobName: 'Invoice 7' });
if (result?.isSubmitted) showToast('Sent to the printer');
```

- Opens the system print dialog for the loaded document and resolves when it closes: `isSubmitted` is `false` when the user closed the dialog.
- Prints password-protected documents and `content://` sources too; the unlocked copy never touches disk.
- Rejects before `onLoad`, while the view's dialog is already open, when the app is in the background and on iOS when the device cannot print or the document forbids printing.
- `jobName` defaults to the source's file name, or `'Document'`.
- For a file the app already has, `onLoad`'s `filePath` also works with `expo-print` or `react-native-print`.
