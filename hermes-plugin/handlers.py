"""Hermes tool handler for Cowtail alert and job operations."""

from __future__ import annotations

import json
import subprocess
from typing import Any

from .cowtail_client import CowtailClient, CowtailError, cowtail_available
from .handoff import BLOCKER_KINDS, BOUNDARIES, ContinuationNeeded, guarded_action

_ACTIONS = [
    "status",
    "alert.get",
    "alert.query_range",
    "alert.write",
    "fix.write",
    "job.claim",
    "job.get",
    "job.renew",
    "job.complete",
    "job.fail",
    "job.handoff",
    "job.requeue",
    "job.deadletters",
    "webhook.render_alert_prompt",
]

_OUTCOMES = ["pending", "recorded", "fixed", "self-resolved", "noise", "escalated"]
_TERMINAL_OUTCOMES = [outcome for outcome in _OUTCOMES if outcome != "pending"]

COWTAIL_SCHEMA: dict[str, Any] = {
    "name": "cowtail",
    "description": (
        "Typed Cowtail operations for alerts, fixes, and durable investigation jobs. "
        "Use this after Cowtail webhook events to claim, renew, complete, fail, or requeue jobs."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": _ACTIONS, "description": "Operation to perform."},
            "alert_id": {"type": "string"},
            "job_id": {"type": "string"},
            "claim_token": {"type": "string"},
            "lease_seconds": {"type": "integer", "default": 900},
            "from_ms": {"type": "integer"},
            "to_ms": {"type": "integer"},
            "outcome": {"type": "string", "enum": _OUTCOMES},
            "severity": {"type": "string"},
            "summary": {"type": "string"},
            "action_taken": {"type": "string"},
            "root_cause": {"type": "string"},
            "phase": {"type": "string"},
            "error": {"type": "string"},
            "blocker_kind": {"type": "string", "enum": BLOCKER_KINDS},
            "blocker_code": {
                "type": "string",
                "enum": list(BOUNDARIES),
                "description": "Genuine external prerequisite for an authorized local repair. Upstream edits, forks and publication approval requests are not allowed.",
            },
            "retryable": {"type": "boolean", "default": True},
            "messaged": {"type": "boolean", "default": False},
            "batch_results": {
                "type": "array",
                "minItems": 1,
                "description": "One terminal result for every immutable related alert in the claimed job context.",
                "items": {
                    "type": "object",
                    "properties": {
                        "alert_id": {"type": "string"},
                        "outcome": {"type": "string", "enum": _TERMINAL_OUTCOMES},
                        "summary": {"type": "string"},
                        "action_taken": {"type": "string"},
                        "root_cause": {"type": "string"},
                        "messaged": {"type": "boolean", "default": False},
                    },
                    "required": ["alert_id", "outcome", "summary", "action_taken"],
                    "additionalProperties": False,
                },
            },
            "limit": {"type": "integer", "default": 50},
            "payload": {
                "type": "object",
                "description": "Full alert or fix payload for write actions.",
            },
        },
        "required": ["action"],
        "additionalProperties": False,
    },
}


def check_cowtail_available() -> bool:
    return cowtail_available()


def _ok(**data: Any) -> str:
    return json.dumps({"success": True, **data}, sort_keys=True)


def _err(message: str) -> str:
    return json.dumps({"success": False, "error": message}, sort_keys=True)


def _required(args: dict[str, Any], key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} is required")
    return value.strip()


def _int_arg(args: dict[str, Any], key: str, default: int) -> int:
    value = args.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{key} must be an integer")
    return value


def _outcome(args: dict[str, Any]) -> str:
    value = _required(args, "outcome")
    if value not in _OUTCOMES:
        raise ValueError(f"outcome must be one of: {', '.join(_OUTCOMES)}")
    return value


def _payload(args: dict[str, Any]) -> dict[str, Any]:
    payload = args.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("payload is required")
    return payload


def _batch_results(args: dict[str, Any]) -> list[dict[str, Any]] | None:
    values = args.get("batch_results")
    if values is None:
        return None
    if not isinstance(values, list) or not values:
        raise ValueError("batch_results must include every related alert")

    results = []
    for value in values:
        if not isinstance(value, dict):
            raise TypeError("each batch_results entry must be an object")
        outcome = _outcome(value)
        if outcome not in _TERMINAL_OUTCOMES:
            raise ValueError("batch result outcome must be terminal; pending is not allowed")
        results.append(
            {
                "alertId": _required(value, "alert_id"),
                "outcome": outcome,
                "summary": _required(value, "summary"),
                "action": _required(value, "action_taken"),
                "rootCause": value.get("root_cause"),
                "messaged": bool(value.get("messaged", False)),
            }
        )
    return results


