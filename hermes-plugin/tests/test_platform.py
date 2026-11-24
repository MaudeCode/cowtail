"""The cowtail platform against fake Hermes modules and a fake Cowtail API: no gateway runs,
no request leaves the process."""

from __future__ import annotations

import asyncio
import contextlib
import importlib
import os
import sys
import types
import unittest
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import patch

import test_handlers  # noqa: F401  (loads the plugin package as hermes_plugins.cowtail)

CowtailError = importlib.import_module("hermes_plugins.cowtail.cowtail_client").CowtailError
NOW_SECONDS = 1_790_000_000


class FakeHermes:
    """The Hermes state the platform reads and the resolvers it calls."""

    def __init__(self):
        self.calls: list[tuple] = []
        self.approvals: dict[str, list[dict]] = {}
        self.pending_clarify: set[str] = set()
        self.incidents: list[dict] = []
        self.jobs: list[dict] = []
        self.approval_timeout = 300
        self.clarify_timeout = 3600
        self.kanban = {"blocked": 2, "running": 1, "done": 7}
        # The messages the gateway received from the adapter, as Hermes's message handler sees them.
        self.inbound: list = []

    def list_gateway_approvals(self, session_key):
        return [dict(entry) for entry in self.approvals.get(session_key, [])]

    def resolve_gateway_approval(self, session_key, choice, resolve_all=False, reason=None, request_id=None):
        """Like Hermes: the entry with ``request_id``, else the oldest in the session."""
        self.calls.append(("resolve_gateway_approval", session_key, choice, request_id))
        queue = self.approvals.get(session_key, [])
        targets = [e for e in queue if e["request_id"] == request_id] if request_id else queue[:1]
        for entry in targets:
            queue.remove(entry)
        return len(targets)

    def resolve_gateway_clarify(self, clarify_id, response):
        self.calls.append(("resolve_gateway_clarify", clarify_id, response))
        if clarify_id not in self.pending_clarify:
            return False
        self.pending_clarify.discard(clarify_id)
        return True

    def get_incident(self, incident_id):
        return next((dict(i) for i in self.incidents if i["id"] == incident_id), None)

    def ack_incident(self, incident_id):
        self.calls.append(("ack_incident", incident_id))
        for incident in self.incidents:
            if incident["id"] == incident_id and incident["state"] != "closed":
                incident["state"] = "closed"
                return True
        return False

    def modules(self) -> dict[str, types.ModuleType]:
        hermes = self

        def module(name, **attrs):
            mod = types.ModuleType(name)
            mod.__dict__.update(attrs)
            return mod

        @dataclass
        class SendResult:
            success: bool
            message_id: str | None = None
            error: str | None = None

        class MessageType:
            TEXT = "text"

        @dataclass
        class MessageEvent:
            text: str
            message_type: str = MessageType.TEXT
            source: object = None
            message_id: str | None = None

        class BasePlatformAdapter:
            def __init__(self, config, platform):
                self.config, self.platform, self._running = config, platform, False

            def build_source(self, chat_id, chat_name=None, chat_type="dm", user_id=None, user_name=None):
                return SimpleNamespace(
                    platform=self.platform, chat_id=chat_id, chat_name=chat_name, chat_type=chat_type,
                    user_id=user_id, user_name=user_name,
                )

            async def handle_message(self, event):
                hermes.inbound.append(event)

            def _mark_connected(self):
                self._running = True

            def _mark_disconnected(self):
                self._running = False

        @contextlib.contextmanager
        def connect_closing(board=None):
            yield "kanban-conn"

        gateway_config = SimpleNamespace(
            get_connected_platforms=lambda: [SimpleNamespace(value="cowtail"), SimpleNamespace(value="telegram")]
        )
        return {
            "gateway": module("gateway"),
            "gateway.config": module(
                "gateway.config", Platform=str, PlatformConfig=object, load_gateway_config=lambda: gateway_config
            ),
            "gateway.platforms": module("gateway.platforms"),
            "gateway.platforms.base": module(
                "gateway.platforms.base",
                BasePlatformAdapter=BasePlatformAdapter,
                SendResult=SendResult,
                MessageEvent=MessageEvent,
                MessageType=MessageType,
            ),
            "tools": module("tools"),
            "tools.approval": module(
                "tools.approval",
                resolve_gateway_approval=self.resolve_gateway_approval,
                list_gateway_approvals=self.list_gateway_approvals,
            ),
            "tools.approval_context": module(
                "tools.approval_context", _get_approval_timeout=lambda: hermes.approval_timeout
            ),
            "tools.clarify_gateway": module(
                "tools.clarify_gateway",
                resolve_gateway_clarify=self.resolve_gateway_clarify,
                get_clarify_timeout=lambda: hermes.clarify_timeout,
            ),
            "cron": module("cron"),
            "cron.incidents": module(
                "cron.incidents",
                list_incidents=lambda: list(hermes.incidents),
                ack_incident=self.ack_incident,
                get_incident=self.get_incident,
            ),
            "cron.jobs": module("cron.jobs", list_jobs=lambda: list(hermes.jobs)),
            "hermes_cli": module("hermes_cli"),
            "hermes_cli.config": module(
                "hermes_cli.config",
                load_config=lambda: {"model": {"default": "claude-opus-5-5", "provider": "anthropic"}},
            ),
            "hermes_cli.kanban_db": module(
                "hermes_cli.kanban_db",
                kanban_db_path=lambda board=None: SimpleNamespace(exists=lambda: True),
                board_stats=lambda conn: {"by_status": dict(hermes.kanban)},
            ),
            "hermes_cli.kanban_db_connect": module("hermes_cli.kanban_db_connect", connect_closing=connect_closing),
        }


