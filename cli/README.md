# cowtail-cli

Cowtail CLI for Cowtail backend actions.

## Goals
- Ship a real macOS arm64 executable binary
- Keep the codebase in TypeScript
- Use Bun for local development and compilation
- Give alertmanager-related automation a thin, standard interface into Cowtail

## Current status
Phase 1 is implemented:
- `cowtail version`
- `cowtail alert create`
- `cowtail fix create`
- `cowtail subs list`
- `cowtail push send`
- `cowtail push test`
- `cowtail auth whoami`
- `cowtail help`

## Handoff docs
If you want an LLM or another engineer to finish the implementation, start here:
- [`docs/HANDOFF.md`](./docs/HANDOFF.md)

## Layout
- `src/cli.ts` - entrypoint
- `src/commands/` - command handlers
- `src/lib/` - config and HTTP helpers

## Development
```bash
cd ..
bun install
cd cli
bun install
bun run check
bun run dev -- help
```

## Build executable
```bash
cd cli
bun run build
./dist/cowtail help
```

## Install From A Release
```bash
curl -fsSL https://raw.githubusercontent.com/MaudeCode/cowtail/main/cli/install.sh | sh
```

Set `COWTAIL_VERSION=vX.Y.Z` to pin a specific release tag. Set `INSTALL_DIR=/your/bin` to override the install location.

## Config
The CLI reads runtime settings from a JSON config file.

Default lookup path:
- `~/.config/cowtail/config.json`

Optional path override:
- `COWTAIL_CONFIG_PATH`

Example config:
```json
{
  "baseUrl": "https://your-cowtail.example/actions",
  "pushBearerToken": "replace-me",
  "timeoutMs": 10000
}
```

`baseUrl` is required. `pushBearerToken` is only required for authenticated commands such as `subs list`, `push send`, and `push test`.

`cowtail auth whoami` reports the resolved config path, whether the file was found, whether a base URL is configured, and whether a push token is configured without printing secret values.

Tagged release builds embed the Git tag as the canonical CLI version. Local builds default to `dev` unless `COWTAIL_VERSION` is set.

## Planned command shape
- `cowtail version`
- `cowtail alert create`
- `cowtail fix create`
- `cowtail subs list`
- `cowtail push send`
- `cowtail push test`
- `cowtail auth whoami`

## Examples
```bash
cowtail version

cowtail auth whoami

cowtail subs list

cowtail alert create \
  --alertname KubePodCrashLooping \
  --severity warning \
  --namespace default \
  --status firing \
  --outcome fixed \
  --summary 'Deployment was crashlooping due to missing secret' \
  --action 'Patched secret reference and restarted deployment'

cowtail fix create \
  --alert-id abc123 \
  --description 'Patched RBAC and reconciled deployment' \
  --root-cause 'Missing ClusterRole rule' \
  --scope reactive

cowtail push test \
  --user-id '001612.bb9a2ce6d90341d880c8e6065c232aae.2317'
```
