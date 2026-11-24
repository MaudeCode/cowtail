"""Fail-closed terminal guard and private, serialized delivery receipts.

No backend replacement: Cowtail remains the owner of claims and incident history.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import subprocess
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import NoReturn

from .cowtail_client import CowtailError

BLOCKER_KINDS = ["permission", "access", "physical", "unavailable_external_prerequisite"]
# Semantic codes, not free text. These also define stable root-cause/decision keys.
BOUNDARIES = {
    "permission_required": (
        "permission",
        "Authorize the required privileged change, then resume and verify recovery.",
    ),
    "access_required": (
        "access",
        "Restore the required account or system access, then resume and verify recovery.",
    ),
    "physical_intervention": (
        "physical",
        "Perform the required on-site hardware intervention, then resume and verify recovery.",
    ),
    "external_prerequisite": (
        "unavailable_external_prerequisite",
        "Restore the unavailable external prerequisite, then resume and verify recovery.",
    ),
}


class ContinuationNeeded(ValueError):
    """The worker must keep investigating or reconcile delivery; not release its claim."""


def _stop(message) -> NoReturn:
    raise ContinuationNeeded(
        message + " Continue repair and renew the claim as needed; do not silently exit."
    )


def context(client, job_id, token=None, deadletter=False):
    ctx = client.get_job(job_id)
    job = ctx.get("job")
    if not isinstance(job, dict) or job.get("_id") != job_id:
        _stop("Exact job readback is missing.")
    if deadletter:
        if job.get("status") != "deadletter":
            _stop("job.handoff requires an already deadlettered exact job.")
    elif (
        job.get("status") != "claimed"
        or not token
        or job.get("claimToken") != token
        or job.get("claimedBy") != client.worker_id
        or not isinstance(job.get("leaseUntil"), (int, float))
        or job["leaseUntil"] <= time.time() * 1000
    ):
        _stop("Claim ownership or nonexpired lease validation failed.")
    event = ctx.get("sourceEvent")
    members = ctx.get("relatedAlerts")
    if (
        not isinstance(event, dict)
        or event.get("id") != job.get("sourceEventId")
        or not isinstance(members, list)
        or not members
        or any(not isinstance(a, dict) or not a.get("id") for a in members)
        or len({a["id"] for a in members}) != len(members)
        or job.get("alertId") not in {a["id"] for a in members}
    ):
        _stop("Immutable source-event members are unavailable or incomplete.")
    # relatedAlerts is the API's frozen investigationAlertIds projection, not a
    # mutable sourceEventId query performed by this plugin.
    if any(a.get("status") not in ("firing", "resolved") for a in members):
        _stop("Cannot determine current member resolution.")
    return ctx


def _boundary(args):
    kind, code = args.get("blocker_kind"), args.get("blocker_code")
    if code not in BOUNDARIES or BOUNDARIES[code][0] != kind:
        _stop(
            "Terminal unresolved failure requires a genuine structured blocker_kind and matching blocker_code. Ordinary repair failure is not an authority boundary."
        )
    return kind, code


def _safe(value):
    # Resource identifiers only. No arbitrary summary, log, URLs, tokens or errors.
    return (
        value
        if isinstance(value, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,79}", value)
        else None
    )


def delivery_spec(ctx, args):
    kind, code = _boundary(args)
    affected = [a for a in ctx["relatedAlerts"] if a["status"] != "resolved"]
    lifecycle = sorted(
        (a["id"], str(a.get("startsAt") or a.get("firedAt") or ctx["job"]["sourceEventId"]))
        for a in ctx["relatedAlerts"]
    )
    identity = {"lifecycle": lifecycle, "kind": kind, "decision": code}
    key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    names = set()
    for alert in affected:
        labels = alert.get("labels") or {}
        for field in ("alertname", "namespace", "policy", "job_name"):
            value = _safe(alert.get(field) or labels.get(field))
            if value:
                names.add(f"{field}={value}")
    # Keep one text chunk; native job ID is the durable route to full evidence.
    name_text = ", ".join(sorted(names))
    if len(name_text) > 600:
        name_text = (
            "Multiple affected resources; inspect the native job for the complete frozen batch."
        )
    job_id = ctx["job"]["_id"]
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", job_id):
        _stop("Native job identifier is unsafe for delivery.")
    body = (
        "Alert repair needs your decision. Execution is blocked.\n"
        f"Affected: {name_text or 'resources in the frozen investigation batch'}.\n"
        f"Required action: {BOUNDARIES[code][1]}\n"
        "The incident is unresolved. Reply here to address this prerequisite; repair and alert-clearance verification must then resume.\n"
        f"Investigation reference: {job_id}."
    )
    return key, body


def receipt_valid(value):
    return (
        isinstance(value, dict)
        and value.get("success") is True
        and not any(value.get(k) for k in ("error", "skipped", "partial_success", "warning"))
        and isinstance(value.get("message_id"), (str, int))
        and not isinstance(value.get("message_id"), bool)
        and bool(str(value["message_id"]).strip())
    )


def _provider_time(value):
    try:
        return datetime.fromisoformat(value).timestamp()
    except (AttributeError, TypeError, ValueError):
        return 0


def provider_receipt(body, chat_id, started):
    """Read native outgoing history; stock imsg standalone text send drops its ID.

    Never interpret CLI success alone as delivery. The read-only provider query
    must yield exactly one outgoing message with this exact safe body and window.
    """
    result = subprocess.run(
        ["imsg", "history", "--chat-id", chat_id, "--start", started, "--limit", "100", "--json"],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    if result.returncode != 0:
        _stop("Provider readback failed; claim retained.")
    records = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    matches = [
        row
        for row in records
        if isinstance(row, dict)
        and row.get("is_from_me") is True
        and str(row.get("chat_id")) == chat_id
        and row.get("text") == body
        and row.get("guid")
        and _provider_time(row.get("created_at")) >= _provider_time(started)
    ]
    if len(matches) != 1:
        _stop(
            "No unambiguous native provider receipt; claim retained. Reconcile delivery before retrying."
        )
    return {"success": True, "message_id": matches[0]["guid"]}


def delivery_target():
    result = subprocess.run(
        ["hermes", "send", "--list", "imsg", "--json"],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        _stop("Configured Hermes iMessage target unavailable.")
    targets = json.loads(result.stdout).get("platforms", {}).get("imsg", [])
    if (
        len(targets) != 1
        or not re.fullmatch(r"[0-9]+", str(targets[0].get("id", "")))
        or targets[0].get("thread_id")
    ):
        _stop("Exactly one unthreaded configured Hermes iMessage home target is required.")
    return str(targets[0]["id"])


def send(body, chat_id, started):
    result = subprocess.run(
        ["hermes", "send", "--to", "imsg", "--json", "--file", "-"],
        input=body,
        text=True,
        capture_output=True,
        timeout=60,
        check=False,
    )
    if result.returncode != 0:
        _stop(
            "Hermes delivery failed; claim retained. Reconcile the private receipt before retrying."
        )
    try:
        receipt = json.loads(result.stdout)
    except (ValueError, TypeError):
        _stop("Hermes returned an ambiguous delivery receipt; claim retained.")
    if (
        not isinstance(receipt, dict)
        or receipt.get("success") is not True
        or any(receipt.get(k) for k in ("error", "skipped", "partial_success", "warning"))
    ):
        _stop("Hermes did not acknowledge delivery; claim retained.")
    native = provider_receipt(body, chat_id, started)
    if receipt_valid(receipt) and str(receipt["message_id"]) != str(native["message_id"]):
        _stop("Hermes and native provider message IDs disagree; claim retained.")
    return native


@contextmanager
def delivery_lock(key):
    home = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes")))
    directory = home / "cowtail-delivery-receipts"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    path = directory / f"{key}.json"
    fd = os.open(directory / f"{key}.lock", os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(fd, "a") as lock:
        deadline = time.monotonic() + 5
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    _stop("Another delivery attempt is in progress; claim retained.")
                time.sleep(0.05)
        yield path


def _store(path, value):
    temporary = path.with_suffix(".pending")
    fd = os.open(temporary, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(value, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def deliver(path, body):
    if path.exists():
        saved = json.loads(path.read_text())
        if receipt_valid(saved.get("receipt")):
            return saved["receipt"]
        # Reconcile an interrupted/ambiguous send by read-only native history.
        # Never automatically resend an unknown attempt.
        receipt = provider_receipt(saved["body"], saved["chat_id"], saved["started"])
    else:
        chat_id = delivery_target()
        started = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        _store(
            path,
            {"state": "delivery_unknown", "chat_id": chat_id, "started": started, "body": body},
        )
        try:
            receipt = send(body, chat_id, started)
        except (OSError, subprocess.TimeoutExpired):
            _stop("Hermes send failed or timed out; delivery ambiguous, claim retained.")
    _store(path, {"receipt": receipt})
    saved = json.loads(path.read_text())
    if not receipt_valid(saved.get("receipt")):
        _stop("Private provider receipt readback failed; claim retained.")
    return saved["receipt"]


def _fail_and_verify(client, ctx, payload):
    job_id = ctx["job"]["_id"]
    old_history = ctx["job"].get("errorHistory")
    if not isinstance(old_history, list):
        _stop("Job error history is missing; cannot verify a lossless failure.")
    try:
        client.fail_job(job_id, payload)
    except (CowtailError, OSError, ValueError):
        # A lost response may follow a committed mutation. Always read back.
        pass
    after = client.get_job(job_id).get("job", {})
    expected = (
        "queued"
        if payload["retryable"] and ctx["job"]["attempts"] < ctx["job"]["maxAttempts"]
        else "deadletter"
    )
    history = after.get("errorHistory", [])
    last = history[-1] if history else {}
    if (
        after.get("_id") != job_id
        or after.get("status") != expected
        or after.get("attempts") != ctx["job"]["attempts"]
        or after.get("sourceEventId") != ctx["job"]["sourceEventId"]
        or after.get("claimToken")
        or after.get("leaseUntil")
        or history[:-1] != old_history
        or any(last.get(k) != payload[k] for k in ("phase", "error", "retryable"))
    ):
        _stop(
            "Backend failure readback not verified, including preserved history. Keep the delivery receipt and inspect/renew the current claim; do not resend."
        )
    return {"status": expected, "readback_verified": True, "history_preserved": True}


def guarded_action(client, args):
    # Reject legacy callers before transport or job mutation. A diagnosis does
    # not authorize an unsolicited upstream-change approval request.
    upstream_phases = {"blocked_upstream_publication", "blocked_upstream_artifact"}
    if args.get("blocker_code") == "upstream_publication" or args.get("phase") in upstream_phases:
        _stop(
            "Upstream edits, forks and artifact-publication approval requests are outside automated alert repair. "
            "No message sent or job mutation attempted. Do not relabel this as another blocker. "
            "Investigate supported local configuration and runtime repair paths instead."
        )
    job_id = args.get("job_id")
    if not isinstance(job_id, str) or not job_id:
        _stop("job_id is required.")
    deadletter = args["action"] == "job.handoff"
    ctx = context(client, job_id, args.get("claim_token"), deadletter)
    if deadletter and any(
        isinstance(item, dict) and item.get("phase") in upstream_phases
        for item in ctx["job"].get("errorHistory", [])[-1:]
    ):
        _stop("An upstream-publication deadletter cannot be relabeled to request a different approval.")
    retryable = args.get("retryable", True)
    if not isinstance(retryable, bool):
        _stop("retryable must be a boolean.")
    job = ctx["job"]
    if not all(type(job.get(k)) is int and job[k] >= 0 for k in ("attempts", "maxAttempts")):
        _stop("Attempt budget unavailable.")
    terminal = deadletter or not retryable or job["attempts"] >= job["maxAttempts"]
    unresolved = any(a["status"] != "resolved" for a in ctx["relatedAlerts"])
    payload = {
        "claimToken": args.get("claim_token"),
        "phase": args.get("phase") or "investigation",
        "error": args.get("error"),
        "retryable": retryable,
    }
    if not deadletter and (not isinstance(payload["error"], str) or not payload["error"].strip()):
        _stop("error is required.")
    if not terminal or not unresolved:
        return (
            {"status": "resolved_only", "notified": False}
            if deadletter
            else _fail_and_verify(client, ctx, payload)
        )
    key, body = delivery_spec(ctx, args)
    with delivery_lock(key) as path:
        # Lease/ownership may have changed while waiting for another sender.
        ctx = context(client, job_id, args.get("claim_token"), deadletter)
        if delivery_spec(ctx, args)[0] != key:
            _stop("Affected lifecycle changed; inspect the job again.")
        receipt = deliver(path, body)
        ctx = context(client, job_id, args.get("claim_token"), deadletter)
        if delivery_spec(ctx, args)[0] != key:
            _stop(
                "Affected lifecycle changed after delivery; inspect the job before releasing its claim."
            )
        result = (
            {"status": "deadletter", "readback_verified": True}
            if deadletter
            else _fail_and_verify(client, ctx, payload)
        )
        return {**result, "handoff_verified": True, "receipt": receipt}