class FakeCowtail:
    """Answers the Cowtail routes the platform calls and refuses any other."""

    def __init__(self):
        self.requests: list[tuple[str, str, dict | None]] = []
        self.waiting: list[dict] = []
        self.refused_completions = 0
        self.runs: list[dict] = []
        self.refuse_runbook_output = False
        self.postmortem_requests: list[dict] = []

    def __call__(self, method, path, body=None, query=None):
        self.requests.append((method, path, body))
        if (method, path) == ("POST", "/api/items"):
            return {"ok": True, "id": f"item-{len(self.posted('/api/items'))}", "created": True}
        if (method, path) == ("POST", "/api/hermes/responses/claim"):
            return {"ok": True, "response": self.waiting.pop(0)} if self.waiting else {"ok": True}
        if method == "POST" and path.startswith("/api/hermes/responses/") and path.endswith(("/complete", "/fail")):
            if path.endswith("/complete") and self.refused_completions:
                self.refused_completions -= 1
                raise CowtailError("Cowtail HTTP 503: unavailable")
            return {"ok": True}
        if (method, path) == ("POST", "/api/hermes/heartbeat"):
            return {"ok": True}
        if (method, path) == ("POST", "/api/hermes/runbook-runs/claim"):
            return {"ok": True, "run": self.runs.pop(0)} if self.runs else {"ok": True}
        if method == "POST" and path.startswith("/api/hermes/runbook-runs/"):
            if self.refuse_runbook_output and path.endswith("/output"):
                raise CowtailError("Cowtail HTTP 409: Run is not claimed with this token")
            return {"ok": True}
        if (method, path) == ("POST", "/api/hermes/postmortem-requests/claim"):
            if self.postmortem_requests:
                return {"ok": True, "request": self.postmortem_requests.pop(0)}
            return {"ok": True}
        if method == "POST" and path.startswith("/api/hermes/postmortem-requests/") and path.endswith("/delivered"):
            return {"ok": True}
        if method == "POST" and path.startswith("/api/hermes/incidents/") and path.endswith("/postmortem"):
            return {"ok": True}
        raise AssertionError(f"unexpected Cowtail request {method} {path}")

    def posted(self, path: str) -> list[dict | None]:
        return [body for method, p, body in self.requests if p == path]

    def finished(self) -> list[tuple[str, dict | None]]:
        return [(p, body) for _, p, body in self.requests if p.endswith(("/complete", "/fail"))]


