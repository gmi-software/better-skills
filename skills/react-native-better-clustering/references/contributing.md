# Contributing & testing

How an agent should change this library, and what tests exist. Library-repo files: `AGENTS.md`, `CONTRIBUTING.md`. Paths relative to the **library** checkout.

Architecture: [architecture.md](architecture.md). Performance claims: [performance.md](performance.md). API limits: [api.md](api.md), [aggregation.md](aggregation.md).

## Before changing code

1. **Read the architecture.** [architecture.md](architecture.md). Completion: named layer (compat JS, hook, Supercluster, HybridObject, `ClusterEngineCore`).
2. **Identify the layer.** Do not "fix pan" in the KD-tree if the cadence is per-region Marker commit.
3. **Find existing tests.** Sections below. C++ membership → `ClusterEngineCore.test.cpp`. Geometry → `geometry.test.ts`.
4. **Add a regression test** that fails on current main for a bug fix; that locks the new behaviour for a feature.
5. **Smallest change** that restores the invariant. No drive-by refactors (`AGENTS.md`).
6. **Typecheck** `cd package && bun run typecheck`
7. **Tests** `cd package && bun run test:ci` and C++ test if `cpp/` changed
8. **Lint** `cd package && bun run lint-ci`
9. **Native builds** if spec, C++, podspec, gradle, or cmake changed: example `expo prebuild` + iOS/Android as in CI
10. **If the PR is performance-related**, follow the **canonical optimization workflow** in [SKILL.md](../SKILL.md) and record results per [performance.md](performance.md). Do not invent a separate contributing-only speed checklist.

## Nitro / generated code

- Edit `package/src/specs/*.nitro.ts` (and related TS types).
- `cd package && bun run specs` (script runs `tsc` then `nitrogen`).
- Implement `HybridClusterEngine` overrides in `package/cpp`.
- Commit `package/nitrogen/generated/**` as generated output.
- Do not hand-edit spec `.cpp/.hpp` to sneak in APIs.

Exhaustive `ReducerKind` switch in `HybridClusterEngine.cpp` when adding a reducer.

## Public API

Root export stays the clustered `MapView` (ADR 0001). New headless APIs go on `/engine`, `/hooks`, `/utils`, `/geojson` — not a second default.

Additive types preferred. Breaks called out in PR + README + `docs/docs/`.

`react-native-maps` remains the renderer until someone actually implements roadmap Tier 2 (native clustered map view). That is a new architecture with an ADR, not a silent swap inside `compat/MapView.tsx`.

Do not add `clusterProperties` to root `MapView` without an explicit API design — today it is engine/hook-only ([aggregation.md](aggregation.md)).

## Docs to update when behaviour changes

- `README.md` (package copies it on pack)
- `docs/docs/**` (Docusaurus; English)
- This skill, if the cadence, copies, concurrency, or API changed — otherwise the next agent will lie

## Commands (library repo)

```bash
bun install
cd package && bun run typecheck && bun run lint-ci && bun run test:ci
cd package/cpp && c++ -std=c++20 -I. ClusterEngineCore.test.cpp -o cluster_test && ./cluster_test
cd package && bun run specs          # after nitro spec edits
cd example && bunx expo prebuild --clean && bunx expo run:ios   # or run:android
```

Root `bun run android` / `ios` / `start` wrap the example.

## Release

From `package/`: `bun run build`, `bun run test:ci`, `bun run release` (`release-it`: tag, GitHub release, npm). Manual checklist in `CONTRIBUTING.md` (example on both platforms, `cluster={false}`, `renderCluster`).

CI does not measure FPS. A performance release still needs a device note in the PR.

## PR shape (`AGENTS.md`)

Summary, test plan (commands run), risk, notes. Native changes: say which of iOS/Android were actually run.

## Guardrails

- Preserve load-once Supercluster semantics unless the PR is explicitly an incremental index (new design + tests + benches).
- Keep query-before-build throwing.
- Keep invalid coordinates skipped, with pointIndex = packed index.
- Keep `buildAsync` for large loads on the default hook path.
- Do not claim `ClusterEngineCore` is thread-safe without adding real synchronization ([architecture.md](architecture.md)).
- For continuous query during rebuild, document dual-engine swap — do not invent a lock API.
- Performance sentences follow [SKILL.md](../SKILL.md) boundary language.

---

## Testing

What exists, what does not, and what to add when you touch a layer.

### What the repo runs

