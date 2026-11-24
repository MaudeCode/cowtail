# hermes-cowtail-tool

Hermes plugin with two roles: a typed `cowtail` tool for Cowtail alert and investigation-job operations, and a `cowtail` platform that makes Cowtail one of Hermes's messaging platforms.

## Environment

```text
COWTAIL_API_BASE=https://cowtail-actions.example.com
COWTAIL_WORKER_TOKEN=<secret>
COWTAIL_WORKER_ID=hermes-default-gateway
COWTAIL_PLATFORM_ENABLED=true   # run the platform; the tool works without it
COWTAIL_HOME_CHANNEL=owner      # optional; the name cron delivery uses for the Cowtail inbox
MAUDEUTILS_URL=http://127.0.0.1:3847  # optional; runbook runs from Cowtail
MAUDEUTILS_TOKEN=<secret>
```

## Platform

With `COWTAIL_PLATFORM_ENABLED=true` the gateway runs the `cowtail` platform beside the tool:

- A message Hermes sends becomes a Cowtail item through `POST /api/items`: `kind=fyi`, `urgency=today`, unless the sender's metadata names another `kind` or `urgency`.
- `cowtail` is a cron `deliver` and `failure_deliver` target. A failure notice becomes a `failure` item with `dedupeKey=cron-incident:<incidentId>` and an Ack action; acking it acknowledges the Hermes incident, so repeats of that failure stay quiet.
- A dangerous-command approval becomes an `approval` item with Approve and Deny that expires at Hermes's approval deadline. The item binds to the Hermes request id and shows the whole command; an approval that cannot be shown whole or bound is refused, and Hermes falls back to its text prompt. A `clarify` question becomes a `question` item with Reply, plus Choose when Hermes offers choices, that expires at the clarify timeout.
- Every 3 seconds the platform claims the owner's answers from `POST /api/hermes/responses/claim` and applies each one: Approve resolves the approval once, Deny denies it, a reply or choice answers the question, Ack acknowledges the cron incident. It confirms with `/complete`, or `/fail` when Hermes no longer holds the request. Cowtail then resolves or expires the item. Answers are pulled, so no port opens on the Hermes host, and a lease brings an answer back after a Hermes restart. An approval answer targets the exact Hermes request it was shown for, and an answer Hermes already applied is confirmed again on its next lease, never applied twice.
- Every 60 seconds the platform posts `POST /api/hermes/heartbeat` with the connected platforms, model and provider, cron jobs, open cron incidents and kanban counts. Cowtail raises a `hermes:heartbeat-missing` failure item after 5 minutes of silence and resolves it on the next heartbeat.
- With `MAUDEUTILS_URL` set, the heartbeat also carries the MaudeUtils script catalog as `runbook`, and every 3 seconds the platform claims the runbook runs the owner starts from Cowtail (`POST /api/hermes/runbook-runs/claim`). It tells Cowtail the run is starting, then starts it on the local MaudeUtils with `POST /api/run-stream/:id`, forwards stdout and stderr in batches at most once a second to `/output`, and reports the exit code to `/complete`. A run MaudeUtils refuses (401, 404) or cannot reach reports exit code -1 with the reason as its output. Cowtail leases a run again only when Hermes stopped before it said the run was starting; a run that started and then went silent ends `unknown` and is never run again on its own. MaudeUtils stays unexposed: Cowtail never calls it.

Approvals and questions reach the adapter of the platform the session runs on, so Cowtail receives those for sessions that run on Cowtail.

## Tool actions

- `status`
- `alert.get`
- `alert.query_range`
- `alert.write`
- `fix.write`
- `job.claim`
- `job.get`
- `job.renew`
- `job.complete`
- `job.fail`
- `job.handoff`
- `job.requeue`
- `job.deadletters`
- `webhook.render_alert_prompt`

The plugin does not receive webhooks itself. Hermes webhook subscriptions invoke an agent, and that agent uses this tool to claim and complete Cowtail jobs.

Alertmanager may group hundreds of firing alerts into one investigation job. `job.claim` returns the immutable firing-at-ingest members in `relatedAlerts`; `job.complete` requires `batch_results` with exactly one terminal outcome for every member, even if one has since resolved. Cowtail rejects partial batch completion, preserving one-session storm control without leaving sibling alerts unhandled.

`job.claim` and `job.get` also return `priorOccurrences`: for each member alert, up to 3 earlier firings of the same alert, newest first, with their outcome, root cause and linked fixes. A batch too large to inline them leaves them out of the prompt and the compacted claim; `job.history` with `job_id` and `alert_id` returns one member's. The rendered prompt embeds only what Cowtail shapes about each one (its alert, when it fired, its outcome and a fix commit hash), since causes, summaries and fix text come from API callers and stay in the claim's structured result. It asks Hermes to check whether a previous root cause and fix apply before investigating from scratch. Each `batch_results` entry, and a legacy single-alert completion, takes `evidence`: up to 20 steps of `{step, command?, output?, at?}`. Cowtail keeps the first 4 KB of each output and shows the steps on the item's timeline.

## Terminal failure and handoff

`job.fail` reads the exact current job and frozen `relatedAlerts` projection from its immutable source event. It requires the current worker's claim token and a nonexpired lease. A retryable failure below `maxAttempts` keeps Cowtail's existing queued retry behavior, without messaging. Completion and resolved-only failures also remain silent.