class PlatformTest(unittest.TestCase):
    def setUp(self):
        self.hermes = FakeHermes()
        self.cowtail = FakeCowtail()
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.dict(sys.modules, self.hermes.modules()))
        stack.enter_context(
            patch.dict(
                os.environ,
                {
                    "COWTAIL_API_BASE": "https://cowtail.example.test",
                    "COWTAIL_WORKER_TOKEN": "worker-token",
                    "COWTAIL_PLATFORM_ENABLED": "true",
                },
            )
        )
        sys.modules.pop("hermes_plugins.cowtail.cowtail_platform", None)
        self.addCleanup(sys.modules.pop, "hermes_plugins.cowtail.cowtail_platform", None)
        self.platform = importlib.import_module("hermes_plugins.cowtail.cowtail_platform")
        stack.enter_context(patch.object(self.platform.CowtailClient, "_request", self.cowtail))
        stack.enter_context(patch.object(self.platform.time, "time", return_value=NOW_SECONDS))
        self.adapter = self.platform.CowtailAdapter(SimpleNamespace(extra={}))

    def run_async(self, coroutine):
        return asyncio.run(coroutine)

    def last_item(self) -> dict:
        return self.cowtail.posted("/api/items")[-1]


class RegistrationTest(PlatformTest):
    def test_register_adds_the_platform_beside_the_tool(self):
        ctx = SimpleNamespace(tools=[], platforms=[])
        ctx.register_tool = lambda **kwargs: ctx.tools.append(kwargs["name"])
        ctx.register_platform = lambda **kwargs: ctx.platforms.append(kwargs)

        sys.modules["hermes_plugins.cowtail"].register(ctx)

        self.assertEqual(ctx.tools, ["cowtail"])
        [entry] = ctx.platforms
        self.assertEqual(entry["name"], "cowtail")
        self.assertEqual(entry["cron_deliver_env_var"], "COWTAIL_HOME_CHANNEL")
        # Its only inbound messages are the postmortem requests it claims from Cowtail.
        self.assertTrue(entry["trusted_inbound"])
        self.assertTrue(entry["is_connected"](None))
        with patch.dict(os.environ, {"COWTAIL_PLATFORM_ENABLED": ""}):
            self.assertFalse(entry["is_connected"](None))
        adapter = entry["adapter_factory"](SimpleNamespace(extra={}))
        self.assertEqual(self.run_async(adapter.get_chat_info("owner"))["name"], "Cowtail")


