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

Use `cowtail-protocol` for any versioned contract that crosses repo or process boundaries.

- Put request and response schemas there for HTTP actions, CLI payloads, push payloads, and shared read endpoints such as cluster health.
- Put shared enums and literals there when multiple repos need the same allowed values.
- Keep runtime implementation details out of `cowtail-protocol`: no Convex queries or mutations, no env loading, no HTTP clients, no UI state, no Swift-only mapping code.
- If a payload shape is only a local view model for this web app, keep it in this repo instead of promoting it to the protocol package.
- When a protocol changes, update `cowtail-protocol` first, publish a new tag, then bump the pinned dependency in this repo. Do not re-declare the wire format locally as a shortcut.

## Local Build

- Install dependencies with `bun install --frozen-lockfile`.
- Build the web app with `bun run build`.
- The production image is built from [`Dockerfile`](./Dockerfile).
- Static assets are served by nginx using [`nginx.conf`](./nginx.conf).

## Convex Deploy Path

Convex is deployed separately from the web image.

- Workflow: [`.github/workflows/convex-deploy.yml`](./.github/workflows/convex-deploy.yml)
- Trigger:
  - push to `main`
  - only when changes touch `convex/**`, `package.json`, `bun.lock`, or the workflow itself
  - can also be run manually with `workflow_dispatch`
- Runtime:
  - runs on a self-hosted GitHub Actions runner
  - uses `bun install --frozen-lockfile`
  - deploys with `bunx convex deploy`

Important implementation detail:

- The repo depends on a private Git dependency fetched during `bun install`.
- The workflow rewrites Git SSH URLs to HTTPS with a token before installing dependencies.
- `actions/checkout` must keep `persist-credentials: false`, otherwise the checkout token can override the intended Git auth for the private dependency.
- If Convex deploy starts failing during dependency installation, inspect the Git rewrite and checkout credential behavior before changing package managers or deployment logic.

## Web Deploy Path

The web app is shipped as a container image.

- Workflow: [`.github/workflows/release.yml`](./.github/workflows/release.yml)
- Trigger:
  - push of a version tag matching `v*`
- Runtime:
  - builds the image from [`Dockerfile`](./Dockerfile)
  - publishes multi-architecture container images
  - creates a GitHub Release for the tag

Important boundary:

- This repository builds and publishes the web image.
- The actual Kubernetes rollout is managed outside this repo by GitOps.
- If the running web deployment needs changes, update the external infrastructure source of truth rather than applying resources manually to the cluster.

## Agent Checklist

Before changing deploy behavior:

- Read the relevant workflow file first.
- Preserve Bun-based install and build steps unless there is a strong reason to change them.
- Preserve the split between Convex deploys and web image releases.
- Avoid adding environment-specific values or identifying infrastructure details to this repository.
