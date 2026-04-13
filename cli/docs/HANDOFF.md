# Cowtail CLI Handoff

This document is the real implementation handoff for the `cowtail-cli` scaffold.

It is written for a future LLM or human picking up the `cli/` project and finishing the CLI.

## What this CLI is for

The CLI should be a thin local client for Cowtail's existing backend.

Primary goal:
- give Alertmanager-related sessions and automation a single standard executable to call
- keep payload shaping, auth headers, retries, and output formatting in one place
- avoid every session hand-building `curl` requests to Cowtail

The CLI should talk to Cowtail's backend over HTTP.
It should **not** send APNs directly.
It should **not** reimplement server-side auth logic.

## Repo and runtime decisions

Current scaffold choices are intentional:
- language: TypeScript
- runtime for development/build: Bun
- delivery target: compiled macOS arm64 executable binary
- current binary name: `cowtail`

Current build command:
```bash
cd cli
bun run build
```

This compiles:
- `src/cli.ts` -> `dist/cowtail`

## Runtime config file

Use a JSON config file for CLI settings and tokens.

Default path:
```text
~/.config/cowtail/config.json
```

Optional override:
```text
COWTAIL_CONFIG_PATH
```

Recommended shape:
```json
{
  "baseUrl": "https://your-cowtail.example/actions",
  "pushBearerToken": "<push-api-bearer-token>",
  "timeoutMs": 10000
}
```

`baseUrl` is required in the config file. `timeoutMs` can fall back to a local default if omitted, but secrets should still come from the config file rather than ad hoc environment variables.

## Target Cowtail backend

### Base URL
Use:
```text
https://your-cowtail.example/actions
```

So the CLI should hit routes like:
- `https://your-cowtail.example/actions/api/alerts`
- `https://your-cowtail.example/actions/api/fixes`
- `https://your-cowtail.example/actions/api/push/send`

### Important architecture rule
The CLI is a client for Cowtail's Convex HTTP actions.
The backend is already the source of truth for:
- push delivery
- Apple identity verification for app registration
- allowlist enforcement
- APNs token storage
- disabling bad tokens after APNs failures

Do not move those responsibilities into the CLI.

## Existing backend routes the CLI should know about

### 1. `POST /api/alerts`
Purpose:
- create an alert record in Cowtail

Current request shape:
```json
{
  "timestamp": 1712966400000,
  "alertname": "KubePodCrashLooping",
  "severity": "warning",
  "namespace": "default",
  "node": "worker-01",
  "status": "firing",
  "outcome": "fixed",
  "summary": "Pod was crashlooping due to bad config",
  "action": "Updated ConfigMap and restarted deployment",
  "rootCause": "Invalid env var reference",
  "messaged": true,
  "resolvedAt": 1712966700000
}
```

Required fields in practice:
- `alertname`
- `severity`
- `namespace`
- `status`
- `outcome`
- `summary`
- `action`

Server behavior:
- defaults `timestamp` to `Date.now()` if omitted
- defaults `messaged` to `false` if omitted
- omits optional Convex fields when not present

Current response shape:
```json
{
  "ok": true,
  "id": "<convex-id>"
}
```

### 2. `POST /api/fixes`
Purpose:
- write a fix record linked to one or more alert IDs

Current request shape:
```json
{
  "timestamp": 1712966400000,
  "alertIds": ["<convex-alert-id>"],
  "description": "Patched RBAC and reconciled deployment",
  "rootCause": "Missing ClusterRole rule",
  "scope": "reactive",
  "commit": "abc1234"
}
```

Expected `scope` values:
- `reactive`
- `weekly`
- `monthly`

Current response shape:
```json
{
  "ok": true,
  "id": "<convex-id>"
}
```

### 3. `POST /api/push/send`
Purpose:
- send a push notification to all enabled devices for a Cowtail user

Auth:
- requires `Authorization: Bearer <PUSH_API_BEARER_TOKEN>`

Current request shape:
```json
{
  "userId": "<apple-sub>",
  "title": "Cowtail alert fixed",
  "body": "KubePodCrashLooping was fixed automatically.",
  "data": {
    "kind": "alert-fixed",
    "alertname": "KubePodCrashLooping"
  }
}
```

Notes:
- `userId` here is currently the Apple `sub` from Sign in with Apple
- the backend looks up enabled device registrations for that user
- the backend sends to APNs itself
- the backend disables bad tokens for reasons like:
  - `BadDeviceToken`
  - `DeviceTokenNotForTopic`
  - `Unregistered`