class OutboundItemsTest(PlatformTest):
    def test_approval_prompt_creates_an_approval_item_that_expires_with_the_request(self):
        self.hermes.approvals = {
            "agent:main:cowtail:dm:owner": [
                {"request_id": "req-older", "description": "network access"},
                {"request_id": "req-1", "description": "recursive delete"},
            ]
        }
        prompt = SimpleNamespace(
            description="recursive delete", command="rm -rf /srv/scratch", session_key="agent:main:cowtail:dm:owner"
        )

        result = self.run_async(self.adapter._send_exec_approval_prompt(prompt))

        self.assertEqual((result.success, result.message_id), (True, "item-1"))
        self.assertEqual(
            self.last_item(),
            {
                "source": "hermes",
                "title": "Approve: recursive delete",
                "body": "recursive delete\n\nrm -rf /srv/scratch",
                "kind": "approval",
                "urgency": "now",
                "actions": [{"type": "approve"}, {"type": "deny"}],
                "replyTo": {
                    "type": "approval",
                    "sessionKey": "agent:main:cowtail:dm:owner",
                    "requestId": "req-1",
                },
                "expiresAt": (NOW_SECONDS + 300) * 1000,
            },
        )

    def test_clarify_with_choices_creates_a_question_to_reply_or_choose(self):
        result = self.run_async(
            self.adapter.send_clarify("owner", "Which pool?", ["fast (Recommended)", "bulk"], "clarify-1", "s-1")
        )

        self.assertTrue(result.success)
        item = self.last_item()
        self.assertEqual(
            {key: item[key] for key in ("kind", "urgency", "title", "actions", "replyTo", "expiresAt")},
            {
                "kind": "question",
                "urgency": "now",
                "title": "Which pool?",
                "actions": [{"type": "reply"}, {"type": "choose", "options": ["fast (Recommended)", "bulk"]}],
                "replyTo": {"type": "clarify", "clarifyId": "clarify-1"},
                "expiresAt": (NOW_SECONDS + 3600) * 1000,
            },
        )

    def test_an_approval_cowtail_cannot_show_whole_or_bind_to_its_request_is_refused(self):
        self.hermes.approvals = {"s-1": [{"request_id": "req-1", "description": "long script"}]}
        oversized = SimpleNamespace(
            description="long script", command="echo ok; " * 2_500 + "rm -rf /", session_key="s-1"
        )
        unbound = SimpleNamespace(description="recursive delete", command="rm -rf /tmp/x", session_key="s-2")

        results = [self.run_async(self.adapter._send_exec_approval_prompt(p)) for p in (oversized, unbound)]

        self.assertEqual([result.success for result in results], [False, False])
        self.assertEqual(self.cowtail.posted("/api/items"), [])

    def test_open_clarify_without_a_timeout_never_expires(self):
        self.hermes.clarify_timeout = 0

        self.run_async(self.adapter.send_clarify("owner", "What should the report cover?", None, "clarify-2", "s-1"))

        item = self.last_item()
        self.assertEqual(item["actions"], [{"type": "reply"}])
        self.assertNotIn("expiresAt", item)

    def test_send_creates_an_fyi_item_unless_the_caller_names_kind_and_urgency(self):
        self.run_async(self.adapter.send("owner", "Weekly report\n\nAll green."))
        plain = self.last_item()
        self.run_async(self.adapter.send("owner", "Deploy done", metadata={"kind": "done", "urgency": "whenever"}))

        self.assertEqual(
            (plain["kind"], plain["urgency"], plain["title"], plain["body"]),
            ("fyi", "today", "Weekly report", "Weekly report\n\nAll green."),
        )
        self.assertEqual((self.last_item()["kind"], self.last_item()["urgency"]), ("done", "whenever"))

    def test_a_cron_failure_notice_becomes_a_failure_item_keyed_by_its_incident(self):
        self.hermes.incidents = [
            {"id": "job1ab_sig", "job_id": "job-1", "state": "detected"},
            {"id": "job2ab_sig", "job_id": "job-2", "state": "resolved"},
        ]

        self.run_async(self.adapter.send("owner", "⚠️ Cron 'Backup' failed: disk full", metadata={"job_id": "job-1"}))
        failure = self.last_item()
        self.run_async(self.adapter.send("owner", "Backup finished", metadata={"job_id": "job-2"}))

        self.assertEqual(
            {key: failure[key] for key in ("kind", "urgency", "dedupeKey", "actions", "replyTo")},
            {
                "kind": "failure",
                "urgency": "today",
                "dedupeKey": "cron-incident:job1ab_sig",
                "actions": [{"type": "ack"}],
                "replyTo": {"type": "cron_incident", "incidentId": "job1ab_sig"},
            },
        )
        self.assertEqual(self.last_item()["kind"], "fyi")


def waiting(response_id, reply_to, answer):
    return {"id": response_id, "claimToken": f"token-{response_id}", "replyTo": reply_to, "answer": answer}


