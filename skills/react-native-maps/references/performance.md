# Performance

Name the **layer** before changing code. Most "slow map" reports mix several of these.

```text
1. React render cost
2. JS ↔ native communication cost
3. Native map rendering cost   (tiles / MapKit / Google Maps)
4. Marker / annotation cost
5. Clustering cost             (only if another library is in the stack)
```

Map FPS and React FPS are different meters. A smooth JS thread can still drop frames in the map SDK; a cheap map SDK can still hitch on React commits.

Do not start with `React.memo` on everything, `tracksViewChanges={false}` without a UX check, a native rewrite, a library swap, or "add clustering". Measure first.

## Diagnostic loop

1. Workload: marker count, custom vs image vs default pin, provider, platform, debug vs release, device vs emulator, gesture (pan / zoom / idle).
2. Baseline a number on a **release** build on a **real device**.
3. Identify the layer with the table below.
4. Smallest change that targets that layer.
5. Re-measure. No improvement claim without before/after on the same workload.

## Symptom → layer → measure → next action

| Symptom | Likely layer | Measure | Next action |
| --- | --- | --- | --- |
| Parent re-renders on every pan; React Profiler lights up; markers remount | 1 React | Why-did-you-render / Profiler; `onRegionChange` setting state | Drive camera with `initialRegion` + ref, or `onRegionChangeComplete` only. Stabilize Marker `key` and props. |
| Many `<Marker>` children, props churn, Fabric/bridge busy, JS not obviously hot | 2 JS ↔ native | Count mounted overlay views; log region-event rate | Fewer children, fewer prop changes, avoid new style/callback identities per frame. |
| Tiles crawl; map body janky with **few** markers; emulator / no Play Services | 3 map SDK | Native GPU/CPU in Instruments / Android Studio; compare Apple vs Google | Check keys, renderer, `liteMode` (static Android maps only), device. Not a clustering rewrite. |
| Custom view markers; Android worse; `tracksViewChanges` left default | 4 markers | Toggle `tracksViewChanges`; compare image pins vs view children; watch `ViewChangesTracker` | Image/`icon` pins; set `tracksViewChanges={false}` after first paint; `redraw()` on real updates. |
| Clusters wrong, or FPS scales with **visible bubbles** after clustering | 5 clustering | See [clustering.md](clustering.md) | Fix the clustering library / visible Marker count. Do not add a heavier algorithm to hide annotation cost. |
| iOS fine, Android slow, similar marker count | 3 or 4 | Same dataset, both devices, custom vs default pins | Android bitmaps custom children (`MapMarker.java`). Provider/platform, not "Android is broken JS". |

## Layer 1 — React render

Cadence that hurts: **per `onRegionChange`**. That callback is continuous while dragging (`MapView.tsx`).

```tsx
// Typical self-inflicted hitch
<MapView region={region} onRegionChange={setRegion}>
  {points.map(p => <Marker key={p.id} coordinate={p} />)}
</MapView>
```

Each event: setState → MapView re-render → all Marker elements reconciled → native annotation updates.

Prefer:

- `initialRegion` (uncontrolled after mount) and `animateToRegion` / `animateCamera` / `setCamera` on the ref
- or `onRegionChangeComplete` if you must keep region in React

`React.memo` on a Marker component only helps if props are referentially stable. Memo that still returns new `coordinate` / `style` / inline `onPress` objects does not stop native updates.

Children are skipped until `onMapReady`. A hitch **once** at ready is often first mount of N markers, not a pan problem.

## Layer 2 — JS ↔ native

Cost scales with **mounted overlay views** and how often their props change. This library has no bulk `markers={[]}` fast path.

Actions that actually hit this layer: fewer views, don't rebuild `coordinates` arrays on unrelated renders, don't animate marker props from JS every frame.

Do not assume "the JS thread is the bottleneck" without a JS profile. Do not assume it isn't, either.

## Layer 3 — Native map SDK

Google Maps vs MapKit are different renderers. Android is always Google. iOS Apple vs iOS Google will not match.

`liteMode` (Android) snapshots a non-interactive map — useful for lists of maps, useless as a pan/zoom fix.

`googleRenderer` (`LATEST` \| `LEGACY`) is Android-only. Do not set it on iOS.

Blank/grey tiles with a Google logo are usually API keys, not FPS. See [providers.md](providers.md).

## Layer 4 — Markers

Default pins are cheap relative to custom React children.

Android (`ViewChangesTracker`, `MapMarker.java`):

- `tracksViewChanges` defaults `true`
- Custom children → `hasCustomMarkerView` → bitmap snapshot onto `GoogleMap` markers
- Tracker posts a runnable every **40 ms** while any tracked marker remains

iOS Google: `GMSMarker.tracksViewChanges` (same default). iOS Apple: `tracksViewChanges` is documented as not the Apple path — don't use it as a MapKit lever.

Recommended pattern for custom markers that don't animate:

1. Render the custom view.
2. Set `tracksViewChanges={false}` once (after load, or immediately if static).
3. Call `redraw()` when content actually changes.

Turning tracking off while an image is still loading can freeze a blank icon — that is why the Android code comments warn about racing `setState({ tracksViewChanges: false })` with image load.

`tracksInfoWindowChanges` is a separate, iOS-Google-only cost. Leave it false unless the info window must live-update.

## Layer 5 — Clustering

`react-native-maps` does not cluster. A clustering library still mounts RN Maps `<Marker>`s for visible clusters/leaves. Faster clustering with the same visible Marker count will not raise map FPS.

If the user does not have a clustering library, do not add one as the first performance fix. Viewport culling or fewer markers may be enough. If they do, open [clustering.md](clustering.md).

## What not to do

- Memoize the tree and declare the map fixed
- Disable `tracksViewChanges` on markers whose children still animate, without checking the visual result
- Rewrite `ios/` or `android/` because JS is re-rendering
- Swap the map library before the layer is named
- Quote FPS numbers you did not measure on a release device
