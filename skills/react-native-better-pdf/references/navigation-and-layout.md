# Navigation and layout

## The ref

```tsx
import { useRef } from 'react';
import { PdfView, type PdfViewRef } from 'react-native-better-pdf';

const pdf = useRef<PdfViewRef>(null);
<PdfView ref={pdf} style={{ flex: 1 }} source={source} />;

pdf.current?.goToPage(41);                    // zero-based, animated
pdf.current?.goToPage(0, { animated: false });
pdf.current?.zoomTo(2);                       // relative to the fitted page; zoomTo(1) resets
pdf.current?.goToViewport(saved);             // a position from onViewportChange, no animation
```

Position props (`initialPage`, `initialScale`, `initialViewport`) apply once per loaded document. There is no controlled `page` or `scale`.

Keep the page the reader is on (from `onPageChange`, for display) apart from jumps the app requests. Requested jumps call `goToPage` where they happen: a button handler, a table-of-contents press. A target that arrives from outside (a deep link, a parent's prop) goes through an effect keyed on that target. Feeding the reported page back into `goToPage` snaps the reader to the top of their page after every scroll.

## Events

All events are settled; there is no `onScroll` or per-frame zoom event.

| Event | Fires |
| --- | --- |
| `onPageChange({ page, pageCount })` | once after loading with the page the document opened on, then whenever the page under the viewport centre changes (the last page once scrolled to the end) |
| `onScaleChange({ scale })` | once per finished pinch, double tap or `zoomTo` |
| `onViewportChange({ viewport, firstVisiblePage, lastVisiblePage, isAtEnd })` | once after loading, then whenever the view stops moving and the position changed |

## Reading position

```tsx
const saved = storage.get(documentId); // a PdfViewport, or undefined

<PdfView
  source={source}
  initialViewport={saved}
  onViewportChange={({ viewport, isAtEnd }) => {
    storage.set(documentId, viewport); // fires on settle only: no throttling needed
    if (isAtEnd) markAsRead(documentId);
  }}
/>;
```

- `PdfViewport` is `{ page, x, y, scale }`: the point of `page`, in PDF points from its top-left, at the view's top-left corner, plus the zoom. It survives rotation, other devices and other layouts; store it as JSON. `x` / `y` are negative in the margin or gap before the page.
- `initialViewport` takes precedence over `initialPage` / `initialScale`.
- `goToViewport` gives "back to where I was", e.g. after following a table-of-contents entry.
- Paged layouts (`enablePaging`, `singlePage`) restore the page and zoom; iOS does not restore the position within a zoomed page.

## Table of contents

```tsx
const [toc, setToc] = useState<PdfOutlineItem[]>([]);

<PdfView
  ref={pdf}
  source={source}
  onLoad={() => {
    pdf.current
      ?.getOutline()
      .then(setToc)
      .catch(() => setToc([])); // rejects for encrypted documents on Android
  }}
/>;

// Each item: { title, page?, children }. Render the tree recursively:
<Pressable onPress={() => { if (item.page !== undefined) pdf.current?.goToPage(item.page); }}>
  <Text>{item.title}</Text>
</Pressable>;
```

`page` is `undefined` for entries that only group others or point outside the document. On Android, `getOutline` rejects for encrypted documents.

## Layouts

| Want | Props |
| --- | --- |
| Vertical continuous scroll (default) | none; `fitPolicy` defaults to `'width'` |
| Pages side by side | `horizontal` |
| One page per swipe | `enablePaging` (vertical swipes), `horizontal enablePaging` (book-style) |
| Right to left | `horizontal enableRTL` (iOS: with `enablePaging` only); page numbers stay in document order |
| One static page, e.g. a thumbnail | `singlePage` with `initialPage`; switched by `goToPage`; ignores touches |
| Facing pages on tablets | `spreadMode="pairs"` (1–2, 3–4…) or `"book"` (cover alone, then 2–3…) |
| Fit | `fitPolicy="width" \| "height" \| "page"`; `'page'` is the default with `horizontal`, `enablePaging` or `singlePage` |
| Inside a `ScrollView` | `scrollEnabled={false}`: drags go to the parent; zoom, taps and `goToPage` still work |

- `spreadMode` and `contentInset` apply to vertical continuous layouts only; other layouts ignore them.
- Switching layout or `spreadMode` keeps the reader's page. For facing pages on rotation: `spreadMode={width > height ? 'book' : 'none'}` with `useWindowDimensions()`.
- `pageSpacing` defaults to 8 (dp / pt).
- A document shorter than the view starts at the top in vertical layouts; horizontal layouts centre pages across; paged layouts centre each page.

## Translucent bars

```tsx
<View style={{ flex: 1 }}>
  <PdfView source={source} style={{ flex: 1 }} contentInset={{ top: headerHeight, bottom: toolbarHeight }} />
  <View style={[StyleSheet.absoluteFill, { bottom: undefined, height: headerHeight, backgroundColor: 'rgba(255, 255, 255, 0.85)' }]} />
</View>
```

Pages scroll under the bars, but the first page starts below `top` and the document ends above `bottom`. Every position refers to the area between the bars: `goToPage`, viewports, the current page, `isAtEnd`, search scrolling and `fitPolicy`. Without translucent bars, a `SafeAreaView` around the viewer is enough: the viewer adds no safe-area insets of its own.

## Dark pages

```tsx
const scheme = useColorScheme();
<PdfView
  source={source}
  colorScheme={scheme} // 'dark' inverts lightness and keeps hues; anything else keeps pages as they are
  style={{ flex: 1, backgroundColor: scheme === 'dark' ? '#27272A' : '#E4E4E7' }}
/>;
```

- The area around pages is the view's `backgroundColor`: give it a dark one too.
- Photos are inverted as well. Search and selection highlights keep their colours; `renderPage` and printing keep the document's colours.
- iOS draws annotations apart from the page, so they keep their own colours.

## Accessibility

Screen readers read each page's text and position. Localise the page label with `pageAccessibilityLabel`, e.g. `"Strona {page} z {pageCount}"` (default `'Page {page} of {pageCount}'`). On Android below 15 (except 12–14 with SDK extension 13), only the label is read.
