# AGENTS.md

## Scope

This file explains how deployment works for this repository so future agents do not have to rediscover it.

Keep this document scrubbed:

- Do not add org names, personal names, cluster names, internal hostnames, local filesystem paths, or secret values.
- If infrastructure details are needed, describe the pattern and point to the repo-local workflow or config file instead.

## Working Rules

- Use `bun`, not `npm`.
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
- The web app consumes the shared package through the Bun workspace as `@maudecode/cowtail-protocol`. The CLI consumes the local package from `../protocol`. Do not re-declare the wire format locally as a shortcut.

## Local Build

- Install web and protocol dependencies from the repo root with `bun install --frozen-lockfile`.
- Install CLI dependencies with `cd cli && bun install --frozen-lockfile`.
- Build the CLI with `cd cli && bun run build`.
- Check the CLI with `cd cli && bun run check`.
- Build the web app with `cd web && bun run build`.
- The web app source lives in [`web/`](./web).
- The CLI source lives in [`cli/`](./cli).
- The native iOS app lives in [`ios/`](./ios) and remains outside the Bun workspace.
- Shared contracts live in [`protocol/`](./protocol).
- The production image is built from [`web/Dockerfile`](./web/Dockerfile) using the repo root as the Docker build context.
- Static assets are served by nginx using the templated config in [`web/nginx.conf`](./web/nginx.conf).
- Example app/Convex env values live in [`web/.env.example`](./web/.env.example).
- Example container runtime env values live in [`web/.env.container.example`](./web/.env.container.example).

## Chat Verification

Use these checks when changing shared chat, push, protocol, or iOS surfaces:

- Check shared protocol contracts with `bun run check:protocol`.
- Test shared protocol contracts with `bun run test:protocol`.
- Generate iOS OpenAPI sources with `cd ios && ./generate.sh` after protocol or HTTP contract changes.
- Run iOS unit tests with `bun run test:ios:unit`.
- Run iOS UI tests with `bun run test:ios:ui`.

## UI Mockups

[`docs/mockups/app-rewrite.html`](./docs/mockups/app-rewrite.html) is the visual spec for the item rewrite: the iOS tabs, the web pages and the notifications. Open it in a browser.

- Build or change one of those screens from its figure (each has an `id`) and the page's Rules section. The figure decides layout, grouping, order and controls. The ticket decides behavior, data and API.
- When a screen must differ from its figure, change the figure in the same pull request.
- Review a UI pull request against its figures as well as its ticket.

## Phone Validation

The owner declined the physical-phone validation gate, in advance, for every ticket of the item rewrite epic (decision of 2026-11-23). For those tickets, record the device result as `declined`, offer no phone build, and merge on the simulator unit and UI tests in CI. The owner tries the finished app on a phone once, after the epic. A ticket outside that epic follows the usual gate.

## CI Runners

- Workflows run on GitHub-hosted runners: `ubuntu-latest` or `ubuntu-24.04`, `ubuntu-24.04-arm` for the arm64 image, and the hosted `xcode-27` image for iOS.
- The iOS jobs set up Xcode and install XcodeGen, SwiftLint and SwiftFormat through [`.github/actions/setup-ios`](./.github/actions/setup-ios/action.yml); the pinned Xcode version lives there.
- iOS Verify tests on the newest runtime's `iPhone 17`, which the hosted image provides.
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
  - deploys from `web/` with `bunx convex deploy`

Important implementation detail:

- The install must run at the repo root so Bun can link the local workspace packages correctly.
- `actions/checkout` still keeps `persist-credentials: false` to avoid mutating the repo's auth state during deploy jobs.
- If Convex deploy starts failing during dependency installation, inspect the root workspace manifests and `bun.lock` before changing package managers or deployment logic.

## Release Path

Releases are tag-last: the release workflow is dispatched with a version, publishes everything, and creates the version tag as its last step. The shared contract is `RELEASES.md` in the organization's public `.github` repository. Never push a `v*` tag by hand; a tag means the release shipped.