class AnswersTest(PlatformTest):
    def test_claimed_answers_reach_the_waiting_hermes_requests_then_confirm(self):
        self.hermes.approvals = {
            "session-1": [{"request_id": "req-0"}, {"request_id": "req-1"}],
            "session-2": [{"request_id": "req-2"}],
        }
        self.hermes.pending_clarify = {"clarify-1"}
        self.hermes.incidents = [{"id": "incident-1", "job_id": "job-1", "state": "alerted"}]
        self.cowtail.waiting = [
            waiting("r1", {"type": "approval", "sessionKey": "session-1", "requestId": "req-1"}, {"type": "approve"}),
            waiting("r2", {"type": "approval", "sessionKey": "session-2", "requestId": "req-2"}, {"type": "deny"}),
            waiting("r3", {"type": "clarify", "clarifyId": "clarify-1"}, {"type": "choose", "option": "bulk"}),
            waiting("r4", {"type": "cron_incident", "incidentId": "incident-1"}, {"type": "ack"}),
        ]

        self.run_async(self.adapter.apply_responses())

        self.assertEqual(
            self.hermes.calls,
            [
                ("resolve_gateway_approval", "session-1", "once", "req-1"),
                ("resolve_gateway_approval", "session-2", "deny", "req-2"),
                ("resolve_gateway_clarify", "clarify-1", "bulk"),
                ("ack_incident", "incident-1"),
            ],
        )
        self.assertEqual(
            [(path, body["claimToken"]) for path, body in self.cowtail.finished()],
            [
                ("/api/hermes/responses/r1/complete", "token-r1"),
                ("/api/hermes/responses/r2/complete", "token-r2"),
                ("/api/hermes/responses/r3/complete", "token-r3"),
                ("/api/hermes/responses/r4/complete", "token-r4"),
            ],
        )

    def test_an_applied_answer_whose_confirmation_failed_is_confirmed_again_not_reapplied(self):
        self.hermes.approvals = {"session-1": [{"request_id": "req-1"}, {"request_id": "req-2"}]}
        answer = {"type": "approval", "sessionKey": "session-1", "requestId": "req-1"}
        self.cowtail.waiting = [waiting("r1", answer, {"type": "approve"})]
        self.cowtail.refused_completions = 1

        with self.assertRaises(CowtailError):
            self.run_async(self.adapter.apply_responses())
        # The lease lapses and Cowtail hands the same answer out again under a new token.
        self.cowtail.waiting = [{**waiting("r1", answer, {"type": "approve"}), "claimToken": "token-r1-again"}]
        self.run_async(self.adapter.apply_responses())

        self.assertEqual(self.hermes.calls, [("resolve_gateway_approval", "session-1", "once", "req-1")])
        self.assertEqual(self.hermes.approvals["session-1"], [{"request_id": "req-2"}])
        self.assertEqual(
            [(path, body["claimToken"]) for path, body in self.cowtail.finished()],
            [
                ("/api/hermes/responses/r1/complete", "token-r1"),
                ("/api/hermes/responses/r1/complete", "token-r1-again"),
            ],
        )

    def test_an_ack_for_an_incident_already_closed_is_confirmed(self):
        self.hermes.incidents = [{"id": "incident-1", "job_id": "job-1", "state": "closed"}]
        self.cowtail.waiting = [waiting("r1", {"type": "cron_incident", "incidentId": "incident-1"}, {"type": "ack"})]

        self.run_async(self.adapter.apply_responses())

        self.assertEqual([path for path, _ in self.cowtail.finished()], ["/api/hermes/responses/r1/complete"])

    def test_an_approval_answer_without_a_request_id_applies_to_nothing(self):
        self.hermes.approvals = {"s-1": [{"request_id": "req-1"}]}
        self.cowtail.waiting = [waiting("r1", {"type": "approval", "sessionKey": "s-1"}, {"type": "approve"})]

        self.run_async(self.adapter.apply_responses())

        self.assertEqual(self.hermes.calls, [])
        self.assertEqual(self.hermes.approvals["s-1"], [{"request_id": "req-1"}])
        self.assertEqual([path for path, _ in self.cowtail.finished()], ["/api/hermes/responses/r1/fail"])

    def test_an_answer_hermes_no_longer_holds_is_reported_failed(self):
        self.cowtail.waiting = [
            waiting("r1", {"type": "approval", "sessionKey": "s-1", "requestId": "req-gone"}, {"type": "approve"}),
            waiting("r2", {"type": "clarify", "clarifyId": "answered"}, {"type": "reply", "text": "yes"}),
        ]

        self.run_async(self.adapter.apply_responses())

        self.assertEqual(
            [(path, body["claimToken"], body["reason"]) for path, body in self.cowtail.finished()],
            [
                ("/api/hermes/responses/r1/fail", "token-r1", self.platform.GONE),
                ("/api/hermes/responses/r2/fail", "token-r2", self.platform.GONE),
            ],
        )


