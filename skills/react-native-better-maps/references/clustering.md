# Clustering and viewport selection

How `clusteringEnabled` actually works, and why markers disappear when it is off. Verified against
`ios/MarkerClusterEngine.swift`, `ios/MarkerViewportFilter.swift`, and the matching Kotlin files at
v1.1.0.

Clustering here is implemented natively in Swift and Kotlin. It is **not** Supercluster, not a
kd-tree, and shares no code with `react-native-better-clustering`. Do not carry
assumptions across. If the app clusters on `react-native-maps` instead, load the
`react-native-better-clustering` skill.

## Two selection modes

Both are reached through the same viewport pipeline, which activates when clustering is enabled
**or** there are more than 500 descriptors.

| `clusteringEnabled` | What happens |
| --- | --- |
| `true` | `MarkerClusterEngine.clusters(...)` — grid buckets, merged by badge overlap |
| `false` | `MarkerViewportFilter.displaySubset(...)` — a zoom-dependent cap with spatial subsampling |

Both run on a background queue over candidates pre-narrowed by a spatial index, and both produce a
diff that is applied on the main thread.

## The clustering algorithm

A quantised geographic grid with a screen-space merge pass. Six steps:

**1. Split out opted-out markers.** `clusterable === false` bypasses clustering entirely and always
renders as an individual marker. Everything else is a clustering candidate. Note the check is
`descriptor.clusterable == false` — `undefined` means clusterable.

**2. Derive the grid from the screen.** Columns and rows come from the view size divided by a target
cell size, so a larger map gets a finer grid. **The target differs by provider:**

| Backend | Target cell | Source |
| --- | --- | --- |
| iOS + Apple | **64 pt** | `MarkerClusterEngine.defaultCellPoints` |
| iOS + Google | **96 pt** | `GoogleMapOverlayController.clusterCellPoints` |
| Android | **64 dp** | `MarkerClusterEngine.CELL_DP` |

So the same dataset at the same zoom clusters more aggressively under Google on iOS than under
Apple. That is deliberate — marker churn is more expensive on the Google backend — but it means
cluster counts are not comparable across providers.

```text
cols    = max(1, viewWidth  / cellSize)
rows    = max(1, viewHeight / cellSize)
cellLat = quantize(regionLatitudeSpan  / rows)
cellLon = quantize(regionLongitudeSpan / cols)
```

**3. Quantise the cell size to a power of two.** `quantize(v) = 2^round(log2(v))`. This is the key
design decision: cells are anchored to absolute (0, 0) in geographic space and snap to octaves, so
**panning does not move the grid**. Clusters stay put instead of "swimming" under your finger, and
they only re-form when the zoom crosses a power-of-two boundary.

The visible cost is that cluster membership changes in discrete jumps at those boundaries rather
than smoothly. That is intentional.

**4. Bucket by cell.** `key = "${floor(lat / cellLat)}:${floor(lon / cellLon)}"`. Each bucket
accumulates a count, a coordinate sum, a bounding box, and the member id list.

**5. Merge overlapping badges.** Bucket centroids are projected to screen space and union-find
merges any pair whose drawn badges would overlap:

```text
merge if  distance(centroid_i, centroid_j) < radius(count_i) + radius(count_j) + 6
```

Badge radii, shared with the drawn views so the test matches reality:

| Count | Radius (pt / dp) | Drawn diameter |
| --- | --- | --- |
| 1 | 14 | — |
| 2–9 | 17 | 34 |
| 10–99 | 20 | 40 |
| 100–999 | 24 | 48 |
| 1000+ | 28 | 56 |

Merge gap: **6**. Groups are seeded by the largest bucket first, so the surviving cluster key is the
dominant cell's — which keeps the diff key stable as counts shift.

**6. Emit.** A bucket of exactly one becomes a `single`, not a cluster of one. Everything else
becomes a cluster positioned at the **arithmetic mean** of its members' coordinates.

### There is no `minPoints` and no `radius` prop

`clusteringEnabled` is a boolean. Cell size, badge radii, and the merge gap are compile-time
constants in native source with no prop, no config object, and no runtime override. If you need
different clustering parameters, you are looking at a library change — see
[contributing.md](contributing.md).

Similarly there is no `maxZoom` at which clustering disengages. Clusters dissolve naturally: as you
zoom in, the quantised cell shrinks, buckets end up holding one marker each, and each emits as a
single.

### Antimeridian

Handled, in both engines. When `longitudeDelta > 180` the region is treated as wrapping; longitudes
are normalised relative to the region's western edge before bucketing, and cluster bounds are
wrapped back into −180…180 on output. A cluster spanning the dateline groups correctly rather than
splitting into two.

### Cluster tap

`onClusterPress(markerIds, coordinate)` gives you every member id and the cluster's centroid, so
you can drive your own behaviour — open a list, filter, whatever.

**The zoom-to-extent is not conditional on your handler.** Both platforms invoke `onClusterPress`
*and then* animate the camera, unconditionally, in the same code path
(`HybridMapViewDelegate.mapView(_:didSelect:)` on iOS, `MapOverlayController.onMarkerClick` on
Android). There is no return value or event object you can use to prevent it. If your handler opens
a bottom sheet listing the members, expect the map to zoom underneath it at the same time — and if
that is unacceptable, the workaround is to not use clusters for that interaction, or to move the
camera back yourself after the animation.

