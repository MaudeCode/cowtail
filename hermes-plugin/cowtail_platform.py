"""Cowtail as a Hermes platform.

Outbound, every Hermes message becomes a Cowtail item: plain sends and cron results are fyi
notices, cron failures are failure items keyed by their incident, and approval and clarify
prompts are items the owner answers. Inbound, the adapter pulls the owner's answers from
Cowtail every few seconds, applies each to the waiting Hermes request and confirms it, so
no port opens on the Hermes host. A heartbeat tells Cowtail what Hermes is doing. With
MaudeUtils configured, the adapter also pulls the runbook runs the owner starts (see runbook).

When an incident resolves, Cowtail asks for its postmortem: the adapter claims the request and
hands its prompt to Hermes as an inbound message in chat ``cowtail:incident:<id>``. Hermes's
reply to that chat is posted as the incident's postmortem instead of becoming an item.

Env: COWTAIL_API_BASE, COWTAIL_WORKER_TOKEN and COWTAIL_WORKER_ID (shared with the tool),
COWTAIL_PLATFORM_ENABLED=true to run the platform, COWTAIL_HOME_CHANNEL for cron delivery
(default ``owner``; Cowtail has one inbox, so the value only names it).
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from typing import Any, Callable

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import BasePlatformAdapter, SendResult

from . import recovery
from .cowtail_client import CowtailClient, CowtailError, cowtail_available, cowtail_platform_enabled
from .runbook import execute_run, maudeutils_configured, runbook_catalog

logger = logging.getLogger(__name__)

PLATFORM = "cowtail"
RESPONSE_POLL_SECONDS = 3
POSTMORTEM_POLL_SECONDS = 15
INCIDENT_CHAT_PREFIX = "cowtail:incident:"
HEARTBEAT_SECONDS = 60
DEFAULT_APPROVAL_TIMEOUT = 300
DEFAULT_CLARIFY_TIMEOUT = 3600
TITLE_LIMIT = 500
BODY_LIMIT = 20_000
POSTMORTEM_LIMIT = 50_000
LIST_LIMIT = 500
ITEM_KINDS = ("alert", "failure", "approval", "question", "fyi", "done")
ITEM_URGENCIES = ("now", "today", "whenever")
OPEN_INCIDENT_STATES = ("detected", "alerted")
APPROVAL_CHOICES = {"approve": "once", "deny": "deny"}
GONE = "Hermes no longer holds this request: it expired, was already answered, or Hermes restarted."


def _now_ms() -> int:
    return int(time.time() * 1000)


def _epoch_ms(value: Any) -> int | None:
    """Hermes stores times as ISO strings; Cowtail takes epoch milliseconds."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        # Kanban and run ledgers count seconds; anything past year 2286 in seconds is already ms.
        return int(value * 1000) if value < 10_000_000_000 else int(value)
    try:
        return int(datetime.fromisoformat(str(value)).timestamp() * 1000)
    except ValueError:
        return None


def _title(text: str) -> str:
    line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    return (line or "Hermes")[:TITLE_LIMIT]


def _safe(read: Callable[[], Any], default: Any) -> Any:
    """One unreadable Hermes subsystem leaves its part of a snapshot out, never the whole."""
    try:
        return read()
    except Exception:
        logger.debug("[cowtail] snapshot read failed: %s", getattr(read, "__name__", read), exc_info=True)
        return default


# --- Hermes reads and writes --------------------------------------------------------------


def _approval_timeout() -> int:
    from tools.approval_context import _get_approval_timeout

    return _get_approval_timeout()


def _clarify_timeout() -> int:
    from tools.clarify_gateway import get_clarify_timeout

    return get_clarify_timeout()


def _approval_request_id(session_key: str, description: str) -> str | None:
    """The id Hermes gave the approval being prompted, so the answer resolves that request and
    never a later one queued in the same session. Hermes queues it before the prompt is sent."""
    from tools.approval import list_gateway_approvals

    pending = list_gateway_approvals(session_key)
    matching = [entry for entry in pending if entry.get("description") == description] or pending
    if not matching:
        return None
    return str(matching[-1].get("request_id") or "") or None


