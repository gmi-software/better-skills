# Search, text selection, forms, page overlays

## Search

```tsx
const [search, setSearch] = useState<PdfSearchChangeEvent>();

<PdfView ref={pdf} source={source} onSearchChange={setSearch} />;

pdf.current?.search(query);   // a new query restarts the search; '' clears it
pdf.current?.searchNext();    // or searchPrevious(); both wrap around
pdf.current?.clearSearch();

// "3 / 17", or "3 / 17…" while the rest of the document is still searched
const label =
  search?.isSupported === false
    ? 'Search unavailable'
    : `${(search?.currentMatch ?? -1) + 1} / ${search?.matchCount ?? 0}${search?.isComplete ? '' : '…'}`;
```

- Native and in the background, case-insensitive. Matches are highlighted as pages are searched, starting at the current page; the first match at or after it becomes current and is scrolled into view.
- `onSearchChange({ query, matchCount, currentMatch?, currentPage?, isComplete, isSupported })` fires at most 10 times a second while searching, and at once for the first match, `searchNext` / `searchPrevious`, completion and clearing. `currentMatch` and `currentPage` are zero-based.
- Every `search(query)` call restarts the search: wire it to a submit action or a debounced input.
- Loading another document ends the search with an event whose `query` is `''`.
- Colours: `searchHighlightColor` (default translucent yellow) and `searchCurrentHighlightColor` (orange). Use translucent colours; `PlatformColor` / `DynamicColorIOS` fall back to the defaults.
- Android needs 15+, or 12–14 with SDK extension 13. Elsewhere the search ends at once with `isSupported: false`: hide or disable the search UI then.

## Text selection

- On by default (`enableTextSelection`): long press selects, handles adjust it, the system menu copies. `false` turns selection off.
- `onTextSelectionChange({ text })` fires once per settled selection; `text` is `''` when cleared. A tap on the page clears the selection and is still an `onPageTap`.
- Android: 15+ (or 12–14 with SDK extension 13), one page at a time; elsewhere long presses are ignored. iOS selections can span pages.

## Forms (AcroForm)

```tsx
<PdfView ref={pdf} source={source} onFormChange={({ field }) => markDirty(field.name)} />;

const fields = await pdf.current!.getFormFields();
// [{ name: 'name', type: 'text', value: '', isRequired: true, widgets: [{ page: 0, x, y, width, height }] },
//  { name: 'agree', type: 'checkbox', isChecked: false, … },
//  { name: 'plan', type: 'radio', value: 'basic', options: ['basic', 'pro'], … }, …]

await pdf.current!.setFormFieldValues({
  name: 'Anna',             // text, or a combo box's option
  agree: true,              // checkbox
  plan: 'pro',              // radio: the option
  colours: ['Blue'],        // list box: the options
  'address.city': 'Kraków', // fully qualified names
});

const { filePath } = await pdf.current!.exportDocument(); // the filled-in PDF, to share or upload
```

- Readers fill fields in by touch unless `enableFormFilling={false}`.
- `PdfFormField` is discriminated by `type`: `'text'`, `'checkbox'`, `'radio'`, `'combo-box'`, `'list-box'`, `'signature'`, `'push-button'`. Narrow on `type` before reading `value`, `isChecked` or `values`. Choices are their displayed labels.
- `setFormFieldValues` is all or none: it rejects, changing nothing, for an unknown or read-only field, or a value the field's type does not take. It does not fire `onFormChange`, which reports the reader's own changes only (at once for toggles and choices, when editing ends for text).
- `exportDocument()` writes a new file (the cache directory by default, or `{ filePath }`), keeps password protection, and never changes the source file. Edits live with the open document: reopening the source shows it as stored, so export to keep them.
- `widgets` locate each field in `onPageTap` coordinates: place a `PdfPageOverlay` there, e.g. on a signature field (signature fields are reported but cannot be signed).
- Form methods, `print` and `renderPage` end text editing first, so what the reader is typing counts. Each form method rejects before `onLoad`.
- Android: filling in needs 15+, or 12–14 with SDK extension 13; elsewhere `getFormFields` still reads the fields, `setFormFieldValues` rejects and `exportDocument` copies the file.
- JavaScript actions and calculations in the form do not run; XFA forms are not supported.

## Page overlays

```tsx
import { PdfPageOverlay, PdfView } from 'react-native-better-pdf';

<PdfView source={source} style={{ flex: 1 }}>
  {markers.map((marker) => (
    <PdfPageOverlay
      key={marker.id}
      page={marker.page} // zero-based
      x={marker.x}       // PDF points from the page's top-left, as onPageTap reports them
      y={marker.y}
      width={180}        // dp / pt at zoom 1
      height={40}
    >
      <Pressable style={{ flex: 1 }} onPress={() => sign(marker)}>
        <Text>Sign here</Text>
      </Pressable>
    </PdfPageOverlay>
  ))}
</PdfView>;
```

- `PdfPageOverlay` renders inside a `PdfView`'s children, at any depth; outside one it throws. Native code moves overlays in the same frame as their page while it scrolls and zooms; no JS runs per frame.
- An overlay scales with the page, as if printed on it. `scalesWithZoom={false}` keeps its size, with its top-left corner on the point (pins, badges).
- To drop an overlay where the reader tapped, store the `onPageTap` event: its `{ page, x, y }` are overlay coordinates.
- Position and size come from the props only: `style` cannot move or resize an overlay, and a `transform` on it is overwritten. Transform a view inside it instead.
- Hidden while its page is off screen. Touches between overlays reach the document.
- Meant for tens of overlays. They are not clipped to their page, and are not drawn in `renderPage` images or printing.