class PostmortemTest(PlatformTest):
    REQUEST = {
        "id": "pm-1",
        "incidentId": "inc-7",
        "chatId": "cowtail:incident:inc-7",
        "prompt": "Write the postmortem for the Cowtail incident \"Storage outage\".",
        "claimToken": "claim-pm-1",
        "leaseUntil": 1_790_000_060_000,
        "attempts": 1,
        "createdAt": 1_790_000_000_000,
    }

    def test_a_claimed_request_reaches_hermes_in_the_incidents_chat_then_is_confirmed(self):
        self.cowtail.postmortem_requests = [dict(self.REQUEST)]

        self.run_async(self.adapter.deliver_postmortem_requests())

        [event] = self.hermes.inbound
        self.assertEqual(event.text, self.REQUEST["prompt"])
        self.assertEqual(event.source.chat_id, "cowtail:incident:inc-7")
        self.assertEqual(event.message_id, "cowtail-postmortem-pm-1")
        self.assertEqual(
            self.cowtail.posted("/api/hermes/postmortem-requests/pm-1/delivered"),
            [{"claimToken": "claim-pm-1"}],
        )

    def test_a_reply_after_delivery_names_the_request_it_answers(self):
        self.cowtail.postmortem_requests = [dict(self.REQUEST)]
        self.run_async(self.adapter.deliver_postmortem_requests())

        self.run_async(self.adapter.send("cowtail:incident:inc-7", "## Summary"))

        self.assertEqual(
            self.cowtail.posted("/api/hermes/incidents/inc-7/postmortem"),
            [{"text": "## Summary", "requestId": "pm-1"}],
        )

    def test_the_agents_reply_in_an_incident_chat_is_posted_as_its_postmortem_not_an_item(self):
        result = self.run_async(
            self.adapter.send("cowtail:incident:inc-7", "## Summary\nosd.4 dropped off the cluster.")
        )

        self.assertTrue(result.success)
        self.assertEqual(
            self.cowtail.posted("/api/hermes/incidents/inc-7/postmortem"),
            [{"text": "## Summary\nosd.4 dropped off the cluster."}],
        )
        self.assertEqual(self.cowtail.posted("/api/items"), [])


class HeartbeatTest(PlatformTest):
    def test_the_connected_platform_posts_a_snapshot_every_interval(self):
        self.hermes.jobs = [
            {
                "id": "job-1",
                "name": "Nightly backup check",
                "schedule_display": "0 3 * * *",
                "last_run_at": "2026-11-24T03:00:00+00:00",
                "last_status": "ok",
                "next_run_at": "2026-11-25T03:00:00+00:00",
            }
        ]
        self.hermes.incidents = [
            {
                "id": "job1ab_sig",
                "job_id": "job-1",
                "state": "alerted",
                "failure_type": "timeout",
                "first_seen_at": "2026-11-23T03:00:00+00:00",
                "last_seen_at": "2026-11-24T03:00:00+00:00",
                "error": "timed out",
            }
        ]
        real_sleep = asyncio.sleep
        heartbeat_sleeps: list[int] = []

        async def run():
            stopped = asyncio.Event()

            async def fake_sleep(seconds):
                if seconds == self.platform.HEARTBEAT_SECONDS:
                    heartbeat_sleeps.append(seconds)
                    if len(heartbeat_sleeps) == 3:
                        self.adapter._running = False
                        stopped.set()
                await real_sleep(0)

            with patch.object(self.platform.asyncio, "sleep", fake_sleep):
                self.assertTrue(await self.adapter.connect())
                await stopped.wait()
                await self.adapter.disconnect()

        self.run_async(run())

        expected = {
            "platforms": ["cowtail", "telegram"],
            "model": "claude-opus-5-5",
            "provider": "anthropic",
            "cronJobs": [
                {
                    "id": "job-1",
                    "name": "Nightly backup check",
                    "schedule": "0 3 * * *",
                    "lastRunAt": 1_795_489_200_000,
                    "lastStatus": "ok",
                    "nextRunAt": 1_795_575_600_000,
                }
            ],
            "openIncidents": [
                {
                    "id": "job1ab_sig",
                    "jobId": "job-1",
                    "state": "alerted",
                    "failureType": "timeout",
                    "firstSeenAt": 1_795_402_800_000,
                    "lastSeenAt": 1_795_489_200_000,
                    "error": "timed out",
                }
            ],
            "kanban": {"blocked": 2, "running": 1},
        }
        self.assertEqual(self.cowtail.posted("/api/hermes/heartbeat"), [expected] * 3)
        self.assertEqual(heartbeat_sleeps, [60, 60, 60])


if __name__ == "__main__":
    unittest.main()
