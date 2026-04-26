# Cowtail OpenClaw Plugin

Native OpenClaw channel plugin for Cowtail mobile realtime.

Load it from an OpenClaw config with `plugins.entries.cowtail.path` pointing at this package. When loading from this source checkout, run `bun install && bun run build` in this directory first so the `dist/` entrypoints exist.

Configure `channels.cowtail.url` with the Cowtail realtime WebSocket endpoint and `channels.cowtail.bridgeToken` with the same bridge token configured on the Cowtail realtime service.

V1 supports a single owner and OpenClaw's default `main` agent only.