def _open_incidents() -> list[dict[str, Any]]:
    """Open cron incidents, the most recently seen first."""
    from cron.incidents import list_incidents

    return [incident for incident in list_incidents() if incident.get("state") in OPEN_INCIDENT_STATES]


def _failure_incident(job_id: Any) -> dict[str, Any] | None:
    """The incident a cron send reports. Hermes records a failure's incident before delivering
    its notice and resolves a job's incidents before delivering a success, so an open incident
    for the job means this send is the failure notice."""
    if not job_id:
        return None
    incidents = _safe(_open_incidents, [])
    return next((incident for incident in incidents if incident.get("job_id") == job_id), None)


def _connected_platforms() -> list[str]:
    from gateway.config import load_gateway_config

    return [platform.value for platform in load_gateway_config().get_connected_platforms()]


def _model() -> dict[str, str]:
    from hermes_cli.config import load_config

    model = (load_config() or {}).get("model")
    if isinstance(model, dict):
        found = {"model": model.get("default") or model.get("model"), "provider": model.get("provider")}
    else:
        found = {"model": model}
    return {key: str(value) for key, value in found.items() if value}


def _cron_jobs() -> list[dict[str, Any]]:
    from cron.jobs import list_jobs

    jobs = []
    for job in list_jobs()[:LIST_LIMIT]:
        entry: dict[str, Any] = {
            "id": str(job["id"]),
            "name": str(job.get("name") or job["id"])[:TITLE_LIMIT],
            "schedule": str(job.get("schedule_display") or job.get("schedule") or "")[:200],
        }
        for key, field in (("lastRunAt", "last_run_at"), ("nextRunAt", "next_run_at")):
            if (at := _epoch_ms(job.get(field))) is not None:
                entry[key] = at
        if job.get("last_status"):
            entry["lastStatus"] = str(job["last_status"])
        jobs.append(entry)
    return jobs


def _incident_entry(incident: dict[str, Any]) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": str(incident["id"]),
        "jobId": str(incident["job_id"]),
        "state": str(incident["state"]),
    }
    if incident.get("failure_type"):
        entry["failureType"] = str(incident["failure_type"])
    for key, field in (("firstSeenAt", "first_seen_at"), ("lastSeenAt", "last_seen_at")):
        if (at := _epoch_ms(incident.get(field))) is not None:
            entry[key] = at
    if incident.get("error"):
        entry["error"] = str(incident["error"])[:2000]
    return entry


def _kanban_counts() -> dict[str, int] | None:
    from hermes_cli import kanban_db, kanban_db_connect

    if not kanban_db.kanban_db_path().exists():
        return None
    with kanban_db_connect.connect_closing() as conn:
        by_status = kanban_db.board_stats(conn)["by_status"]
    return {"blocked": int(by_status.get("blocked", 0)), "running": int(by_status.get("running", 0))}


def collect_snapshot() -> dict[str, Any]:
    snapshot: dict[str, Any] = {
        "platforms": _safe(_connected_platforms, []),
        "cronJobs": _safe(_cron_jobs, []),
        "openIncidents": [_incident_entry(i) for i in _safe(_open_incidents, [])[:LIST_LIMIT]],
        **_safe(_model, {}),
    }
    if kanban := _safe(_kanban_counts, None):
        snapshot["kanban"] = kanban
    if maudeutils_configured() and (runbook := _safe(runbook_catalog, None)) is not None:
        snapshot["runbook"] = runbook
    return snapshot