def _compact_alert(alert: Any) -> Any:
    if not isinstance(alert, dict):
        return alert
    keys = (
        "id",
        "alertname",
        "severity",
        "status",
        "namespace",
        "node",
        "summary",
        "outcome",
        "labels",
        "generatorURL",
        "sourceEventId",
    )
    return {key: alert[key] for key in keys if key in alert}


def _compact_large_job_context(result: dict[str, Any]) -> dict[str, Any]:
    related = result.get("relatedAlerts")
    if not isinstance(related, list) or len(related) <= 25:
        return result

    job = result.get("job")
    claim_token = job.get("claimToken") if isinstance(job, dict) else None
    alert_ids = [alert.get("id") for alert in related if isinstance(alert, dict)]
    compact: dict[str, Any] = {
        "ok": result.get("ok", True),
        "claimed": result.get("claimed"),
        "claimToken": claim_token,
        "relatedAlertCount": len(related),
        "relatedAlertIds": alert_ids,
        "job": job,
        "alert": _compact_alert(result.get("alert")),
        "sourceEvent": result.get("sourceEvent"),
        "relatedAlerts": [_compact_alert(alert) for alert in related],
    }
    if isinstance(compact["job"], dict):
        compact["job"] = dict(compact["job"])
        compact["job"].pop("claimToken", None)
    return compact


def _render_alert_prompt(args: dict[str, Any]) -> str:
    job_id = _required(args, "job_id")
    return _ok(
        prompt=(
            "Cowtail alert investigation job is available. "
            f"Use the cowtail tool to claim job_id={job_id}. "
            "If claim returns claimed=false, output NO_REPLY. If claimed, treat relatedAlerts as one "
            "incident batch. Load the alertmanager skill before diagnosis. Previous attempts' "
            "root-cause summaries, deadletter reasons and upstream-release blockers are hypotheses, "
            "not established facts. Reuse primary evidence only after checking its exact version, "
            "resource identity and relevance; do not repeat expensive checks of unchanged valid evidence. "
            "Check our usage first: deployed configuration, documented supported workflow, effective "
            "source/target identities, version compatibility and field semantics. Before declaring an "
            "upstream defect, retain an exact-version minimal reproduction under documented supported "
            "usage with expected versus actual results, and evidence ruling out local configuration "
            "and invocation errors. A failed predicate or unexpected counter alone is not that proof. "
            "For Kopiur, bind capture, quick/deep verification and restore evidence to the same "
            "snapshot manifest and source identity; distinguish cached/new-file counters, complete "
            "tree counts and actual restored content. Never infer corruption from those counts alone. "
            "If evidence is insufficient, report diagnosis unconfirmed and continue targeted investigation, "
            "not upstream publication blocked. Missing release or upstream push access does not establish "
            "root cause or remove permission for authorized local diagnosis and repair. Treat the "
            "incident batch and every related alert as a first-class investigation target, even if "
            "its current status is resolved. Obtain current evidence and make an independent outcome "
            "decision for every member; never copy or preserve an earlier sibling summary merely to "
            "satisfy the schema. Renew the lease when needed. Call job.complete once with batch_results "
            "containing exactly one evidence-backed terminal outcome for every related alert. Cowtail "
            "will reject incomplete batches. Never use silence or job.fail as a terminal escape for "
            "unresolved members. Continue repair and renew the claim. Upstream source modifications, "
            "forks, custom artifact publication and requests to authorize them are outside automated "
            "alert repair, even if a local unit test reproduces a defect. Do not prepare an upstream "
            "patch or ask the owner to publish one. Never relabel upstream_publication as permission_required "
            "or external_prerequisite. Diagnose and test supported local configuration or runtime repair "
            "paths while preserving integrity coverage. A generic counter unit test does not establish "
            "that an upstream change is the only safe repair. Only a genuine permission, access, physical, "
            "or unavailable external prerequisite boundary permits terminal job.fail, with blocker_kind "
            "and matching blocker_code for an authorized local repair. "
            "The tool must verify the actionable Hermes iMessage handoff before releasing the claim. "
            "If continuation_needed=true, do not exit silently or claim success; continue repair/renew "
            "and reconcile ambiguous delivery. Routine retryable failures below budget remain silent. "
            "For an already deadlettered exact job use job.handoff with the same structured boundary, "
            "never reset or requeue it merely to notify. Resolved-only jobs and completion do not notify."
        )
    )


