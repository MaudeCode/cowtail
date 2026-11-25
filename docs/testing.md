# Writing and fixing tests

Every added or changed test passes the `test-audit` skill's authoring gate and its defect rules. This page lists the Cowtail helpers that satisfy each rule, the two CI checks that hold the tests to them, and the loop for fixing a test.

## Helpers by rule

| Rule | Use |
|---|---|
| clock | Convex: `vi.useFakeTimers({ now })` around `newBackend()`, and `advance(t, ms)` (`web/test/convexHarness.ts`) to move the fake clock and run every interval cron and scheduled function that comes due. A handler test that reads `Date.now` sets it with `vi.setSystemTime`. Web UI: fixture times sit relative to `NOW` (`web/src/test/fixtures.ts`), a fixed local noon, and the suite's setup holds `Date` there for every test. iOS: a clock the subject takes as an argument, such as `ItemFormat.age(of:now:)` (`ios/CowtailKit/Sources/CowtailKit/UI/Items/ItemPresentation.swift`). |
| unheld | The same fake timers: Convex's scheduler and the code under test run only when `advance` moves the clock. Never assign `Date.now` while real timers run. |
| snapshot | Web: `findBy*` queries and Vitest's `waitFor` wait for the rendered record. iOS: an `XCTestExpectation` fulfilled by the event itself (a `@Published` value through its publisher, a fake's call), awaited with `fulfillment(of:timeout:)`, as in `RoundupInternalsTests` (`ios/CowtailKit/Tests/CowtailKitTests/Shared/`); a fake API that holds a request until the test releases it, as in `CowtailStoreTests` (`ios/CowtailKit/Tests/CowtailKitTests/App/`). UI tests wait with `waitForExistence(timeout:)` or `expectation(for:evaluatedWith:)`. |
| fake | Web: `stubApi(routes)` (`web/src/test/api.ts`) answers 404 for any path it does not list and records every call. Convex: `vi.stubGlobal("fetch", ...)` with a fake that throws on any URL it does not own, as in `web/test/convexHarness.test.ts`. iOS: a fake `CowtailAPIClient` or `RoundupDataClient` (`ios/CowtailKit/Sources/CowtailKit/Networking/`) injected into the store or view. |
| leak | A backend per test from `newBackend()`, and a query client per render from `renderWithProviders` (`web/src/test/render.tsx`). The shared `afterEach` in `web/src/test/setup.ts` unmounts, restores real timers, unstubs globals and restores mocks; `stubEnv` (`web/test/convexHarness.ts`) is undone with `vi.unstubAllEnvs()`. Temporary trees come from `mkdtempSync` and are removed in `afterEach`. |
| ready | iOS UI tests launch through `AppLaunching.configuredApp(scenario:)` (`ios/CowtailUITests/Support/AppLaunching.swift`), which seeds a `UITestScenario` (`ios/CowtailKit/Sources/CowtailKit/App/UITestScenario.swift`) so the app starts on known data with no server. Requests are authorized by an injected `AppSessionAuthorizationMiddleware(sessionToken:)` (`ios/CowtailKit/Sources/CowtailKit/Networking/CowtailAPI.swift`), never a live sign-in. |
| oversized | One behaviour per test over a shared fixture. A test that walks several scenarios splits into one test per scenario. |
| heavy | Prove a contract at the cheapest layer that sees it: a Convex function in memory before an HTTP route, a component before a page, a unit test before a UI test. |

## Where iOS tests live

- `ios/CowtailKit/Tests/CowtailKitTests`: the app's logic, which the `CowtailKit` package builds and tests on macOS with no simulator. Run `pnpm run test:ios:unit`. The app compiles the package's sources into its own module (`ios/project.yml`), so they need no public API. Put new logic and its tests here: CI runs them on every iOS change, in seconds.
- `ios/CowtailTests`: only tests that need the installed app, such as the fonts its bundle registers. Run `pnpm run test:ios:hosted`. CI runs them in the `ios-sim` suite, on a booted simulator, which costs the hosted Mac about 7 minutes. `ios-sim`'s rule in `.github/ci-suites.json` lists every path these tests cover, and `script/ci/suites.test.ts` fails when an app-hosted test or a listed path does not route there. Every release runs `ios-sim`.
- `ios/CowtailUITests`: UI tests, run locally with `pnpm run test:ios:ui`.

## Checks in CI

**Test rules.** The `global` suite runs `pnpm exec maudecode-ci rules --config script/ci/test-rules.json`. The config extends the shared `@maudecode/ci/rules/test-rules.base.json` and scans every test and test-support file under `web/convex`, `web/src`, `web/test`, `web/*.test.ts`, `cli/tests`, `protocol/src`, `script`, `ios/CowtailKit/Tests`, `ios/CowtailTests` and `ios/CowtailUITests`. It fails a file that adds a fixed sleep (`clock-sleep`), measures elapsed time (`clock-elapsed`), fakes `Date.now` beside real timers (`unheld-clock`), takes a module-level fixture time from the real clock (`clock-fixture-now`, a local rule in that config), or retries a test (`retry`, `retry-config`). `script/ci/test-rules.test.ts` proves a fixed sleep and a real-clock fixture time fail the check.

`script/ci/test-rules-baseline.json` counts the instances the tree already has, and it is empty. The check fails a file with more instances than its count, and a count above the tree, so a fixed instance lowers the baseline in the same change: run the command with `--update`, which never raises a count. A legitimate new instance gets a hand-written `exceptions` entry in that file with its rule, file, count and a `reason` that names a COW ticket or says why it stays; the pull request review covers it.

**Run-time budget.** Each test step writes a report, and `pnpm exec maudecode-ci test-durations --config script/ci/test-durations.json <report>` fails any test over 30 seconds:

- web, CLI, protocol and scripts: Vitest's JUnit reporter, switched on in CI with `--reporter=default --reporter=junit --outputFile.junit=<path>`
- iOS package tests: the `swift test` log of `ios/CowtailKit`
- iOS app-hosted tests: `xcrun xcresulttool get test-results tests` on the result bundle `ios/scripts/test.sh` keeps at `ios/build/TestResults.xcresult`. CI runs no UI test; `pnpm run test:ios:ui` runs them locally

A test over budget is split or proved at a cheaper layer. `overBudget` in `script/ci/test-durations.json` lists a test only with the COW ticket that brings it under. UI tests stay out of hosted CI, since launching the app alone takes 15 to 27 s there; COW-44 moves their checks into hosted in-process tests.

## Fixing a defective test

A test that failed intermittently, ran over budget or covered too much follows the test-audit defect loop:

1. Reproduce the failure: run the test alone, then repeated or under parallel load.
2. Name the defect rule it broke in the pull request. If the test was right and caught a product race, fix the product and name no rule.
3. Write the rule, on every fix, including one whose cause an existing rule already names: add the imperative clause that would have stopped this test being written to the test-audit skill's defect rules, in the same change or a skills commit the pull request links. If a diff can show the cause, add a pattern to `script/ci/test-rules.json` too.

Never retry, skip, loosen an assertion or raise a timeout to get green.
