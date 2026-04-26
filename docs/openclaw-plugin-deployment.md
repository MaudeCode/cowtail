# OpenClaw Plugin Deployment

The Cowtail OpenClaw plugin lets an OpenClaw deployment use Cowtail realtime as a channel. This document covers the repo-owned package contract: published artifact, release path, OpenClaw configuration, local-source loading, and verification.

Keep environment-specific names, hostnames, cluster names, filesystem paths, and secret values out of tracked documentation.

## Published Artifact

The plugin is published as the scoped npm package declared in [`openclaw-plugin/package.json`](../openclaw-plugin/package.json).

Push a version tag matching `v*` after `main` contains the desired changes. The release workflow:

- rewrites the plugin package version from the Git tag by stripping the leading `v`;
- installs root and plugin dependencies with Bun;
- runs the plugin check and test commands;
- builds the plugin into `dist/`;
- packs the npm tarball;
- validates that the tarball exists and can be read;
- publishes the tarball to npm with provenance through trusted publishing;
- attaches the tarball to the GitHub Release.

Do not commit generated npm tarballs or `dist/` output. They are release artifacts.

## Trusted Publishing

The npm package is expected to use trusted publishing from the release workflow.

Required package settings:

- provider: GitHub Actions;
- repository: this repository;
- workflow filename: `release.yml`;
- environment: unset, unless the workflow is changed to use a GitHub deployment environment.

Required workflow/package details:

- the publish job must run on a GitHub-hosted runner;
- the publish job must grant `id-token: write`;
- `openclaw-plugin/package.json` must keep repository metadata that points at this repository and the plugin subdirectory;
- publish with `npm publish --provenance --access public`.

If trusted publishing fails, check npm package settings, the package repository metadata, the workflow filename, and the publish job runner before adding a long-lived npm token.

## OpenClaw Configuration

Install the published package in the OpenClaw environment:

```bash
npm install @maudecode/openclaw-cowtail
```

Then point the OpenClaw plugin entry at the installed package:

```json5
{
  plugins: {
    entries: {
      cowtail: {
        enabled: true,
        path: "@maudecode/openclaw-cowtail"
      }
    }
  },
  channels: {
    cowtail: {
      url: "wss://example.invalid/openclaw/realtime",
      bridgeToken: {
        source: "env",
        provider: "env",
        id: "OPENCLAW_COWTAIL_BRIDGE_TOKEN"
      }
    }
  }
}
```

Configure the Cowtail channel with:

- `channels.cowtail.url`: the deployed Cowtail realtime WebSocket endpoint;
- `channels.cowtail.bridgeToken`: the same bridge token configured for the Cowtail realtime service;
- `channels.cowtail.agentId`: optional, defaults to the supported OpenClaw agent for v1.

The bridge token is secret material. Prefer an OpenClaw-supported secret reference or environment-backed secret instead of putting the raw value directly in tracked config.

The realtime URL must reach the route documented in [`cowtail-realtime-deployment.md`](./cowtail-realtime-deployment.md):

```text
/openclaw/realtime
```

## Local Source Loading

When loading the plugin from this repository checkout instead of the published npm package, build the plugin first:

```bash
cd openclaw-plugin
bun install --frozen-lockfile
bun run build
```

The package metadata points OpenClaw at `dist/` entrypoints, so `plugins.entries.cowtail.path` must refer to a built package directory.

## Verification

Before releasing plugin changes:

```bash
bun run check:openclaw-plugin
bun run test:openclaw-plugin
cd openclaw-plugin && bun run build
cd openclaw-plugin && npm pack --dry-run
```

After release:

1. Confirm the release workflow completed successfully.
2. Confirm the npm package version matches the Git tag without the leading `v`.
3. Confirm the package tarball contains `dist/index.js`, `dist/setup-entry.js`, `openclaw.plugin.json`, `package.json`, and `README.md`.
4. Confirm OpenClaw can load the installed plugin package.
5. Confirm the plugin can connect to the deployed Cowtail realtime WebSocket endpoint with the configured bridge token.

## Boundaries

- The plugin package is published by this repository.
- The running OpenClaw deployment and its config are managed outside this repository.
- The Cowtail realtime service deployment is documented separately.
- Do not patch running infrastructure directly from this repository when the source of truth lives elsewhere.
