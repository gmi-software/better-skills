# Contributing

Getting set up, then two bars: what a review must resolve, and what "done" means.

Repository: <https://github.com/gmi-software/react-native-better-maps>.

## Getting set up

A bun workspace monorepo with two workspaces, `package/` and `example/`.

```bash
git clone https://github.com/gmi-software/react-native-better-maps.git
cd react-native-better-maps
bun install --frozen-lockfile

bun run nitrogen                  # codegen + the patch script — run this first
bun run lint
bun run typecheck
bun run typecheck:provider-types  # NOT covered by typecheck
bun run build
bun run --filter react-native-better-maps test
```

That sequence is exactly what CI runs, plus the provider type tests, which CI does not.

Running the example app requires Google Maps API keys for either Google backend:

```bash
bun run example ios
bun run example android
```

Commits are validated by commitlint against `@commitlint/config-conventional`, and husky installs
the hook on `bun install`. A commit message like `fix: clear marker animators on recycle` passes; a
bare `wip` does not.

## Which files a change touches

| Change | Files |
| --- | --- |
| A new prop or method on the map | `src/native/specs/MapView.nitro.ts` → `bun run nitrogen` → `HybridMapView.swift` **and** `HybridMapView.kt` |
| A new marker descriptor field | `specs/overlays.ts`, both fingerprint files, both overlay controllers, and the JS normaliser |
| Provider behaviour | `ios/{Apple,Google}MapProviderAdapter.swift`, `android/.../GoogleMapProviderAdapter.kt` |
| Overlay diffing or clustering | `MapOverlayController`, `MarkerClusterEngine`, `MarkerSpatialIndex`, `MarkerViewportFilter` — on both platforms |
| Public types only | `src/types/*` |
| Expo configuration | `plugin/src/*` and its tests |

## Review

### Architecture

- The change fits the descriptor overlay model, or it introduces a new HybridView with an ADR behind it.
- Provider and `googleMapId` remount semantics still hold.
- Nitrogen output is regenerated; repo-specific fixes went into the patch script.
- Old Architecture and Expo Go stay out of scope.

### Correctness across backends

- Apple iOS, Google iOS, and Google Android each land the change, or the types and docs name the excluded provider.
- New `MarkerDescriptor` fields reach both fingerprint files.
- New host or adapter state is cleared in `prepareForRecycle` on both platforms.
- Android `syncState` replays any new prop.
- Async work checks its generation counter before touching the map.
- Timers, animators, executors, and listeners have an owner that releases them.

### Cadence and cost

- Every new code path on the marker or camera route carries a cadence label, defended against the source.
- Marker datasets survive a render without being rebuilt when their content is unchanged.
- Camera events do not feed marker state.
- Clustering, spatial indexing, and viewport filtering stay native.
- Changed thresholds, throttles, or animation budgets come with a profile and a docs update.

### API

- Type changes are additive, or the diff calls the break out explicitly.
- Provider narrowing holds, with `package/type-tests/provider-props.ts` extended when the provider surface moves.
- Camera hybrid methods keep the `fetchCamera` / `applyCamera` names.
- README, `docs/architecture.md`, and the capability matrix match the new behaviour.

### Language

- Every performance sentence passes the boundary rules in [SKILL.md](../SKILL.md): conversion described as conversion, claims carrying a measurement plan.

## Recurring failure modes

These are the ones this codebase actually invites:

1. Treating `<Marker>` as a native child view, or attaching children to it.
2. Thousands of JSX markers where the bulk prop belongs.
3. A camera callback → `setState` → freshly built marker array, so every pan rebuilds every descriptor. Also the reverse mistake: removing the `isUserRegionChange` / `isUserGesture` latches, which is what keeps the region callbacks to one per gesture instead of one per frame.
4. A descriptor field added without its fingerprint, so the marker renders once and never updates.
5. A one-platform fix to a shared descriptor or event.
6. Reanimated pulled in as a dependency for descriptor entering animations, against ADR 0003.
7. Region equality asserted across platforms while tilted or rotated.
8. "Zero-copy" or "zero-bridge" in a PR description.
9. Lowered thresholds or removed animation caps, unmeasured, to fix a jank report whose real cause is per-render work.
10. Hand-edited files under `nitrogen/generated/`.

## Test coverage that exists