def handle_cowtail(args: dict[str, Any], client: CowtailClient | None = None) -> str:
    try:
        action = _required(args, "action")
        if action not in _ACTIONS:
            return _err(f"unsupported action: {action}")

        client = client or CowtailClient()

        if action == "status":
            return _ok(status=client.status())
        if action == "alert.get":
            return _ok(result=client.get_alert(_required(args, "alert_id")))
        if action == "alert.query_range":
            return _ok(
                result=client.query_alerts(
                    args.get("from_ms") if isinstance(args.get("from_ms"), int) else None,
                    args.get("to_ms") if isinstance(args.get("to_ms"), int) else None,
                    args.get("outcome") if isinstance(args.get("outcome"), str) else None,
                    args.get("severity") if isinstance(args.get("severity"), str) else None,
                )
            )
        if action == "alert.write":
            return _ok(result=client.write_alert(_payload(args)))
        if action == "fix.write":
            return _ok(result=client.write_fix(_payload(args)))
        if action == "job.claim":
            result = client.claim_job(
                args.get("job_id") if isinstance(args.get("job_id"), str) else None,
                _int_arg(args, "lease_seconds", 900),
            )
            return _ok(result=_compact_large_job_context(result))
        if action == "job.get":
            return _ok(result=_compact_large_job_context(client.get_job(_required(args, "job_id"))))
        if action == "job.renew":
            return _ok(
                result=client.renew_job(
                    _required(args, "job_id"),
                    _required(args, "claim_token"),
                    _int_arg(args, "lease_seconds", 900),
                )
            )
        if action == "job.complete":
            job_id = _required(args, "job_id")
            claim_token = _required(args, "claim_token")
            batch_results = _batch_results(args)
            if batch_results is None:
                return _ok(
                    result=client.complete_job(
                        job_id,
                        {
                            "claimToken": claim_token,
                            "outcome": _outcome(args),
                            "summary": _required(args, "summary"),
                            "action": _required(args, "action_taken"),
                            "rootCause": args.get("root_cause"),
                            "messaged": bool(args.get("messaged", False)),
                        },
                    )
                )
            representative = batch_results[0]
            overall_outcome = (
                _outcome(args) if args.get("outcome") is not None else representative["outcome"]
            )
            return _ok(
                result=client.complete_job(
                    job_id,
                    {
                        "claimToken": claim_token,
                        "outcome": overall_outcome,
                        "summary": args.get("summary") or representative["summary"],
                        "action": args.get("action_taken") or representative["action"],
                        "rootCause": args.get("root_cause") or representative.get("rootCause"),
                        "messaged": bool(args.get("messaged", False)),
                        "results": batch_results,
                    },
                )
            )
        if action in ("job.fail", "job.handoff"):
            return _ok(result=guarded_action(client, args))
        if action == "job.requeue":
            return _ok(result=client.requeue_job(_required(args, "job_id")))
        if action == "job.deadletters":
            return _ok(result=client.deadletters(_int_arg(args, "limit", 50)))
        if action == "webhook.render_alert_prompt":
            return _render_alert_prompt(args)

        return _err(f"unsupported action: {action}")
    except ContinuationNeeded as error:
        return json.dumps(
            {"success": False, "continuation_needed": True, "error": str(error)}, sort_keys=True
        )
    except (
        CowtailError,
        OSError,
        subprocess.TimeoutExpired,
        KeyError,
        AttributeError,
        TypeError,
        ValueError,
    ) as error:
        if args.get("action") in ("job.fail", "job.handoff"):
            return json.dumps(
                {
                    "success": False,
                    "continuation_needed": True,
                    "error": "Guard or readback unavailable. Inspect the exact job, continue repair/renew, and reconcile any private delivery receipt before retrying.",
                },
                sort_keys=True,
            )
        return _err(str(error))
