# AGENTS.md

## Scope

This file explains how work is done in this repository and how deployment works, so future agents do not have to rediscover either.

Keep this document scrubbed:

- Do not add org names, personal names, cluster names, internal hostnames, local filesystem paths, or secret values.
- If infrastructure details are needed, describe the pattern and point to the repo-local workflow or config file instead.

## Working Agreement

**Tracker.** Kanvil project COW is the tracker. Work only on the selected ticket and its required dependencies. Move the ticket to In Progress before editing, to In Review after its commits are verified, and to Done only after its commit is verified on `main`.

**Scopes.** Each ticket carries one or more scope labels, in its native `scopes` and in its labels:

- `app`: the iOS app in `ios/`
- `web`: everything in `web/`, the React app and the Convex backend alike
- `cli`: `cli/`
- `contracts`: `protocol/`, alongside the scopes of the consumers a change touches
- `plugin`: `hermes-plugin/`
- `tooling`: CI, release, scripts and agent documentation

**Branches and subjects.** Branches are `<type>/COW-<number>-<slug>`. Commit and pull request subjects are `<type>(<area>): <summary> (COW-<number>)`, as the history already has them.

**Server-owned state.** Clients are display-only. The Convex backend computes every decision, classification, derivation, ordering, filtering and computed value a client shows, and ships each as an explicit field defined in `protocol/`. Client logic is limited to wording, formatting of numbers, dates and units, layout, theme, animation, accessibility, device-local UI state, optimistic display of the user's own writes, offline display of cached fields, and platform integration. Anything else moves to the server and the protocol in the same change.

**Optimistic writes.** A user-initiated write shows its result at once. If the server refuses it, the client rolls back to the last confirmed value and shows the error. An unknown outcome reconciles with the server before the client keeps or rolls back the change, and a non-idempotent write is never replayed blind. Only writes whose result the server must produce keep a busy state, and only on the control that started them.

**Tests.** Read [`docs/testing.md`](./docs/testing.md) before writing, changing or fixing a test. Tests own synthetic, disposable state and never depend on a live account, cluster or device. Every added or changed test passes the `test-audit` skill's authoring gate. Fixing a bad test writes its rule into that skill in the same change.

**Dependencies.** Add no third-party dependency without the owner's approval.

**Evidence.** Screenshots and other validation evidence go in the pull request, never in git. The mockup page under `docs/mockups/` is the one committed visual spec.

**Human gates.** Releases, deployments, TestFlight uploads, repository administration and changes to live services wait for the owner.

## Working Rules

- Use `pnpm`, not `npm`. pnpm is the version named in the root `package.json`'s `packageManager`; scripts run on Node and tests on Vitest.
- Where an older ticket says `bun run <script>`, `bun test` or `bunx`, run the same script with `pnpm run`, `pnpm test` or `pnpm exec`.
- Node is the version named in `.node-version`, the latest LTS line. A version manager that reads that file selects it in every checkout and worktree, with no setup.
- Treat Kubernetes and runtime infrastructure as GitOps-managed.
- Do not patch running cluster resources directly when the source of truth lives in a separate infrastructure repo.
- A checkout's `web/.env` can hold the live Convex deployment's address and admin key, and worktrees get a copy of it. Never run `convex dev`, `convex deploy`, `convex run` or `convex import` from a checkout. Test Convex code in memory, and let the release workflow deploy it.
- Keep deployment documentation generic and non-identifying.

## Protocol Boundary

Use `protocol` for any versioned contract that crosses repo or process boundaries.

- Put request and response schemas there for HTTP actions, CLI payloads, push payloads, and shared read endpoints such as cluster health.
- Put shared enums and literals there when multiple repos need the same allowed values.
- Keep runtime implementation details out of `protocol`: no Convex queries or mutations, no env loading, no HTTP clients, no UI state, no Swift-only mapping code.
- If a payload shape is only a local view model for this web app, keep it in this repo instead of promoting it to the protocol package.
- The web app and the CLI consume the shared package through the pnpm workspace as `@maudecode/cowtail-protocol`. Do not re-declare the wire format locally as a shortcut.

## Local Build