Current response shape:
```json
{
  "ok": true,
  "userId": "<apple-sub>",
  "sent": 1,
  "failed": 0,
  "results": [
    {
      "deviceToken": "8235fc…cd8a7b",
      "apnsId": "3388C618-2EAC-D630-8A29-0F864F7CF2B1",
      "ok": true,
      "status": 200
    }
  ]
}
```

### 4. `POST /api/push/test`
Purpose:
- helper wrapper around push send for test notifications

Auth:
- requires `Authorization: Bearer <PUSH_API_BEARER_TOKEN>`

Current request shape:
```json
{
  "userId": "<apple-sub>",
  "title": "Cowtail test notification",
  "body": "Push delivery from Cowtail is working.",
  "data": {
    "source": "cowtail-cli"
  }
}
```

Defaults:
- if title/body are omitted, server provides default test text
- server injects `data.test = true`

### 5. `POST /api/push/register`
Purpose:
- app-side APNs registration only

This is **not** a primary CLI target.
The iOS app should call it, not Alertmanager sessions.

Current request shape:
```json
{
  "identityToken": "<apple-sign-in-identity-token>",
  "deviceToken": "<apns-device-token>",
  "platform": "ios",
  "environment": "development",
  "deviceName": "iPhone"
}
```

Server behavior:
- verifies Apple token signature against Apple's public keys
- validates issuer and audience
- extracts:
  - `sub`
  - `email`
  - `emailVerified`
  - `isPrivateEmail`
- allowlists by `appleSub` first, then bootstrap fallback by `email`
- stores device registration under `userId = appleSub`

Important consequence:
- the CLI should treat `userId` as the Apple `sub`, not an arbitrary app string

## Existing backend auth model

### Push auth
Used by the CLI for push commands.

Config file field on the CLI side:
- `pushBearerToken`

Header:
```text
Authorization: Bearer <token>
```

### Apple auth
Only relevant for the app registration flow.
Do not implement Sign in with Apple token verification in the CLI.
That belongs on the server and is already there.

## Recommended CLI surface

Keep the public CLI small.

### Phase 1 commands
Implement these first:
- `cowtail alert create`
- `cowtail fix create`
- `cowtail subs list`
- `cowtail push send`
- `cowtail push test`
- `cowtail auth whoami`
- `cowtail help`

### Optional later commands
Only if they become useful:
- `cowtail alert delete`
- `cowtail fix delete`
- `cowtail alert webhook`
- `cowtail config print`
- `cowtail doctor`

## Recommended UX shape

### 1. Dual output mode
Support:
- human-readable default output
- `--json` for automation and skills

Example human output:
```text
Created alert jd123...
```

Example JSON output:
```json
{
  "ok": true,
  "id": "jd123..."
}
```

### 2. Exit codes
Use predictable exit behavior:
- `0` for success
- non-zero for request/build/validation failures

### 3. Validation before request
The CLI should fail early for obviously missing required fields.
Do not rely only on the server to tell the user they forgot `alertname` or `title`.

### 4. Clear stderr
For failures, print useful messages to stderr.
Example:
```text
Request failed (401): Unauthorized
```

## Recommended flags and arguments

The exact parser library is up to the implementer, but this shape is recommended.

### `cowtail alert create`
Suggested flags:
- `--alertname <name>`
- `--severity <warning|critical|...>`
- `--namespace <namespace>`
- `--status <firing|resolved>`
- `--outcome <fixed|self-resolved|noise|escalated>`
- `--summary <text>`
- `--action <text>`
- `--root-cause <text>`
- `--node <node>`
- `--messaged`
- `--timestamp <ms-or-iso>`
- `--resolved-at <ms-or-iso>`
- `--json`

### `cowtail fix create`
Suggested flags:
- `--alert-id <id>` (repeatable) or `--alert-ids <comma-separated>`
- `--description <text>`
- `--root-cause <text>`
- `--scope <reactive|weekly|monthly>`
- `--commit <sha>`
- `--timestamp <ms-or-iso>`
- `--json`

### `cowtail push send`
Suggested flags:
- `--user-id <apple-sub>`
- `--title <text>`
- `--body <text>`
- `--data <json>`
- `--json`

### `cowtail push test`
Suggested flags:
- `--user-id <apple-sub>`
- `--title <text>`
- `--body <text>`
- `--data <json>`
- `--json`

### `cowtail subs list`
Suggested behavior:
- list current Apple `sub` values with at least one enabled device registration
- require the same bearer token used for authenticated service routes
- support `--json`

### `cowtail auth whoami`
Suggested behavior:
- print resolved config path
- print whether the config file exists
- print resolved base URL
- print whether push token is configured
- optionally print timeout
- never print the secret token value

## Suggested implementation layout