The two platforms compute the extent slightly differently:

- **iOS** builds a region from the members' bounding box scaled by **1.6×**, with a floor of
  **0.01°** in each delta, so a tap never zooms in absurdly far on a tightly packed cluster.
- **Android** animates `newLatLngBounds` to the raw member bounds with **72 dp** of padding.

The result is visually similar and numerically different. Do not assert equality across platforms.

## Viewport filtering (clustering off)

With clustering off and more than 500 markers, `MarkerViewportFilter` caps how many render, based
on the visible latitude span:

| `latitudeDelta` | Max markers |
| --- | --- |
| < 0.08 | 2,000 |
| < 0.5 | 800 |
| < 2.0 | 350 |
| ≥ 2.0 | 200 |

**This is why markers disappear when you zoom out.** It is level-of-detail, not a bug, and not
something a prop can turn off.

When the visible count exceeds the cap, the filter does not truncate the list. It buckets markers
into a roughly `√maxCount × √maxCount` grid over the region and takes the **median element of each
bucket**, so the survivors stay evenly spread rather than clumping wherever your array happened to
start.

If you need every marker visible at low zoom, enable clustering — that is the supported answer.

## The spatial index

`MarkerSpatialIndex` is a **96 × 96 uniform grid** over the bounding box of all markers, built once
per marker-set change on the compute queue. It is immutable after construction, which is what makes
querying it from a background thread safe.

Queries expand the visible region by **0.2 of its span** in each direction before selecting cells,
so markers just off-screen are still candidates and appear immediately when you pan. The viewport
filter applies the same 0.2 padding again when testing precise containment.

A uniform grid is the right choice given the access pattern — one build, many rectangular
range queries — but it degrades when markers are extremely unevenly distributed: a dataset that is
99% concentrated in one city and 1% worldwide puts almost everything in a handful of the 9,216
cells, and a query over that city scans nearly the whole set.

## Diffing

Elements carry a `diffKey` and a `renderVersion`:

```text
diffKey        "s:<markerId>"  or  "c:<row>:<col>"
renderVersion  a hash of the element's visual content
```

The diff compares the target set against a map of currently displayed key → version:

- **Key absent from displayed** → added.
- **Key present, version differs** → retained, updated in place.
- **Key in displayed but not in target** → removed.

The retained path matters for gestures: a cluster whose count changes from 12 to 13 keeps the same
`diffKey` and updates its badge in place, instead of being removed and re-added — which would
re-trigger the entering animation and cause visible flicker.

The `renderVersion` hash covers id, coordinate, title, subtitle, `draggable`, and `clusterable` for
singles; and key, position, count, sorted member ids, and bounds for clusters. **Fields not in the
hash do not trigger an in-place update.** `image`, `anchor`, `rotation`, `opacity`, and `flat` are
absent from it. Changing a retained marker's image alone may therefore not repaint it — treat this
as a known sharp edge, and change the id if you need a guaranteed refresh.

## Threading

| Stage | Thread |
| --- | --- |
| Spatial index construction | Background (`com.nitromaps.markerCompute`, `.userInitiated`, on iOS) |
| Candidate query | Background |
| Cluster computation / viewport filter | Background |
| Diff computation | Background |
| Diff application to the SDK | Main |

The engines are pure functions over descriptor data — they never touch `MKMapView` or `GoogleMap`
projection APIs, which is precisely what makes off-main computation legal.

Staleness is handled by a monotonically increasing `refreshGeneration`. Every scheduled refresh
captures the current value and discards its result on the main thread if the counter has moved on,
so a slow computation from three pans ago can never overwrite a fresh one. Preserve that check in
any new async path.

## Refresh cadence

| Trigger | iOS + Apple | iOS + Google | Android |
| --- | --- | --- | --- |
| Live, during a gesture | 0.1 s timer | **0.18 s** | 180 ms throttle |
| Settle, after a gesture | 0.12 s debounce | 0.12 s debounce | 120 ms debounce |
| Animated markers per diff | **uncapped** | 96 | 96 |
| Animated markers per **live** diff | uncapped | 24 | 24 |

The animation budgets exist to protect gesture frame rate: applying entering animations to hundreds
of markers at once is main-thread work. Note that the **Apple provider has no cap at all** —
`MapOverlayController.swift` contains no animation budget, and MapKit's `didAdd views:` animates
every newly added annotation. If entering animations cause a visible hitch on a large Apple-provider
refresh, turning them off is the only lever; there is no threshold to lower.

If gestures stutter during large viewport refreshes on any backend, **disable entering animations
first** — before touching thresholds.

## Tuning, in order

1. **Enable clustering.** It bounds the number of native markers by the number of grid cells that
   fit on screen, which is a constant, not a function of your dataset size.
2. **Use the bulk `markers` prop** with a stable array identity. See
   [rendering.md](rendering.md).
3. **Mark genuinely-individual markers `clusterable: false`** sparingly. Each one bypasses the
   bucketing and renders unconditionally, so a thousand of them defeats the purpose.
4. **Turn off entering animations** if gestures stutter during refreshes.
5. **Reduce the dataset** before it reaches the map, if your data allows server-side filtering by
   viewport.

Anything past that is a library change. Measure first — [performance.md](performance.md).