def apply_answer(reply_to: dict[str, Any], answer: dict[str, Any]) -> str | None:
    """Hands the owner's answer to the waiting Hermes request. Returns what happened, or None
    when Hermes no longer holds that request."""
    kind, action = reply_to.get("type"), answer.get("type")
    # An approval answer resolves exactly the request it was shown for, never the session's
    # oldest one, so an answer without a request id applies to nothing.
    if kind == "approval" and action in APPROVAL_CHOICES and reply_to.get("requestId"):
        from tools.approval import resolve_gateway_approval

        choice = APPROVAL_CHOICES[action]
        session_key, request_id = str(reply_to.get("sessionKey") or ""), str(reply_to["requestId"])
        if resolve_gateway_approval(session_key, choice, request_id=request_id) > 0:
            return "Hermes approved the command once." if choice == "once" else "Hermes denied the command."
    elif kind == "clarify" and action in ("reply", "choose"):
        from tools.clarify_gateway import resolve_gateway_clarify

        text = answer.get("text") if action == "reply" else answer.get("option")
        if resolve_gateway_clarify(str(reply_to.get("clarifyId") or ""), str(text or "")):
            return "Hermes passed the answer to the waiting question."
    elif kind == "cron_incident" and action == "ack":
        from cron.incidents import ack_incident, get_incident

        incident_id = str(reply_to.get("incidentId") or "")
        # An incident already closed is acknowledged, whichever ack closed it.
        if ack_incident(incident_id) or (get_incident(incident_id) or {}).get("state") == "closed":
            return "Hermes acknowledged the cron incident; repeats of this failure stay quiet."
    return None


# --- Adapter ------------------------------------------------------------------------------