- Workflow: [`.github/workflows/release.yml`](./.github/workflows/release.yml), run titled `Release <tag>`
- Trigger:
  - `workflow_dispatch` on `main` with a required `tag` (`vX.Y.Z`, optional prerelease suffix) and an optional `sha`: any commit on `main` after the last release whose workflow files match `main`'s (empty releases the head of `main` when the run starts); the run stays on that commit
  - from a terminal: `gh workflow run release.yml --ref main -f tag=vX.Y.Z -f sha="$(git rev-parse origin/main)"`
- Runtime:
  - `preflight` runs the shared `release-preflight` action first, and every other job needs it; it refuses a run off `main`, a `sha` that is not on `main` after the last release or whose workflow files differ from `main`'s, and a tag that exists or does not come after the latest version tag
  - preflight's `checks` names each verify workflow's job; one that already passed in that workflow's push run on the commit is reused, and the release runs the others itself. Path filters mean a commit may have no push run for a workflow, so the release runs it. The release never waits on another run, and the build and publish jobs treat a skipped verify as a pass and a failed one as a stop
  - `freeze`, right after preflight, fails the `release-freeze` commit status on every open pull request that changes a workflow file. `validate` needs it and every publishing job needs `validate`, so a release whose freeze failed publishes nothing. The last job, `thaw`, runs with `if: always()` and passes the status again however the release ended. GitHub refuses the workflow's token when it tags a commit whose workflow files differ from `main`'s, so a workflow change merged mid-release would leave the release untagged
  - [`.github/workflows/release-freeze.yml`](./.github/workflows/release-freeze.yml) runs on `pull_request_target` for every pull request, whatever it changes, because the verify workflows run by path; it gives each pull request the `release-freeze` status, forks and Dependabot included. It checks out nothing and never runs pull request code. `release-freeze` belongs in `main`'s required status checks
  - every job reads the commit from preflight's `sha` output and the version from its `tag` or `version` output, never from `github.ref_name` or the inputs; the reusable workflows take them as `ref` and `version`
  - builds the image from [`web/Dockerfile`](./web/Dockerfile) with the repo root as context, labelled with the commit as `org.opencontainers.image.revision`
  - builds CLI release binaries and the CLI npm package from [`cli/`](./cli)
  - builds the iOS app with the commit time as its build number, so every build of a commit has the same number
  - publishes the iOS app to TestFlight, the npm package, and the multi-architecture container images
  - deploys Convex from [`web/`](./web) after those publish
  - last, `publish-github-release` creates the tag with the shared `release-tag` action and then the GitHub Release with the CLI artifacts
- Running again:
  - re-run the failed jobs, or dispatch the same version again from the same commit
  - [`script/release/published.mjs`](./script/release/published.mjs) checks TestFlight, npm and the registry before each publish: an artifact already published from this commit is skipped, one from another commit fails the job
  - after something published from a commit that has since changed, release the next version

Important boundary:

- This repository builds and publishes the web image, CLI archives, and CLI npm package.
- This repository deploys Convex functions as part of a successful release.
- The root Bun workspace is intentionally limited to `web/` and `protocol/` so the web container build does not depend on CLI workspace metadata.
- The actual Kubernetes rollout is managed outside this repo by GitOps.
- Runtime upstreams and public association identifiers are injected with container env vars instead of being hardcoded in tracked nginx config.
- If the running web deployment needs changes, update the external infrastructure source of truth rather than applying resources manually to the cluster.

## Agent Checklist

Before changing deploy behavior:

- Read the relevant workflow file first.
- Preserve Bun-based install and build steps unless there is a strong reason to change them.
- Keep release-time Convex deploys sequenced after artifact publication succeeds, and the tag and GitHub Release after everything else.
- Avoid adding environment-specific values or identifying infrastructure details to this repository.