| Kind | Location | Scope |
| --- | --- | --- |
| Jest (**running**) | `package/plugin/src/{android,ios}.test.ts` | Expo config plugin manifest and `Info.plist` mutations |
| Jest (**not running**) | `package/src/overlays/__tests__/` | `lruCache`, `normalizeMarkerDescriptors`, `resolveMarkerImage` |
| Type tests | `package/type-tests/provider-props.ts` | Provider prop narrowing, POI payload discrimination |
| CI | `.github/workflows/ci.yml` | commitlint, nitrogen, lint, typecheck, build, jest |
| Advisory | `.github/workflows/react-doctor.yml` | React Doctor, non-blocking |

The three overlay test files are excluded by configuration, not by choice as far as the source
shows: `package/jest.config.js` sets `roots: ['<rootDir>/plugin/src']`, so `testMatch` never reaches
`src/`. `bun run test` therefore runs the two plugin suites only. Widening `roots` to
`['<rootDir>/src', '<rootDir>/plugin/src']` would pick them up, but the two suites use different
presets (`ts-jest` for the plugin, and the overlay tests import from `src`), so confirm they pass
before assuming it is a one-line fix.

Nothing automated exercises native rendering, gestures, events, clustering, or frame timing. Manual verification on the example app is the only evidence for those, and it needs Google Maps API keys for the Google backends.

## Definition of done

Claim done when every line below is true, not when the diff compiles.

**Implementation**
- Behaviour matches the architecture, or the ADR that changes it is written.
- Every affected backend implements the change.
- Fingerprints, `prepareForRecycle`, and Android `syncState` cover new state.

**Contract**
- Public types are exported deliberately and provider narrowing is intact.
- Spec changes are regenerated and implemented on both hosts.
- Compatibility is preserved, or the break is stated in the PR.

**Verification**
- `bun run lint`, `bun run typecheck`, `bun run typecheck:provider-types`, `bun run build`, and the package Jest suite pass.
- Pure logic changes carry a Jest test; provider surface changes carry a type test.
- The example app was run on each affected provider, and the PR says which ones — including the ones left untested.

**Cadence and evidence**
- Each new path has a cadence label.
- Performance statements carry measurements, or the statements are gone.

**Documentation**
- README, architecture doc, capability matrix, and ADRs reflect the change.
- No sentence in the diff makes the repo's existing "zero-copy structs" wording worse.

---

# Testing

What can actually be tested, what cannot, and where the current suite stops. Verified against
v1.1.0 (`b9a1783`).

## What exists

| Layer | Status |
| --- | --- |
| JS unit tests (Expo config plugin) | Present, and run by `bun run test` |
| JS unit tests (overlay helpers) | Present, but **not run** — see below |
| Type tests | Present, run by `typecheck:provider-types` |
| iOS native tests | None |
| Android native tests | None |
| Integration / E2E | None |
| Benchmarks | None |

There is no benchmark harness and no performance gate. Any performance claim about a change has to
be measured by hand — [performance.md](performance.md).

## Running the library's tests

From `package/`:

```bash
bun run test                      # jest
bun run test:ci                   # jest --runInBand --ci --watchman=false
bun run typecheck                 # tsc --noEmit, plus the plugin tsconfig
bun run typecheck:provider-types  # tsc against type-tests/
```

From the repository root:

```bash
bun run lint
bun run typecheck
bun run build
```

### `bun run test` does not run every test file

`package/jest.config.js` sets:

```js
roots: ['<rootDir>/plugin/src'],
testMatch: ['**/*.test.ts'],
```

`roots` is limited to the Expo config plugin. The three test files under
`src/overlays/__tests__/` — `lruCache.test.ts`, `normalizeMarkerDescriptors.test.ts`, and
`resolveMarkerImage.test.ts` — exist, are well-formed, and are **silently skipped**. They also use
the `__tests__` directory convention rather than `*.test.ts` co-location, so widening `roots` alone
is not quite enough.

Run them explicitly to see them pass:

```bash
cd package
bunx jest --roots src/overlays --testMatch '**/__tests__/**/*.test.ts'
```

If you are contributing, fixing the config is a small, high-value change — see the contributing
sections above.

## What is genuinely unit-testable

The JS layer that runs before anything crosses into native:

- **`resolveMapProvider`** — the platform/provider guard. Pure, `Platform.OS`-dependent, easy to
  test by mocking `Platform`.
- **`normalizeMarkerDescriptors`** — the JSX-children-to-descriptor-array collection.
- **`resolveMarkerImage`** and its 64-entry LRU — asset resolution and caching.
- **`regionFromCoordinate`, `distanceBetween`** — pure maths, exported from the package root.
- **The Expo config plugin** — `withBetterMaps` and its Android/iOS halves operate on plain config
  objects and are the best-covered part of the codebase today.

Everything below the descriptor array is Swift and Kotlin, reachable only from a running app.

## What a JS mock cannot tell you