class CowtailAdapter(BasePlatformAdapter):
    MAX_MESSAGE_LENGTH = BODY_LIMIT

    def __init__(self, config: PlatformConfig):
        super().__init__(config=config, platform=Platform(PLATFORM))
        self._client = CowtailClient()
        self._recovery_cursor: str | None = None
        self._tasks: list[asyncio.Task] = []
        # Answers Hermes applied whose confirmation Cowtail has not taken yet, by response id.
        # A lease that lapses brings the answer back; it is confirmed again, never reapplied.
        # ponytail: in memory; after a restart Hermes no longer holds the request either, so a
        # replay finds nothing to resolve and reports the answer failed.
        self._applied: dict[str, str] = {}
        # Runbook runs in progress; each one streams on its own thread until its script exits.
        self._runs: set[asyncio.Task] = set()
        # The postmortem request last handed to Hermes in each incident chat, so its reply names
        # the request it answers. ponytail: in memory; after a restart a reply names none and
        # Cowtail takes it for the incident's newest request.
        self._postmortem_requests: dict[str, str] = {}

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        if not cowtail_available():
            logger.warning("[cowtail] COWTAIL_API_BASE and COWTAIL_WORKER_TOKEN are required")
            return False
        self._mark_connected()
        if recovery.route():
            self._tasks.append(asyncio.create_task(self._every(60, self.recover_stopped_jobs)))
        if cowtail_platform_enabled():
            self._tasks.extend([
                asyncio.create_task(self._every(RESPONSE_POLL_SECONDS, self.apply_responses)),
                asyncio.create_task(self._every(HEARTBEAT_SECONDS, self.send_heartbeat)),
                asyncio.create_task(self._every(POSTMORTEM_POLL_SECONDS, self.deliver_postmortem_requests)),
            ])
            if maudeutils_configured():
                self._tasks.append(asyncio.create_task(self._every(RESPONSE_POLL_SECONDS, self.start_runbook_runs)))
        return True

    async def disconnect(self) -> None:
        self._mark_disconnected()
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []

    async def _every(self, seconds: int, step: Callable[[], Any]) -> None:
        while self._running:
            try:
                await step()
            except Exception:
                # A loop that died here would silently stop answers or heartbeats.
                logger.warning("[cowtail] %s failed", step.__name__, exc_info=True)
            await asyncio.sleep(seconds)

    # -- Answers in ----------------------------------------------------------------------

    async def apply_responses(self) -> None:
        """Applies every answer waiting in Cowtail, oldest first."""
        while True:
            response = (await asyncio.to_thread(self._client.claim_response)).get("response")
            if not response:
                return
            response_id = response["id"]
            outcome = self._applied.get(response_id)
            if outcome is None:
                outcome = await asyncio.to_thread(
                    apply_answer, response.get("replyTo") or {}, response.get("answer") or {}
                )
            if outcome:
                self._applied[response_id] = outcome
                await asyncio.to_thread(
                    self._client.complete_response, response_id, response["claimToken"], outcome
                )
                del self._applied[response_id]
            else:
                await asyncio.to_thread(
                    self._client.fail_response, response_id, response["claimToken"], GONE
                )

    async def start_runbook_runs(self) -> None:
        """Starts every runbook run waiting in Cowtail; each runs until its script exits."""
        while True:
            run = (await asyncio.to_thread(self._client.claim_runbook_run)).get("run")
            if not run:
                return
            task = asyncio.create_task(self._execute_run(run))
            self._runs.add(task)
            task.add_done_callback(self._runs.discard)

    async def _execute_run(self, run: dict[str, Any]) -> None:
        try:
            await asyncio.to_thread(execute_run, self._client, run)
        except Exception:
            # Cowtail leases the run again once this claim's lease runs out.
            logger.warning("[cowtail] runbook run %s failed", run.get("id"), exc_info=True)

    async def deliver_postmortem_requests(self) -> None:
        """Hands each postmortem request waiting in Cowtail to Hermes as an inbound message in
        the incident's chat, then confirms it. A request Hermes did not take is not confirmed,
        and Cowtail leases it again once this claim's lease runs out."""
        from gateway.platforms.base import MessageEvent, MessageType

        while True:
            request = (await asyncio.to_thread(self._client.claim_postmortem_request)).get("request")
            if not request:
                return
            source = self.build_source(
                chat_id=request["chatId"], chat_name="Cowtail incident", chat_type="dm",
                user_id="cowtail", user_name="Cowtail",
            )
            self._postmortem_requests[request["chatId"]] = request["id"]
            await self.handle_message(MessageEvent(
                text=request["prompt"], message_type=MessageType.TEXT, source=source,
                message_id=f"cowtail-postmortem-{request['id']}",
            ))
            await asyncio.to_thread(self._client.postmortem_delivered, request["id"], request["claimToken"])

    def toolsets_for_source(self, source) -> list[str] | None:
        """An incident's chat runs with no tools: its prompt carries text alert sources and other
        producers wrote, so nothing in it may steer the agent into acting."""
        if str(getattr(source, "chat_id", "") or "").startswith(INCIDENT_CHAT_PREFIX):
            return []
        return None

    async def recover_stopped_jobs(self) -> None:
        self._recovery_cursor = await asyncio.to_thread(recovery.sweep, self._client, self._recovery_cursor)

    async def send_heartbeat(self) -> None:
        snapshot = await asyncio.to_thread(collect_snapshot)
        await asyncio.to_thread(self._client.heartbeat, snapshot)

    # -- Items out -----------------------------------------------------------------------

    async def _post_item(self, body: str, title: str, **fields: Any) -> SendResult:
        if not cowtail_platform_enabled():
            return SendResult(success=False, error="Cowtail is connected for investigation recovery only")
        payload = {"source": "hermes", "title": _title(title), "body": body[:BODY_LIMIT], **fields}
        try:
            created = await asyncio.to_thread(self._client.create_item, payload)
        except CowtailError as error:
            return SendResult(success=False, error=str(error))
        return SendResult(success=True, message_id=created.get("id"))

    async def send(
        self, chat_id: str, content: str, reply_to: str | None = None, metadata: dict[str, Any] | None = None,
    ) -> SendResult:
        if not cowtail_platform_enabled():
            return SendResult(success=False, error="Cowtail is connected for investigation recovery only")
        metadata = metadata or {}
        if chat_id.startswith(INCIDENT_CHAT_PREFIX):
            # Hermes's reply to a postmortem request is the incident's postmortem, not an item.
            incident_id = chat_id[len(INCIDENT_CHAT_PREFIX):]
            try:
                await asyncio.to_thread(
                    self._client.post_postmortem,
                    incident_id,
                    content[:POSTMORTEM_LIMIT],
                    self._postmortem_requests.get(chat_id),
                )
            except CowtailError as error:
                return SendResult(success=False, error=str(error))
            return SendResult(success=True, message_id=f"postmortem:{incident_id}")
        incident = await asyncio.to_thread(_failure_incident, metadata.get("job_id"))
        if incident:
            return await self._post_item(
                content,
                content,
                kind="failure",
                urgency="today",
                dedupeKey=f"cron-incident:{incident['id']}",
                actions=[{"type": "ack"}],
                replyTo={"type": "cron_incident", "incidentId": str(incident["id"])},
            )
        kind = metadata.get("kind") if metadata.get("kind") in ITEM_KINDS else "fyi"
        urgency = metadata.get("urgency") if metadata.get("urgency") in ITEM_URGENCIES else "today"
        return await self._post_item(content, content, kind=kind, urgency=urgency)

    async def _send_exec_approval_prompt(self, prompt) -> SendResult:
        # The owner approves what the item shows, so an approval Cowtail cannot show whole, or
        # cannot bind to its Hermes request, is refused and Hermes falls back to its text prompt.
        body = f"{prompt.description}\n\n{prompt.command}"
        if len(body) > BODY_LIMIT:
            return SendResult(success=False, error="Approval prompt is too long to show whole in Cowtail")
        request_id = await asyncio.to_thread(
            _safe, lambda: _approval_request_id(prompt.session_key, prompt.description), None
        )
        if not request_id:
            return SendResult(success=False, error="Hermes has no pending request for this approval")
        timeout = _safe(_approval_timeout, DEFAULT_APPROVAL_TIMEOUT)
        return await self._post_item(
            body,
            f"Approve: {prompt.description}",
            kind="approval",
            urgency="now",
            actions=[{"type": "approve"}, {"type": "deny"}],
            replyTo={"type": "approval", "sessionKey": prompt.session_key, "requestId": request_id},
            expiresAt=_now_ms() + int(timeout) * 1000,
        )

    async def send_clarify(
        self, chat_id: str, question: str, choices: list | None, clarify_id: str,
        session_key: str, metadata: dict[str, Any] | None = None,
    ) -> SendResult:
        actions: list[dict[str, Any]] = [{"type": "reply"}]
        if choices:
            actions.append({"type": "choose", "options": [str(choice) for choice in choices]})
        fields: dict[str, Any] = {
            "kind": "question",
            "urgency": "now",
            "actions": actions,
            "replyTo": {"type": "clarify", "clarifyId": clarify_id},
        }
        # A clarify timeout of zero or less waits forever.
        timeout = int(_safe(_clarify_timeout, DEFAULT_CLARIFY_TIMEOUT))
        if timeout > 0:
            fields["expiresAt"] = _now_ms() + timeout * 1000
        return await self._post_item(question, question, **fields)

    async def get_chat_info(self, chat_id: str) -> dict[str, Any]:
        return {"name": "Cowtail", "type": "dm", "chat_id": chat_id}