- Install every package's dependencies from the repo root with `pnpm install --frozen-lockfile`. The workspace holds `web/`, `protocol/` and `cli/`.
- Build the CLI into `cli/dist/cowtail.js` with `pnpm run build:cli`.
- Check the CLI with `pnpm run check:cli`.
- Build the web app with `pnpm run build:web`.
- Run the tests with `pnpm run test:web`, `pnpm run test:protocol`, `pnpm run test:cli` and `pnpm run test:script`.
- Lint and format-check with `pnpm run lint:ts` and `pnpm run fmt:ts:check`.
- The web app source lives in [`web/`](./web).
- The CLI source lives in [`cli/`](./cli).
- The native iOS app lives in [`ios/`](./ios) and remains outside the pnpm workspace.
- Shared contracts live in [`protocol/`](./protocol).
- The Hermes plugin lives in [`hermes-plugin/`](./hermes-plugin), outside the pnpm workspace and stdlib-only Python. Test it with `python -m unittest discover -s hermes-plugin/tests -v` on Python 3.11 or later. The production install copies `hermes-plugin/` into the Hermes plugins directory.
- The production image is built from [`web/Dockerfile`](./web/Dockerfile) using the repo root as the Docker build context.
- Static assets are served by nginx using the templated config in [`web/nginx.conf`](./web/nginx.conf).
- Example app/Convex env values live in [`web/.env.example`](./web/.env.example).
- Example container runtime env values live in [`web/.env.container.example`](./web/.env.container.example).

## Chat Verification

Use these checks when changing shared chat, push, protocol, or iOS surfaces:

- Check shared protocol contracts with `pnpm run check:protocol`.
- Test shared protocol contracts with `pnpm run test:protocol`.
- Generate iOS OpenAPI sources with `cd ios && ./generate.sh` after protocol or HTTP contract changes.
- Run iOS unit tests with `pnpm run test:ios:unit`.
- Run iOS UI tests with `pnpm run test:ios:ui`.

## UI Mockups

[`docs/mockups/app-rewrite.html`](./docs/mockups/app-rewrite.html) is the visual spec for the item rewrite: the iOS tabs, the web pages and the notifications. Open it in a browser.

- Build or change one of those screens from its figure (each has an `id`) and the page's Rules section. The figure decides layout, grouping, order and controls. The ticket decides behavior, data and API.
- When a screen must differ from its figure, change the figure in the same pull request.
- Review a UI pull request against its figures as well as its ticket.

## Phone Validation

The owner declined the physical-phone validation gate, in advance, for every ticket of the item rewrite epic (decision of 2026-11-23). For those tickets, record the device result as `declined`, offer no phone build, and merge on the simulator unit and UI tests in CI. The owner tries the finished app on a phone once, after the epic. A ticket outside that epic follows the usual gate.

## CI

CI follows `CI.md` in the organization's public `.github` repository: a change runs only the suites it reaches.