| Kind | Command | Scope |
| --- | --- | --- |
| Jest | `cd package && bun run test` / `test:ci` | TS: Supercluster (mocked Nitro), geometry, useClusterer, stabilize, packPoints, distance, MapView helpers, throttle, fade, ClusterMarker |
| Export guard | `node scripts/verify-main-entry.mjs` (in `test:ci`) | Root export graph does not leak extra UI |
| C++ | `cd package/cpp && c++ -std=c++20 -I. ClusterEngineCore.test.cpp -o cluster_test && ./cluster_test` | Engine: leaves, pagination, aggregation, v2 buffer, invalid buffer, pointIndex, memorySize |
| Typecheck / lint | `bun run typecheck`, `bun run lint-ci` | package |
| Android build | CI `expo prebuild` + `assembleDebug` | Compiles native lib + example |
| iOS build | CI `xcodebuild` simulator | Compiles pod + example |

Jest **mocks** the Nitro engine in `Supercluster.test.ts`. TS tests do **not** execute `ClusterEngineCore`. A clustering-membership change that only updates C++ needs the C++ binary test (and ideally a new case there).

No Jest/Detox/Maestro coverage of pan, zoom, FPS, or real `react-native-maps`. Example app is manual.

### When you change a layer

| Change | Tests to add or extend |
| --- | --- |
| `geometry.ts` zoom/bbox | `geometry.test.ts` — invalid region, `longitudeDelta >= 40`, bbox formula |
| `packPoints` / buffer layout | `packPoints.test.ts` + C++ `testBufferV2Aggregation` / `testInvalidBufferRejected` |
| `ClusterEngineCore` clustering | **C++ tests first** (membership, leaves, ids). Jest cannot see it |
| `useClusterer` lifecycle | `useClusterer.test.tsx` — destroy/reload on `data` change |
| Stabilize identity | `stabilizeClusters.test.ts` |
| Throttle | `throttleRegionSync.test.ts` — interval 0, leading/trailing, flush |
| Fade presence | `useFadePresence.test.ts` |
| Compat helpers / signature | `helpers.test.ts`, `deriveVisibleMapFeatures.test.ts` if that helper still matters |
| Nitro spec | regenerate + both native CI jobs; no fake JS-only "native" test |
| Performance | [performance.md](performance.md); do not assert FPS in Jest |

### Cases that match this implementation

Use these when adding engine or geometry tests. Skip hypotheticals the code cannot hit (no web, no HybridView props).

| Case | Where |
| --- | --- |
| Zero points | C++ `build` + `getClusters` empty |
| One point | No cluster (`minPoints` default 2) |
| Duplicate coordinates | Merge when neighbour count meets `minPoints` |
| Cluster radius boundary | `within` uses `dx²+dy² <= r²` (inclusive) |
| Invalid / non-finite coords | Dropped; `pointIndex` preserved on survivors (`testPointIndexPreservesOriginalInputIndex`) |
| Extreme lat/lng | Clamped then projected |
| Dateline `west > east` | C++ split path — **missing JS bbox wrap**; add a C++ viewport fixture |
| `longitudeDelta >= 40` | `geometry.test.ts` already |
| Zero map size / NaN region | `getClustersFromRegion` → `[]` |
| Query before build | HybridObject throws — cover in a native or mocked test if you change the message |
| `load` twice | `Supercluster.test.ts` |
| Destroy during `loadAsync` | Supercluster throws; hook swallows |
| Deterministic output | Same points + options + viewport → same ids/counts (integer zoom) |
| Aggregation sum/min/max | C++ `testPropertyAggregationSumMinMax` |
| Unlimited leaves | `limit <= 0` |
| Rapid viewport | throttle unit tests; no RN Maps gesture test in CI |

Very large `n` belongs in `bench.cpp` / a manual example, not Jest.

### Determinism

Build walks the `current` vector in **array / ingest order**; the KD-tree answers `within` / `range` queries and does **not** define the build walk order ([algo.md](algo.md)). Same input should match on iOS and Android (shared header). Do not assert exact cluster ids against Mapbox supercluster JS unless you have pinned a compatibility suite — this is a port, not a byte-identical clone.

### Mocking Nitro in Jest

`jest.setup.js` + Supercluster tests replace the HybridObject. If you test `packPoints` → native parse, use the C++ binary with a handmade buffer (see `testBufferV2Aggregation`) instead of inventing a Jest C++ bridge.
