# Cowtail Realtime Deployment

Cowtail Realtime adds a WebSocket service alongside the existing web image and Convex deployment. OpenClaw is the first provider using this channel. This document only covers the repo-owned deployment contract: published artifacts, required runtime configuration, required routing, and deployment verification.

The OpenClaw plugin package has a separate release and configuration contract documented in [`openclaw-plugin-deployment.md`](./openclaw-plugin-deployment.md).

Keep environment-specific names, hostnames, cluster names, filesystem paths, and secret values out of tracked documentation.

## Published Artifacts

Push a version tag matching `v*` after `main` contains the desired changes.

The release workflows publish:

- Cowtail web image from `web/Dockerfile`;
- Cowtail realtime image from `realtime/Dockerfile`;
- OpenClaw plugin npm package from `openclaw-plugin/`;
- CLI release artifacts.

The Convex deploy workflow deploys functions from `web/`.

The running rollout is managed outside this repository. Update the infrastructure source of truth to reference the published image tags and runtime configuration. Do not patch running infrastructure directly from this repo.

## Required Runtime Configuration

### Convex

Configure these variables in the Convex runtime:

- `COWTAIL_OPENCLAW_OWNER_USER_ID`
- `COWTAIL_REALTIME_CONVEX_TOKEN`
- `PUSH_API_BEARER_TOKEN`

### Realtime Service

Configure these variables where the realtime service runs:

- `OPENCLAW_COWTAIL_BRIDGE_TOKEN`
- `COWTAIL_HTTP_BASE_URL`
- `CONVEX_URL` or `VITE_CONVEX_URL`
- `PUSH_API_BEARER_TOKEN`
- `COWTAIL_OPENCLAW_OWNER_USER_ID`
- `COWTAIL_REALTIME_CONVEX_TOKEN`
- `PORT` optional, defaults to `8787`

`COWTAIL_OPENCLAW_OWNER_USER_ID`, `COWTAIL_REALTIME_CONVEX_TOKEN`, and `PUSH_API_BEARER_TOKEN` must match between the Convex and realtime runtimes.

## Required Routing

Expose the realtime service WebSocket endpoint:

```text
/openclaw/realtime
```

The route must support WebSocket upgrades and long-lived connections.

The realtime service also exposes:

```text
/healthz
```

The web nginx container continues to serve the static app and proxy the existing Cowtail HTTP surfaces. Add Cowtail Realtime routing in the external infrastructure source of truth.

## Deployment Verification

After deployment:

1. Confirm the tag workflows completed for Convex, web image, and realtime image.
2. Confirm the web deployment serves existing Cowtail routes.
3. Confirm the realtime deployment reports healthy on `/healthz`.
4. Confirm `/openclaw/realtime` reaches the realtime service and does not return a generic routing 404.
5. Confirm the OpenClaw provider plugin is configured with the deployed Cowtail Realtime URL and the same bridge token as the realtime service.
