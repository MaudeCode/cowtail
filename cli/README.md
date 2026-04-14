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
- `cowtail update`
- `cowtail alert create`
- `cowtail alert list`
- `cowtail alert show`
- `cowtail alert delete`
- `cowtail config show`
- `cowtail fix create`
- `cowtail fix list`
- `cowtail fix show`
- `cowtail fix delete`
- `cowtail health show`
- `cowtail push send`
- `cowtail push test`
- `cowtail users list`
- `cowtail help`

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

`baseUrl` is required. `pushBearerToken` is only required for authenticated commands such as `users list`, `push send`, and `push test`.

`cowtail config show` reports the resolved config path, whether the file was found, whether a base URL is configured, and whether a push token is configured without printing secret values.

Tagged release builds embed the Git tag as the canonical CLI version. Local builds default to `dev` unless `COWTAIL_VERSION` is set.

## Planned command shape
- `cowtail version`
- `cowtail update`
- `cowtail alert create`
- `cowtail alert list`
- `cowtail alert show`
- `cowtail alert delete`
- `cowtail config show`
- `cowtail fix create`
- `cowtail fix list`
- `cowtail fix show`
- `cowtail fix delete`
- `cowtail health show`
- `cowtail push send`
- `cowtail push test`
- `cowtail users list`

## Examples
```bash
cowtail version

cowtail update --check

cowtail config show

cowtail health show

cowtail users list

cowtail alert list --severity critical

cowtail fix list --scope reactive

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