This matters, because it determines what a green test suite actually proves.

`MapView` is a Nitro `HybridView`. In a Jest environment there is no native module, so any test
touching it needs a mock — and **the mock is where all the interesting behaviour lives**. None of
the following can be observed from JavaScript:

- Clustering output. The algorithm is Swift and Kotlin; JS never sees clusters, only the
  `onClusterPress` callback.
- Viewport filtering and the level-of-detail caps.
- The diff, `renderVersion` hashing, and which markers are retained versus recreated.
- Threading, the refresh cadence, and staleness handling.
- Whether a prop is a no-op on your platform (`showsScale`; `followsUserLocation` on Android).
- Marker image loading, caching, and Android's URI allowlist.
- Anything about frame rate.

A test asserting "5,000 markers render" against a mocked `MapView` proves that your array was built
and passed. It proves nothing about the map. Write those tests for your own data pipeline, and
validate map behaviour on a device.

## Testing an app that uses the library

Mock the module in `jest.setup.js`:

```js
jest.mock('react-native-better-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => ({
        getCamera: jest.fn().mockResolvedValue({
          center: { latitude: 0, longitude: 0 },
          zoom: 10,
        }),
        setCamera: jest.fn().mockResolvedValue(undefined),
        animateCamera: jest.fn().mockResolvedValue(undefined),
        getVisibleRegion: jest.fn().mockResolvedValue({
          nearLeft: { latitude: 0, longitude: 0 },
          nearRight: { latitude: 0, longitude: 0 },
          farLeft: { latitude: 0, longitude: 0 },
          farRight: { latitude: 0, longitude: 0 },
        }),
        fitToCoordinates: jest.fn().mockResolvedValue(undefined),
      }));
      return React.createElement(View, { testID: 'map-view' }, props.children);
    }),
    Marker: () => null,
    Polyline: () => null,
    Polygon: () => null,
    Circle: () => null,
    regionFromCoordinate: jest.requireActual('react-native-better-maps')
      .regionFromCoordinate,
    distanceBetween: jest.requireActual('react-native-better-maps')
      .distanceBetween,
  };
});
```

Note that `Marker` and friends return `null` in the real implementation too, so mocking them as
`() => null` is faithful rather than a simplification.

Those five ref methods are the entire imperative surface, so a mock covering them is complete.

**What is worth testing this way:** that your component builds the descriptor array you expect, that
selecting a marker calls the right handler, that camera helpers are invoked with the right
arguments, and that your `useMemo` dependencies are stable. That last one is the highest-value test
you can write, because unstable dependencies are the main cause of map jank —
[rendering.md](rendering.md).

## Simulator and emulator limits

Both are fine for correctness and unreliable for performance.

**iOS Simulator.** MapKit renders, Google Maps renders with a valid key. User location needs
Features → Location set to something other than "None". No realistic GPU or thermal behaviour, so
frame rates are not evidence.

**Android emulator.** Requires a Google Play system image or the Maps SDK will not initialise at
all. Typically much slower than real hardware, in ways that do not scale predictably. Remote marker
images from the host at `10.0.2.2` are rejected by the URI allowlist —
[android.md](android.md#remote-marker-images-are-restricted).

## Device validation checklist

Before shipping a screen built on this library, check on a physical device of each platform:

- The map renders with your production API key, in a release build.
- The camera lands where you expect on first render and does not jump back.
- Pan and pinch are smooth at your real marker count, not a sample of ten.
- Clustering behaves at the zoom levels your users actually use, including the extremes.
- Cluster taps do what you want — remember iOS and Android compute different zoom extents.
- Marker images load, including any remote ones, on Android specifically.
- User location works after a real permission prompt, and degrades sanely if denied.
- Backgrounding and returning restores the map rather than leaving it black.
- Rotation, if you support it, does not lose state — Android calls `onCreate(null)` with no saved
  instance state.

## Adding tests as a contributor

The most useful contributions, roughly in order:

1. **Fix `jest.config.js`** so the existing overlay tests run.
2. **Test `resolveMapProvider`** across platforms and providers, including the throw paths.
3. **Native unit tests for the pure engines.** `MarkerClusterEngine`, `MarkerViewportFilter`, and
   `MarkerSpatialIndex` are pure functions over descriptor data with no SDK dependencies, which
   makes them straightforwardly testable in XCTest and JUnit. There is no test target for either
   platform yet, so this means creating one.
4. **Antimeridian and precision cases** for the clustering engines, which are exactly the
   conditions that are painful to verify by hand on a device.

Discuss 3 in an issue first — adding a native test target is a structural change to the build.
