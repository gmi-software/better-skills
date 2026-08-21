# Clustering

`react-native-maps` **does not cluster markers**. There is no `clusteringEnabled` prop, no cluster component, and no cluster engine in `src/`.

```text
react-native-maps     ≠     clustering algorithm
(map view + markers)        (which points share a bubble)
```

If the user said "clusters are wrong", this library is the wrong first suspect.

## What people actually install

Clustering in this ecosystem is a **separate layer** that:

1. Takes a point list + current region/zoom
2. Returns cluster nodes + leaves
3. Renders those as `react-native-maps` `<Marker>` children

Visible bubbles are still RN Maps markers. Native annotation cost does not go away. A faster algorithm with 400 visible Markers can still hitch; a slow algorithm with 20 visible Markers can still look fine.

Common packages (names only — verify their APIs in *their* source):

- `react-native-better-clustering` — C++ Supercluster over Nitro; default `MapView` still mounts RN Maps `<Marker>`s
- `react-native-map-clustering`, `react-native-clusterer` — JS/native clustering helpers used the same way

This skill does not document those APIs. If the problem is membership, zoom thresholds, aggregation, or that library's setup, load the `react-native-better-clustering` skill when that is the package in use (or the user is choosing a clustering library on RN Maps).

Google-Maps-iOS-Utils is a **native dependency** of the iOS Google subspec (heatmaps, KML, …). Installation docs mention "Marker clustering" among Google-utils features that **error on Apple Maps**. That is not a JS clustering API. Do not tell the user to pass a Supercluster option to `MapView`.

## When clustering is an appropriate suggestion

Suggest clustering only when:

- Point count is large **and** showing every point at the current zoom is the product requirement that is failing
- The user is not already clustered
- You have ruled out the cheaper RN Maps issues: controlled `region` + `onRegionChange`, `tracksViewChanges`, custom-view markers ([performance.md](performance.md))

Do not add clustering to "make Android as fast as iOS". Android may be paying bitmap/custom-marker cost.

## When the problem is clustering itself

| Symptom | Stay here? | Route |
| --- | --- | --- |
| Cluster groups the wrong points, jumps at zoom, viewport edge bugs | No | Clustering library — load the `react-native-better-clustering` skill if that package is in use |
| Cluster bubbles flicker or remount on pan | Usually the Marker identity layer | That clustering skill's rendering notes, plus [performance.md](performance.md) |
| 10k points, still mounting thousands of Markers | Clustering not reducing **visible** count | Clustering config, or ask whether native clustering on a different map renderer is in scope |
| No clustering package in `package.json` | Yes | This map's marker cost; clustering is optional |

## When `react-native-better-maps` is in scope

Only if the user needs to **replace the map renderer**: native clustering inside the map view, descriptor overlays instead of RN children, Nitro HybridView. That is a migration, not a clustering plugin.

`react-native-better-maps` clustering is implemented in Swift/Kotlin and is **not** the same engine as `react-native-better-clustering`. Do not mix their assumptions.

Do **not** recommend better-maps because clustering is slow. Recommend it only when staying on RN Maps markers cannot meet the requirement (and the user can accept that library's limits — no custom React marker views, no `Callout`, New Architecture). See [migration.md](migration.md).

## Questions to ask before routing

1. Is there a clustering library in the app today?
2. Is the complaint **wrong groups** or **low FPS**?
3. How many **visible** Markers (not dataset size) during the slow gesture?
4. Are markers custom React views with `tracksViewChanges` defaulted on?

Wrong groups → clustering skill. Low FPS with many visible Markers → [performance.md](performance.md) first, clustering second. Dataset huge but already clustered to a handful of pins → look at map SDK / React, not the KD-tree.