- [`.github/ci-suites.json`](./.github/ci-suites.json) names the suites, `global` (lint, format, protocol, script tests), `web`, `cli`, `ios`, `docker` and `plugin` (the Hermes plugin's tests, in `hermes-plugin-verify.yml`), and the ordered rules that route a changed path to them. The first rule that matches a path decides it, so narrow rules come before broad ones. A path no rule matches runs every suite; [`script/ci/suites.test.ts`](./script/ci/suites.test.ts) fails when a tracked path is matched by no rule.
- [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs on every pull request, every push to `main` and by hand. Its `changes` job selects the suites with the shared `ci-suites` action, one job per suite calls `.github/workflows/<suite>-verify.yml`, and `CI Gate` passes only when every selected suite passed. A suite's checks are named `<suite> / <job>`.
- The verify workflows run only when `ci.yml` or the release calls them, or by hand; they have no `push` or `pull_request` trigger of their own.
- To add a suite: add it and its rules to `ci-suites.json`, add its `<suite>-verify.yml` with `workflow_call`, add a job with the suite's name to `ci.yml` and to `CI Gate`'s `needs`, and, when the release should reuse it, add `ci.yml: <suite> / *` to the release preflight's `checks`.
- The shared actions and the `@maudecode/ci` dev dependency pin the same commit of the `.github` repository; bump them together.
- `CI Gate` and `release-freeze` are `main`'s required status checks.
- Every job runs on a GitHub-hosted runner, `ubuntu-latest` or `ubuntu-24.04`, `ubuntu-24.04-arm` for the arm64 image, and the hosted `xcode-27` image for iOS. A runner is a new machine for each job: no job prepares or cleans up state for a later one, and every job sets `timeout-minutes`.
- The iOS job sets up Xcode and installs XcodeGen, SwiftLint and SwiftFormat through [`.github/actions/setup-ios`](./.github/actions/setup-ios/action.yml), where the pinned Xcode version lives. It runs `ios/scripts/test.sh CowtailTests CowtailUITests` once, on the `iPhone 17` simulator the hosted image provides, and caches SwiftPM's packages.
- Only the Convex deploy stays on a self-hosted runner, because its deployment URL is reachable only from inside the cluster.

## Convex Deploy Path

Convex deploys are part of the release workflow.

- Workflow: [`.github/workflows/convex-deploy.yml`](./.github/workflows/convex-deploy.yml)
- Trigger:
  - called by [`.github/workflows/release.yml`](./.github/workflows/release.yml) after release artifact publication succeeds
  - can be run manually with `workflow_dispatch`
- Runtime:
  - runs on a self-hosted GitHub Actions runner
  - installs dependencies from the repo root workspace
  - deploys from `web/` with `pnpm exec convex deploy`

Important implementation detail:

- The install must run at the repo root so pnpm can link the local workspace packages correctly.
- `actions/checkout` still keeps `persist-credentials: false` to avoid mutating the repo's auth state during deploy jobs.
- If Convex deploy starts failing during dependency installation, inspect the root workspace manifests and `pnpm-lock.yaml` before changing package managers or deployment logic.

## Release Path

Releases are tag-last: the release workflow is dispatched with a version, publishes everything, and creates the version tag as its last step. The shared contract is `RELEASES.md` in the organization's public `.github` repository. Never push a `v*` tag by hand; a tag means the release shipped.

- Workflow: [`.github/workflows/release.yml`](./.github/workflows/release.yml), run titled `Release <tag>`
- Trigger:
  - `workflow_dispatch` on `main` with a required `tag` (`vX.Y.Z`, optional prerelease suffix) and an optional `sha`: any commit on `main` after the last release whose workflow files match `main`'s (empty releases the head of `main` when the run starts); the run stays on that commit
  - from a terminal: `gh workflow run release.yml --ref main -f tag=vX.Y.Z -f sha="$(git rev-parse origin/main)"`
- Runtime:
  - `preflight` runs the shared `release-preflight` action first, and every other job needs it; it refuses a run off `main`, a `sha` that is not on `main` after the last release or whose workflow files differ from `main`'s, and a tag that exists or does not come after the latest version tag
  - preflight's `checks` names the `global`, `web`, `ios` and `cli` suites as `ci.yml: <suite> / *`; a suite that already passed in `ci.yml`'s push run on the commit is reused, and the release runs the others itself through their verify workflows. A push run skips the suites its change does not reach, so a commit may have no result for a suite, and the release runs it. The release never waits on another run, and the build and publish jobs treat a skipped verify as a pass and a failed one as a stop
  - `freeze`, right after preflight, fails the `release-freeze` commit status on every open pull request that changes a workflow file. `validate` needs it and every publishing job needs `validate`, so a release whose freeze failed publishes nothing. The last job, `thaw`, runs with `if: always()` and passes the status again however the release ended. GitHub refuses the workflow's token when it tags a commit whose workflow files differ from `main`'s, so a workflow change merged mid-release would leave the release untagged
  - [`.github/workflows/release-freeze.yml`](./.github/workflows/release-freeze.yml) runs on `pull_request_target` for every pull request, whatever it changes; it gives each pull request the `release-freeze` status, forks and Dependabot included. It checks out nothing and never runs pull request code. `release-freeze` belongs in `main`'s required status checks
  - every job reads the commit from preflight's `sha` output and the version from its `tag` or `version` output, never from `github.ref_name` or the inputs; the reusable workflows take them as `ref` and `version`
  - builds the image from [`web/Dockerfile`](./web/Dockerfile) with the repo root as context, labelled with the commit as `org.opencontainers.image.revision`
  - builds the CLI npm package from [`cli/`](./cli)
  - builds the iOS app with the commit time as its build number, so every build of a commit has the same number
  - publishes the iOS app to TestFlight, the npm package, and the multi-architecture container images
  - deploys Convex from [`web/`](./web) after those publish
  - last, `publish-github-release` creates the tag with the shared `release-tag` action and then the GitHub Release with the CLI npm package attached
- Running again:
  - re-run the failed jobs, or dispatch the same version again from the same commit
  - [`script/release/published.mjs`](./script/release/published.mjs) checks TestFlight, npm and the registry before each publish: an artifact already published from this commit is skipped, one from another commit fails the job
  - after something published from a commit that has since changed, release the next version

Important boundary:

- This repository builds and publishes the web image and the CLI npm package.
- This repository deploys Convex functions as part of a successful release.
- The web container build installs only `web/` and its workspace dependencies with `pnpm install --frozen-lockfile --filter ./web...`.
- The actual Kubernetes rollout is managed outside this repo by GitOps.
- Runtime upstreams and public association identifiers are injected with container env vars instead of being hardcoded in tracked nginx config.
- If the running web deployment needs changes, update the external infrastructure source of truth rather than applying resources manually to the cluster.

## Agent Checklist

Before changing deploy behavior:

- Read the relevant workflow file first.
- Preserve pnpm-based install and build steps unless there is a strong reason to change them.
- Keep release-time Convex deploys sequenced after artifact publication succeeds, and the tag and GitHub Release after everything else.
- Avoid adding environment-specific values or identifying infrastructure details to this repository.
