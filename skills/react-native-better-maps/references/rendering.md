# React rendering

Why markers re-render, what it actually costs, and how to stop it. This is the layer where most
"the map is laggy" reports are actually caused.

## Region callbacks do not fire per frame

Start here, because it contradicts the habit most people bring from `react-native-maps`, and
because it changes what you should be looking for.

Both events fire **once per user gesture**:

| Event | When |
| --- | --- |
| `onRegionChange` | Once, when a gesture-driven camera move begins |
| `onRegionChangeComplete` | Once, when it settles |

Verified in all three adapters. Each keeps an `isUserRegionChange` / `isUserGesture` latch: the
"will change" handler returns early unless the move was user-initiated *and* the latch is clear,
and the "did change" handler only emits once the interaction has actually ended. On iOS, MapKit's
`regionDidChangeAnimated` fires repeatedly during a drag and every one of those calls is discarded
while `view.isUserInteracting`.

Two consequences worth internalising:

**Programmatic camera moves emit neither event.** `setCamera`, `animateCamera`, `fitToCoordinates`,
and a changed `region` prop all move the map silently. If you were relying on `onRegionChange` to
observe your own camera calls, it will not fire — track that state yourself, or read
`getVisibleRegion()` after awaiting the move.

**`onRegionChange` is not a live stream.** There is no per-frame region callback in this library at
all. If you need the region continuously — for a coordinate readout that updates as you drag, say —
you cannot get it, and that is a genuine gap rather than something to work around with a timer.

So the classic `region`/`onRegionChange` feedback loop is largely designed out. The `region`
observer is also guarded by `!isUserInteracting`, so a value arriving mid-gesture is dropped rather
than yanking the camera back.

## The loop that can still bite you

Once per gesture is not zero, and this shape still costs more than it needs to:

```tsx
// Re-renders the whole subtree twice per gesture, rebuilding every descriptor
const [region, setRegion] = useState(initialRegion);

return (
  <MapView region={region} onRegionChangeComplete={setRegion}>
    {places.map((p) => (
      <Marker key={p.id} id={p.id} coordinate={p.coordinate} />
    ))}
  </MapView>
);
```

Each gesture sets state, the component re-renders, `children` is a brand-new array of brand-new
elements, `useCollectedOverlays` rebuilds every descriptor, and the whole marker array crosses the
boundary. With 50 markers that is invisible. With 5,000 it is a visible hitch at the end of every
pan, and it happens for a region value you may not even be reading.

Three fixes, in order of preference:

**1. Do not store the region in state at all.** If nothing renders from it, keep it in a ref:

```tsx
const regionRef = useRef(initialRegion);

<MapView
  region={initialRegion}                                  // set once; not driven by state
  onRegionChangeComplete={(r) => { regionRef.current = r; }}
/>
```

**2. If you do need it in state, keep markers out of that render.** Move the map and its overlays
into a child component that does not read region state, or memoise the marker array so its identity
survives the parent's re-render.

**3. Debounce the work, not the event.** The event is already once-per-gesture; if a settled pan
triggers a refetch, debounce the fetch rather than adding another render pass.

## What each render actually costs

### With `<Marker>` children

`useCollectedOverlays` is a `useMemo` keyed on `[children]`. JSX children are a fresh array (or a
fresh element) on every render, so **that memo invalidates every time the parent renders**. There
is no escape from it through memoisation of individual markers; the collection walk is per-render
by construction.

Per render, per marker, the collector does: an `isValidElement` check, a linear scan over four
collector entries, an id resolution, an object literal build, a `resolveMarkerImage` call (LRU hit
for a repeated `require()`), a `normalizeEnteringAnimation` call that allocates a new object, and a
`Map.set` into the callback registry.

That is cheap for 20 markers and expensive for 2,000.

### With the bulk `markers` prop

```tsx
const markers = useMemo(
  () => places.map((p) => ({ id: p.id, coordinate: p.coordinate })),
  [places],
);

<MapView markers={markers} onMarkerPress={handlePress} />
```

`normalizeMarkerDescriptors` runs inside a `useMemo` keyed on `[markersProp]`, so a stable array
identity means **zero per-render work**. That is the whole point of the bulk path.

