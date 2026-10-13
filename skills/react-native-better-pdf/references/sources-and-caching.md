# Sources and caching

## Source forms

```ts
type PdfSource =
  | PdfUriSource          // { uri, headers?, cache?, maxAgeMs?, cacheKey? }
  | { filePath: string }  // a file on the device
  | number;               // require('./document.pdf')
```

- `uri`: `https://` and `http://` (downloaded natively), `file://`, Android `content://`.
- `filePath`: an absolute path on the device, without `file://`.
- `require()`: a bundled asset; `pdf` is one of Metro's default asset extensions.
- Passwords: the `password` prop of `PdfView` (and `PdfDocument.open`'s `password` option).

Sources compare by value, so an inline object literal never reloads the document. A changed password reloads it, and so does a changed `uri` or `headers` when the source has no `cacheKey`; with a `cacheKey`, only a changed key does. Cache options alone never reload.

## Remote documents

Downloads are native: no `react-native-blob-util`, no file-system library, no JS heap. The download is kept for the app session, so remounting a viewer does not download again.

```tsx
import { PdfView, type PdfUriSource } from 'react-native-better-pdf';

const source: PdfUriSource = {
  uri: `https://example.com/documents/${id}.pdf`,
  headers: { Authorization: `Bearer ${token}` },
  cache: 'persistent',        // keep across launches for offline reading (default 'session')
  cacheKey: `document-${id}`, // the token changes between opens: identify the copy by id
  maxAgeMs: 0,                // revalidate on every open (default: never)
};

<PdfView source={source} onLoad={({ isStale }) => setOfflineBanner(isStale)} />;
```

- **`cacheKey`** belongs on every source whose URL or headers change between opens of the same document: signed URLs, rotating tokens. Without it each open downloads again, and a token refresh reloads the view. Sources with the same `cacheKey` are the same document.
- **`maxAgeMs`**: once the copy is older, opening asks the server (`If-None-Match` / `If-Modified-Since`); an unchanged document is not downloaded again.
- **Offline**: when the server cannot be reached (no connection, no answer within 10 s, a 5xx), the stored copy is shown and `onLoad` reports `isStale: true`. Without a copy the load fails with `network-error`. A 4xx is an `http-error` even with a copy.
- **`'persistent'`** copies survive launches, are not purged by the OS, and are not backed up. The app removes them (`PdfCache`).
- A response that is not a PDF (a login page, a captive portal) fails with `invalid-pdf` and is never stored: check the URL and headers.
- Certificates are always validated. Downloads use `GET`, run while the app runs, and have no total size limit.
- For another method (POST with a body), download the file in app code and open it as `{ filePath }`.

## PdfCache: download ahead, check, remove

`PdfCache` takes the same `PdfUriSource` object as the view, so both refer to the same stored copy.

```ts
import { PdfCache, PdfDownloadError } from 'react-native-better-pdf';

const controller = new AbortController();
try {
  const entry = await PdfCache.download(source, {
    onProgress: ({ loadedBytes, totalBytes }) => setProgress({ loadedBytes, totalBytes }),
    signal: controller.signal,
  }); // { filePath, byteSize, cache, validatedAtMs }
} catch (error) {
  if (error instanceof PdfDownloadError && error.httpStatus === 401) await refreshToken();
  // a cancelled download rejects with an AbortError
}

await PdfCache.getEntry(source); // the stored copy, or undefined; no network
await PdfCache.remove(source);   // true when there was a copy
await PdfCache.getByteSize();    // all stored copies, in bytes
await PdfCache.clear();          // e.g. on sign-out
```

- `download` resolves at once when the stored copy is fresh enough, and joins a download of the same copy already running (a `PdfView`'s too). It never falls back to an outdated copy: it rejects with `PdfDownloadError` (`code`, `httpStatus`), and the old copy stays.
- Cancelling stops the download unless a `PdfView` is waiting for it too.
- `remove` and `clear` leave documents on screen alone.
- There is no listing of stored copies and no size limit: the app records what it downloaded ("available offline" lists) and removes what is no longer needed.
- Session copies from the previous launch are deleted on first use.

## Base64 data

`data:` URIs are unsupported by design: they push the whole file through the JS heap. Write the data to a file once, then open the file.

Expo (`expo-file-system`'s `File` API):

```ts
import { File, Paths } from 'expo-file-system';

const file = new File(Paths.cache, `${documentId}.pdf`);
file.write(base64, { encoding: 'base64' });
<PdfView source={{ uri: file.uri }} />;
```

Bare React Native: write it with the file-system library the app already has (`RNFS.writeFile(path, base64, 'base64')`, `ReactNativeBlobUtil.fs.writeFile(path, base64, 'base64')`), then open `{ filePath: path }`.