The current scaffold is fine, but finish it roughly like this:

```text
src/
  cli.ts
  commands/
    alert.ts
    fix.ts
    push.ts
    auth.ts
    help.ts
  lib/
    config.ts
    http.ts
    output.ts
    errors.ts
    parse.ts
    types.ts
```

### `src/lib/config.ts`
Should own:
- config file loading
- config path resolution
- default base URL
- timeout parsing
- secret presence checks

### `src/lib/http.ts`
Should own:
- POST helper
- optional DELETE helper
- auth header injection for push routes only, or for commands that explicitly request it
- request timeout handling
- standardized error wrapping

### `src/lib/output.ts`
Should own:
- human vs JSON output
- success printers
- failure printers

### `src/lib/parse.ts`
Should own:
- safe JSON parsing for `--data`
- timestamp normalization
- comma-separated ID parsing

## Important implementation details

### 1. Do not always send the bearer token
Right now only push routes require the bearer token.
The CLI should not blindly attach it to every request unless there is a deliberate reason.

### 2. Treat timestamps carefully
Cowtail stores timestamps as milliseconds since epoch.
It is fine to accept ISO strings in the CLI, but normalize them before sending.

### 3. Treat `userId` as Apple `sub`
For push commands, `userId` is not a friendly username.
It is the stable Sign in with Apple `sub` used by the backend.

### 4. Keep the CLI thin
This CLI should not decide alert outcomes for the agent.
The session or caller decides things like:
- whether the alert was fixed
- whether an operator was messaged
- what summary/action/root cause text should be

The CLI just validates, shapes, and submits.

### 5. Prefer deterministic flags over interactive prompts
This tool is meant for automation and skill use.
Interactive flows should be minimal or absent.

## Example request mappings

### Example: create alert
```bash
cowtail alert create \
  --alertname KubePodCrashLooping \
  --severity warning \
  --namespace default \
  --status firing \
  --outcome fixed \
  --summary 'Deployment was crashlooping due to missing secret' \
  --action 'Patched secret reference and restarted deployment' \
  --root-cause 'Secret name mismatch' \
  --node worker-01 \
  --messaged
```

Should POST:
```json
{
  "alertname": "KubePodCrashLooping",
  "severity": "warning",
  "namespace": "default",
  "status": "firing",
  "outcome": "fixed",
  "summary": "Deployment was crashlooping due to missing secret",
  "action": "Patched secret reference and restarted deployment",
  "rootCause": "Secret name mismatch",
  "node": "worker-01",
  "messaged": true
}
```

to:
```text
POST /api/alerts
```

### Example: send push
```bash
cowtail push send \
  --user-id '001612.bb9a2ce6d90341d880c8e6065c232aae.2317' \
  --title 'Cowtail alert fixed' \
  --body 'KubePodCrashLooping was fixed automatically.' \
  --data '{"kind":"alert-fixed","alertname":"KubePodCrashLooping"}'
```

Should POST:
```json
{
  "userId": "001612.bb9a2ce6d90341d880c8e6065c232aae.2317",
  "title": "Cowtail alert fixed",
  "body": "KubePodCrashLooping was fixed automatically.",
  "data": {
    "kind": "alert-fixed",
    "alertname": "KubePodCrashLooping"
  }
}
```

to:
```text
POST /api/push/send
```
with the bearer token header.

## Suggested implementation order

1. implement a reusable arg parser strategy
2. implement shared output helpers
3. finish `cowtail alert create`
4. add `cowtail fix create`
5. finish `cowtail push send`
6. add `cowtail push test`
7. improve `auth whoami`
8. add `--json` everywhere
9. add smoke-test examples to the README

## What not to do

- do not send APNs directly from the CLI
- do not put Apple identity verification in the CLI
- do not invent a second auth model for push
- do not make this a big framework or daemon
- do not make the commands interactive-first
- do not depend on the iOS app codebase to run basic alert and push commands

## Local sanity checks after implementation

At minimum, the implementer should be able to run:

```bash
cd cli
bun install
bun run check
bun run build
./dist/cowtail help
./dist/cowtail version
./dist/cowtail auth whoami
```

Once real commands exist, also verify:

```bash
./dist/cowtail alert create ...
./dist/cowtail push test --user-id '<apple-sub>'
```

## Current implementation status

Present now:
- Bun build config
- TypeScript project setup
- compiled binary build
- build version output from `COWTAIL_VERSION`
- config file loading
- argument parsing and validation
- structured output and JSON mode
- `version`
- `alert create`
- `fix create`
- `subs list`
- `push send`
- `push test`
- `auth whoami`
- command docs and examples in the main README