def _env_enablement() -> dict | None:
    """Seeds the cron home channel so ``deliver: cowtail`` resolves once the platform is on."""
    if not cowtail_platform_enabled():
        return {"enabled": True} if recovery.route() and cowtail_available() else None
    from gateway.platforms._shared import seed_extra_from_env

    return seed_extra_from_env((), home_env="COWTAIL_HOME_CHANNEL", home_default="owner")


def register_platform(ctx) -> None:
    ctx.register_platform(
        name=PLATFORM,
        label="Cowtail",
        adapter_factory=CowtailAdapter,
        check_fn=cowtail_available,
        validate_config=lambda config: cowtail_available(),
        is_connected=lambda config: cowtail_available() and (cowtail_platform_enabled() or bool(recovery.route())),
        required_env=["COWTAIL_API_BASE", "COWTAIL_WORKER_TOKEN"],
        env_enablement_fn=_env_enablement,
        cron_deliver_env_var="COWTAIL_HOME_CHANNEL",
        max_message_length=BODY_LIMIT,
        emoji="🐄",
        pii_safe=True,
        # Inbound messages are only the postmortem requests the adapter claims from Cowtail with
        # its worker token, so there is no human sender to allowlist.
        trusted_inbound=True,
        allow_update_command=False,
        platform_hint=(
            "You are delivering to Cowtail, the owner's inbox. Each message becomes one item "
            "the owner reads later; the owner answers approvals and questions from the item."
        ),
    )
