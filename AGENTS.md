# AGENTS.md

## Scope

This file explains how deployment works for this repository so future agents do not have to rediscover it.

Keep this document scrubbed:

- Do not add org names, personal names, cluster names, internal hostnames, local filesystem paths, or secret values.
- If infrastructure details are needed, describe the pattern and point to the repo-local workflow or config file instead.

## Working Rules

- Use `bun`, not `npm`.
- Treat Kubernetes and runtime infrastructure as GitOps-managed.
- Do not patch running cluster resources directly when the source of truth lives in a separate infrastructure repo.
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
- Shared contracts live in [`protocol/`](./protocol).
- The production image is built from [`web/Dockerfile`](./web/Dockerfile) using the repo root as the Docker build context.
- Static assets are served by nginx using the templated config in [`web/nginx.conf`](./web/nginx.conf).
- Example app/Convex env values live in [`web/.env.example`](./web/.env.example).
- Example container runtime env values live in [`web/.env.container.example`](./web/.env.container.example).

## Convex Deploy Path

Convex is deployed separately from the web image.

- Workflow: [`.github/workflows/convex-deploy.yml`](./.github/workflows/convex-deploy.yml)
- Trigger:
  - push of a version tag matching `v*`
  - can also be run manually with `workflow_dispatch`
- Runtime:
  - runs on a self-hosted GitHub Actions runner
  - installs dependencies from the repo root workspace
  - deploys from `web/` with `bunx convex deploy`

Important implementation detail:

- The install must run at the repo root so Bun can link the local workspace packages correctly.
- `actions/checkout` still keeps `persist-credentials: false` to avoid mutating the repo's auth state during deploy jobs.
- If Convex deploy starts failing during dependency installation, inspect the root workspace manifests and `bun.lock` before changing package managers or deployment logic.

## Web Deploy Path

The web app is shipped as a container image.

- Workflow: [`.github/workflows/release.yml`](./.github/workflows/release.yml)
- Trigger:
  - push of a version tag matching `v*`
- Runtime:
  - builds the image from [`web/Dockerfile`](./web/Dockerfile) with the repo root as context
  - builds CLI release binaries from [`cli/`](./cli)
  - publishes multi-architecture container images
  - creates a GitHub Release for the tag and attaches the CLI artifacts
  - passes the Git tag into both the web and CLI builds as the canonical release version

Important boundary:

- This repository builds and publishes the web image.
- The root Bun workspace is intentionally limited to `web/` and `protocol/` so the web container build does not depend on CLI workspace metadata.
- The actual Kubernetes rollout is managed outside this repo by GitOps.
- Runtime upstreams and public association identifiers are injected with container env vars instead of being hardcoded in tracked nginx config.
- If the running web deployment needs changes, update the external infrastructure source of truth rather than applying resources manually to the cluster.

## Agent Checklist

Before changing deploy behavior:

- Read the relevant workflow file first.
- Preserve Bun-based install and build steps unless there is a strong reason to change them.
- Preserve the split between Convex deploys and web image releases.
- Avoid adding environment-specific values or identifying infrastructure details to this repository.
