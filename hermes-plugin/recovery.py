"""Bridge terminal Hermes webhook receipts to Cowtail's durable retry broker.

Only this adapter attests execution state. Neither leases, output text, an absent
process, nor a missing runtime row constitute a terminal receipt.
"""
from __future__ import annotations

import os
from threading import Lock
from typing import Any


def route() -> str:
    return os.environ.get("COWTAIL_RECOVERY_WEBHOOK_ROUTE", "").strip()


_preflight: dict[str, tuple[dict[str, Any], str]] = {}
_claimed: set[str] = set()
_lock = Lock()
_read_actions = {
    "cowtail": {"alert.get", "alert.query_range", "job.get", "job.history", "job.renew", "job.reconcile", "job.claim"},
    "cluster": {"k8s.get", "k8s.describe", "k8s.logs", "k8s.events", "k8s.owner_tree", "k8s.pod_health",
                "prometheus.alerts", "prometheus.query", "prometheus.targets", "flux.status", "flux.get",
                "repo.status", "repo.log", "repo.gh_pr_view", "repo.gh_pr_list"},
}
_read_tools = {"skill_view", "skills_list", "read_file", "search_files", "viking_search", "viking_read",
               "session_search", "mcp__kanvil__get_ticket", "mcp__kanvil__search_tickets"}


def require_reconciliation(execution, job_id) -> None:
    if not execution or not job_id:
        raise RuntimeError("A recovered job requires a bound execution")
    with _lock:
        _preflight[execution["sessionId"]] = (execution, job_id)


def owns_preflight(execution, job_id) -> bool:
    with _lock:
        return bool(execution and _preflight.get(execution["sessionId"]) == (execution, job_id))


def finish_reconciliation(execution, job_id) -> None:
    with _lock:
        if execution and _preflight.get(execution["sessionId"]) == (execution, job_id):
            _preflight.pop(execution["sessionId"])
            _claimed.add(execution["sessionId"])


def allow_claimed_session(execution) -> None:
    if execution:
        with _lock:
            if execution["sessionId"] not in _preflight:
                _claimed.add(execution["sessionId"])


def clear_preflight(session_id: str = "", **_: Any) -> None:
    with _lock:
        _preflight.pop(session_id, None)
        _claimed.discard(session_id)


def is_repair_webhook() -> bool:
    name = route()
    if not name:
        return False
    from gateway.session_context import get_session_env
    return (get_session_env("HERMES_SESSION_PLATFORM") == "webhook"
            and get_session_env("HERMES_SESSION_USER_ID") == f"webhook:{name}")


def guard_reconciliation(session_id: str = "", tool_name: str = "", args=None, **_: Any):
    with _lock:
        pending = session_id in _preflight
        claimed = session_id in _claimed
    # The claim and an external write could be proposed in the same tool batch.
    if not (pending or (not claimed and is_repair_webhook())) or tool_name in _read_tools:
        return None
    action = (args or {}).get("action")
    if isinstance(action, str) and action in _read_actions.get(tool_name, ()):
        return None
    return {"action": "block", "message": (
        "Claim the exact Cowtail job first. A replacement must also reconcile prior effects and "
        "resource ownership with read-only tools and record findings using cowtail job.reconcile."
    )}


def current_execution() -> dict[str, Any] | None:
    """Bind the claim to the caller's running admission, not a model-supplied ID."""
    if not is_repair_webhook():
        return None
    from gateway.session_context import get_session_env
    from hermes_state import SessionDB
    from hermes_state_runtime import list_session_admissions

    session = get_session_env("HERMES_SESSION_ID")
    request = get_session_env("HERMES_SESSION_MESSAGE_ID")
    if not session or not request:
        return None
    with SessionDB(read_only=True) as db:
        receipts = list_session_admissions(db, session_id=session)
        matches = [r for r in receipts if r["status"] == "started" and r["request_id"] == request]
        if len(matches) != 1 or type(matches[0]["generation"]) is not int or matches[0]["generation"] < 1:
            return None
        entry = matches[0]
        return {"deliveryId": request, "admissionId": entry["admission_id"], "sessionId": session, "generation": entry["generation"]}


def stopped_outcome(receipt, session, execution, route_name) -> str | None:
    if not receipt or not session or session.get("end_reason") != "webhook_complete":
        return None
    if (receipt.get("admission_id") != execution["admissionId"]
            or receipt.get("request_id") != execution["deliveryId"]
            or receipt.get("target_session_id") != execution["sessionId"]
            or receipt.get("generation") != execution["generation"]
            or receipt.get("status") != "terminal"):
        return None
    source = receipt.get("payload", {}).get("native_text_v1", {}).get("source", {})
    if source.get("platform") != "webhook" or source.get("user_id") != f"webhook:{route_name}":
        return None
    # No automatic continuation after an interrupt, rejected turn, or ambiguous host loss.
    outcome = receipt.get("outcome")
    return outcome if outcome in ("completed", "failed") else None


def has_live_dependents(receipt) -> bool:
    from tools.approval import list_gateway_approvals
    from tools.clarify_gateway import has_pending
    from tools.process_registry import process_registry

    key = receipt.get("payload", {}).get("native_text_v1", {}).get("route")
    if not key:
        return True  # Incompatible evidence, not permission to take over.
    return bool(list_gateway_approvals(key) or has_pending(key) or any(
        entry.get("status") != "exited" for entry in process_registry.list_sessions(session_key=key)
    ))


def sweep(client, cursor: str | None) -> str | None:
    """One bounded page per interval. On restart, scanning safely begins again."""
    from hermes_state import SessionDB
    from hermes_state_runtime import get_session_admission

    name = route()
    if not name:
        return None
    page = client.expired_executions(cursor)
    with SessionDB(read_only=True) as db:
        for job in page["jobs"]:
            execution = job["execution"]
            receipt = get_session_admission(db, admission_id=execution["admissionId"])
            session = db.get_session(execution["sessionId"])
            outcome = stopped_outcome(receipt, session, execution, name)
            if outcome is not None and not has_live_dependents(receipt):
                client.report_stopped_execution(job["jobId"], execution, outcome)
    return page["cursor"]