A nonretryable failure, or an exhausted retry budget, with **any** unresolved member requires a genuine external boundary. Ordinary repair failure is rejected with `continuation_needed=true`. Continue repair and renew rather than treating failure as permission to disappear.

The rendered worker prompt requires loading the alertmanager skill and checking our configuration, supported invocation, version and source/target identities first. Previous diagnoses and deadletter reasons are hypotheses. An upstream-defect diagnosis requires an exact-version reproduction under supported usage, expected versus actual results and evidence ruling out local mistakes. Insufficient evidence means diagnosis unconfirmed and continued investigation, not a publication blocker. For Kopiur, compare capture, verifier and restore evidence for the same manifest and source; distinguish cached/new-file counters, complete tree counts and restored content. Upstream patches and custom artifacts are outside automated alert repair. A reproduced defect is evidence to retain, not permission to prepare a patch or request publication approval. Diagnosis and supported local configuration/runtime repair continue under the incident's authority.

Structured boundary pairs:

| `blocker_kind` | `blocker_code` | Required human decision/action |
| --- | --- | --- |
| `permission` | `permission_required` | Authorize a necessary privileged local repair |
| `access` | `access_required` | Restore required account/system access |
| `physical` | `physical_intervention` | Perform on-site hardware intervention |
| `unavailable_external_prerequisite` | `external_prerequisite` | Restore the unavailable prerequisite |

Automated alert workers may not prepare upstream patches, fork repositories, publish custom artifacts or request approval for those actions, even after a local defect reproduction. The schema no longer offers `upstream_publication`. Legacy requests using that code or `blocked_upstream_publication` / `blocked_upstream_artifact` phases are rejected with `continuation_needed=true` before any send or backend mutation. An already-stopped upstream-publication job cannot be relabeled as a generic permission handoff. Continue supported local diagnosis and repair without weakening integrity coverage. Separately user-directed upstream development is not an automated alert handoff.

Before calling the existing Cowtail fail endpoint, the guard sends one deterministic actionable handoff through `hermes send --to imsg --json --file -`. Outgoing text contains only fixed template text, validated resource identifier values from `alertname`, `namespace`, `policy`, and `job`, plus the native job ID. It never includes errors, summaries, logs, claim tokens, URLs or arbitrary caller text.

The stock installed iMessage standalone sender currently reports text success with an empty `message_id`. That is **not** accepted as proof. The guard reads the single configured target using `hermes send --list imsg --json` and verifies an exact outgoing text match, chat ID, send-time window and native GUID through read-only `imsg history`. Failed, empty, conflicting or ambiguous receipts do not release the claim. Native Messages history access must be available to the worker. No iMessage recipient is hardcoded and no new credentials are needed.

Private delivery receipts live under `$HERMES_HOME/cowtail-delivery-receipts`, defaulting to `~/.hermes/cowtail-delivery-receipts`. Directory/files use 0700/0600. A hash of affected alert lifecycle identities and the structured root-cause/decision deduplicates successful sends across jobs and retries. An advisory file lock serializes concurrent attempts. This stores delivery receipts and in-flight delivery metadata only, not a second incident ledger. Keep it on a local filesystem shared by this worker's processes. Lock acquisition is bounded.

An intent is durably stored before sending. Timeout/crash/ambiguous output leaves an unknown delivery receipt. Later attempts only read native history to reconcile it, never automatically resend. If no exact provider receipt exists, inspect delivery manually and continue repair/renew. Do not delete an unknown receipt just to force a resend. Successful receipts survive backend failures; retries reuse them without another message. After the fail endpoint, the guard reads the actual job back and verifies expected queued/deadletter status, released claim, unchanged attempts/source event, and exactly preserved error history plus the new failure. A lost mutation response can therefore be verified without another notification.

For an **already deadlettered** exact job, `job.handoff` runs the same boundary/delivery gate without claiming, resetting, requeueing or editing the job:

```json
{"action":"job.handoff","job_id":"NATIVE_JOB_ID","blocker_kind":"permission","blocker_code":"permission_required"}
```

This action is idempotent for the same affected lifecycles and boundary. It does not accept a claimed job as an alternative terminal escape.

## Verification and activation

From `hermes-plugin/`:

```sh
python3 -m unittest discover -s tests -v
python3 -m compileall -q __init__.py handlers.py handoff.py cowtail_client.py cowtail_platform.py
hermes plugins validate .
hermes plugins doctor . --ci
```

All unit-test transports are mocked. Tests do not send real messages or mutate Cowtail.

Live proof requires a separately authorized operator and the gateway loading this source revision. Read `job.get` for the exact real incident first. If it is already deadlettered and still has an unresolved frozen member with a genuine publication authority boundary, call the `job.handoff` example with that native job ID. Confirm `handoff_verified=true`, the native provider receipt, one real iMessage, and unchanged job status/history. Repeat the identical call and verify no second message. Do not reset/requeue the incident to create a probe. For a claimed real incident, use its actual owned token and lease with `job.fail`, `retryable=false`, a concrete internal `error`, and the structured boundary only after available safe repair work is prepared; verify backend readback/history. Never put tokens into shell history or outgoing text.