It also has a referential-stability optimisation: it compares each normalised descriptor field by
field against the input and returns the *original* array when nothing changed, so a descriptor that
needed no normalisation keeps its identity and native's fingerprint check short-circuits.

One caveat: passing `image: require('./pin.png')` (a number) means the descriptor always needs
normalising into `{ uri, ... }`, so the comparison always reports "changed" and a new array is
produced each time the memo runs. That is fine as long as your memo dependency is stable — but it
means the array identity is not preserved across a genuine recompute.

**Use the bulk prop for anything above a few dozen markers.** The library's own types say so, and
this is why.

## The boundary cost

When a prop actually changes, Nitro's `JSIConverter` constructs a C++ struct per marker: a
`std::string` for the id, a nested coordinate, and each optional field. Fabric's generated
`HybridMapViewProps` reads changed props from `RawProps` and keeps the previous value for unchanged
ones, so an unchanged `markers` prop costs nothing at all.

There is no per-marker patch protocol. A changed `markers` prop is a whole new array, converted in
full. Native then hashes the array (`markersFingerprint`) and returns early if the hash matches —
which saves the SDK churn, not the conversion. By the time the fingerprint is computed, the
crossing has already been paid.

The practical consequence: **changing one marker in a 5,000-element array costs the same crossing
as changing all of them.** If you have a small hot subset that updates frequently and a large cold
set that does not, there is no built-in way to split them — you would need two maps, or to accept
the cost.

Do not describe this path as "zero-copy" or "no bridge". Nitro removes the asynchronous batched
bridge; the per-field conversion is still real work proportional to the array.

## Stable ids

`id` is optional on the overlay components. When you omit it, the collector assigns
`` `${type}-${index}` `` from the position in the child list.

```tsx
// Bad: filtering shifts every id after the removed item
{places.filter(visible).map((p) => <Marker coordinate={p.coordinate} />)}
```

After a filter, `marker-3` is now a different place. Press callbacks route to the wrong handler,
and native — which diffs by id — treats moved markers as removed-and-added, so they re-animate and
lose any in-place update path.

Always pass a stable `id` for anything that can be reordered, filtered, or paginated. The React
`key` is not enough; `key` is invisible to the collector, which reads `props.id`.

## Callbacks

Overlay `onPress` handlers never cross the boundary. They are stored in a JS `Map` keyed by
`` `${overlayType}:${id}` ``, native emits the id, and `MapView` looks the handler up and calls it,
then calls the map-level prop if you also passed one.

Two implications:

- Handler identity does not matter for boundary cost. An inline arrow function in `<Marker onPress={() => …}>`
  does not cause a native prop update — but it does still participate in the per-render collection
  walk described above.
- Native listeners are only registered when *something* needs them. `hasMarkerPress` is true if any
  collected marker has an `onPress` or the map has an `onMarkerPress`. If nothing does, the event
  never crosses at all.

## Things that are not the problem

Before optimising markers, rule these out:

- **Provider remount.** Changing `provider` or `googleMapId` destroys and recreates the native map.
  If either is derived from state, you may be remounting the map, not re-rendering markers.
- **A new `style` object.** `style={{ flex: 1 }}` inline is a new object each render. It is cheap,
  but it is a changed prop.
- **`markerEnteringAnimation` / `clusterEnteringAnimation`.** `MapView` calls
  `normalizeEnteringAnimation(...)` inline in its render, so these props get a fresh object identity
  on every render even when your value is unchanged. Whether that triggers native work depends on
  Nitro's prop comparison — **INFERENCE**, not verified. If you are chasing the last few
  milliseconds, hoisting a constant config object out of render costs nothing to try.
- **Your own list rendering.** A `FlatList` of places beside the map re-rendering at gesture
  frequency looks identical to map jank from the user's side.

Confirm which of these is happening with the React DevTools profiler before touching marker data —
see [performance.md](performance.md).

## Summary

| Situation | Do this |
| --- | --- |
| Fewer than ~50 static markers | `<Marker>` children are fine |
| Hundreds or thousands | Bulk `markers` prop with a stable memoised array |
| Live region needed in state | Keep it out of the component that renders markers |
| Anything reorderable or filterable | Explicit stable `id` on every overlay |
| Frequent updates to a few markers | Accept the full-array crossing, or reduce the array |
| Chasing jank | Profile the four layers in [performance.md](performance.md) first |
