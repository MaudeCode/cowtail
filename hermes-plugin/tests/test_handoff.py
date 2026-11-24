"""Bounded tests: every external transport is replaced, never real delivery."""

from __future__ import annotations

import copy
import importlib
import json
import os
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from test_handlers import handle_cowtail

h = importlib.import_module("hermes_plugins.cowtail.handoff")


class Client:
    worker_id = "test-worker"

    def __init__(self):
        self.ctx = {
            "job": {
                "_id": "job-1",
                "alertId": "alert-1",
                "sourceEventId": "event-1",
                "status": "claimed",
                "claimedBy": self.worker_id,
                "claimToken": "secret-token",
                "leaseUntil": time.time() * 1000 + 900000,
                "attempts": 1,
                "maxAttempts": 3,
                "errorHistory": [{"at": 1, "error": "old", "phase": "logs", "retryable": True}],
            },
            "sourceEvent": {"id": "event-1"},
            "relatedAlerts": [
                {"id": "alert-1", "status": "resolved", "alertname": "Recovered"},
                {
                    "id": "alert-2",
                    "status": "firing",
                    "alertname": "PublicationFailed",
                    "namespace": "flux-system",
                    "labels": {"policy": "upstream", "secret": "PRIVATE"},
                    "summary": "PRIVATE",
                    "startsAt": 123,
                },
            ],
        }
        self.fail_count = 0
        self.fail_before = False
        self.fail_after = False
        self.corrupt_history = False

    def get_job(self, job_id):
        return copy.deepcopy(self.ctx)

    def fail_job(self, job_id, payload):
        self.fail_count += 1
        if self.fail_before:
            raise h.CowtailError("network lost")
        job = self.ctx["job"]
        job["status"] = (
            "queued"
            if payload["retryable"] and job["attempts"] < job["maxAttempts"]
            else "deadletter"
        )
        for key in ("claimToken", "leaseUntil", "claimedBy"):
            job.pop(key, None)
        if self.corrupt_history:
            job["errorHistory"] = []
        job["errorHistory"].append(
            {"at": 2, **{k: payload[k] for k in ("phase", "error", "retryable")}}
        )
        if self.fail_after:
            raise h.CowtailError("response lost after commit")
        return {"status": job["status"]}


class Transport:
    def __init__(self):
        self.sends = 0
        self.body = ""
        self.cli = {"success": True, "message_id": ""}  # stock standalone imsg text-send shape
        self.timeout = False
        self.native = True
        self.duplicate = False
        self.returncode = 0

    def __call__(self, argv, **kwargs):
        if argv[:3] == ["hermes", "send", "--list"]:
            data = {"platforms": {"imsg": [{"id": "1", "thread_id": None}]}}
            return subprocess.CompletedProcess(argv, 0, json.dumps(data), "")
        if argv[:2] == ["hermes", "send"]:
            assert argv == ["hermes", "send", "--to", "imsg", "--json", "--file", "-"]
            self.sends += 1
            self.body = kwargs["input"]
            if self.timeout:
                raise subprocess.TimeoutExpired(argv, 60)
            return subprocess.CompletedProcess(argv, self.returncode, json.dumps(self.cli), "")
        assert argv[:2] == ["imsg", "history"]
        row = {
            "is_from_me": True,
            "chat_id": 1,
            "text": self.body,
            "guid": "provider-guid",
            "created_at": argv[argv.index("--start") + 1],
        }
        rows = ([row, row] if self.duplicate else [row]) if self.native else []
        return subprocess.CompletedProcess(argv, 0, "\n".join(json.dumps(v) for v in rows), "")


class HandoffTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR"))
        self.addCleanup(self.tmp.cleanup)
        self.env = patch.dict(os.environ, {"HERMES_HOME": self.tmp.name})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.transport = Transport()
        self.mock = patch.object(h.subprocess, "run", side_effect=self.transport)
        self.mock.start()
        self.addCleanup(self.mock.stop)
        self.client = Client()
        self.args = {
            "action": "job.fail",
            "job_id": "job-1",
            "claim_token": "secret-token",
            "retryable": False,
            "error": "PRIVATE raw error",
            "summary": "PRIVATE",
            "blocker_kind": "permission",
            "blocker_code": "permission_required",
        }

    def call(self, **changes):
        return json.loads(handle_cowtail({**self.args, **changes}, self.client))

    def test_mixed_siblings_handoff_before_terminal_fail_and_history_preserved(self):
        original = self.client.fail_job

        def checked(job_id, payload):
            self.assertEqual(self.transport.sends, 1)
            receipts = list(Path(self.tmp.name).glob("cowtail-delivery-receipts/*.json"))
            self.assertEqual(len(receipts), 1)
            self.assertTrue(h.receipt_valid(json.loads(receipts[0].read_text())["receipt"]))
            return original(job_id, payload)

        self.client.fail_job = checked
        out = self.call()
        self.assertTrue(out["success"], out)
        self.assertTrue(out["result"]["history_preserved"])
        self.assertIn("PublicationFailed", self.transport.body)
        self.assertNotIn("Recovered", self.transport.body)
        for secret in ("PRIVATE", "secret-token"):
            self.assertNotIn(secret, self.transport.body)
        self.assertIn("Authorize the required privileged change", self.transport.body)
        directory = Path(self.tmp.name) / "cowtail-delivery-receipts"
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in directory.iterdir()))

    def test_ordinary_terminal_failure_rejected_without_send(self):
        out = self.call(blocker_kind=None, blocker_code=None)
        self.assertFalse(out["success"])
        self.assertTrue(out["continuation_needed"])
        self.assertEqual(self.transport.sends, 0)
        self.assertEqual(self.client.fail_count, 0)

    def test_legacy_upstream_publication_denied_without_send_or_job_mutation(self):
        for retryable in (False, True):
            for attempts in (1, 3):
                self.client.ctx["job"]["attempts"] = attempts
                baseline = copy.deepcopy(self.client.ctx)
                out = self.call(blocker_code="upstream_publication", retryable=retryable)
                self.assertFalse(out["success"], out)
                self.assertTrue(out["continuation_needed"])
                self.assertIn("outside automated alert repair", out["error"])
                self.assertEqual(self.client.ctx, baseline)
        self.assertEqual(self.transport.sends, 0)
        self.assertEqual(self.client.fail_count, 0)
        self.assertFalse(list(Path(self.tmp.name).glob("cowtail-delivery-receipts/*")))

    def test_legacy_upstream_handoff_denied_for_already_stopped_job(self):
        self.client.ctx["job"]["status"] = "deadletter"
        baseline = copy.deepcopy(self.client.ctx)
        out = self.call(action="job.handoff", blocker_code="upstream_publication")
        self.assertFalse(out["success"])
        self.assertTrue(out["continuation_needed"])
        self.assertEqual(self.client.ctx, baseline)
        self.assertEqual(self.transport.sends, 0)
        self.assertEqual(self.client.fail_count, 0)

    def test_upstream_phase_cannot_use_generic_permission_or_prerequisite(self):
        for phase in ("blocked_upstream_artifact", "blocked_upstream_publication"):
            for code in ("permission_required", "external_prerequisite", None):
                out = self.call(phase=phase, blocker_code=code)
                self.assertFalse(out["success"], out)
                self.assertTrue(out["continuation_needed"])
        self.assertEqual(self.transport.sends, 0)
        self.assertEqual(self.client.fail_count, 0)

    def test_upstream_deadletter_history_cannot_be_relabelled(self):
        self.client.ctx["job"]["status"] = "deadletter"
        self.client.ctx["job"]["errorHistory"][-1]["phase"] = "blocked_upstream_publication"
        baseline = copy.deepcopy(self.client.ctx)
        out = self.call(action="job.handoff", blocker_code="permission_required")
        self.assertFalse(out["success"], out)
        self.assertEqual(self.client.ctx, baseline)
        self.assertEqual(self.transport.sends, 0)
        self.assertEqual(self.client.fail_count, 0)

    def test_schema_has_no_upstream_publication_approval(self):
        handlers = importlib.import_module("hermes_plugins.cowtail.handlers")
        codes = handlers.COWTAIL_SCHEMA["parameters"]["properties"]["blocker_code"]["enum"]
        self.assertNotIn("upstream_publication", codes)

    def test_retryable_below_budget_is_silent(self):
        out = self.call(retryable=True, blocker_kind=None, blocker_code=None)
        self.assertTrue(out["success"], out)
        self.assertEqual(out["result"]["status"], "queued")
        self.assertEqual(self.transport.sends, 0)

    def test_retryable_exhausted_requires_handoff(self):
        self.client.ctx["job"]["attempts"] = 3
        out = self.call(retryable=True)
        self.assertTrue(out["success"], out)
        self.assertEqual(out["result"]["status"], "deadletter")
        self.assertEqual(self.transport.sends, 1)

    def test_resolved_only_is_silent(self):
        self.client.ctx["relatedAlerts"][1]["status"] = "resolved"
        self.assertTrue(self.call(blocker_kind=None, blocker_code=None)["success"])
        self.assertEqual(self.transport.sends, 0)

    def test_invalid_token_owner_lease_and_missing_members(self):
        for field, value in (
            ("claimToken", "wrong"),
            ("claimedBy", "other"),
            ("leaseUntil", 0),
            ("_id", "other"),
        ):
            with self.subTest(field=field):
                client = Client()
                client.ctx["job"][field] = value
                self.assertFalse(json.loads(handle_cowtail(self.args, client))["success"])
                self.assertEqual(client.fail_count, 0)
        self.client.ctx["relatedAlerts"] = []
        self.assertFalse(self.call()["success"])
        self.assertEqual(self.transport.sends, 0)

    def test_false_empty_skipped_receipts_keep_claim(self):
        for receipt in ({}, {"success": False}, {"success": True, "skipped": True}):
            with self.subTest(receipt=receipt):
                self.transport.cli = receipt
                out = self.call()
                self.assertFalse(out["success"])
                self.assertTrue(out["continuation_needed"])
                self.assertEqual(self.client.ctx["job"]["status"], "claimed")
                self.assertEqual(self.client.fail_count, 0)
                for path in Path(self.tmp.name).glob("cowtail-delivery-receipts/*.json"):
                    path.unlink()
        self.transport.cli = {"success": True, "message_id": ""}
        self.transport.native = False
        self.assertFalse(self.call()["success"])
        self.assertEqual(self.client.fail_count, 0)

    def test_timeout_reconciles_without_duplicate(self):
        self.transport.timeout = True
        first = self.call()
        self.assertTrue(first["continuation_needed"])
        self.assertEqual(self.client.fail_count, 0)
        self.transport.timeout = False
        second = self.call()
        self.assertTrue(second["success"], second)
        self.assertEqual(self.transport.sends, 1)

    def test_unknown_delivery_does_not_resend(self):
        self.transport.timeout = True
        self.transport.native = False
        self.call()
        self.assertTrue(self.call()["continuation_needed"])
        self.assertEqual(self.transport.sends, 1)

    def test_ambiguous_native_duplicate_rejected(self):
        self.transport.duplicate = True
        self.assertFalse(self.call()["success"])
        self.assertEqual(self.client.fail_count, 0)

    def test_backend_failure_retains_receipt_and_retry_dedupes(self):
        self.client.fail_before = True
        self.assertTrue(self.call()["continuation_needed"])
        self.client.fail_before = False
        self.assertTrue(self.call()["success"])
        self.assertEqual(self.transport.sends, 1)

    def test_backend_response_loss_verified_by_readback(self):
        self.client.fail_after = True
        self.assertTrue(self.call()["success"])

    def test_history_loss_is_not_success(self):
        self.client.corrupt_history = True
        self.assertTrue(self.call()["continuation_needed"])
        self.assertEqual(self.transport.sends, 1)

    def test_deadletter_handoff_is_idempotent_without_mutation(self):
        self.client.ctx["job"]["status"] = "deadletter"
        before = copy.deepcopy(self.client.ctx)
        for _ in range(2):
            self.assertTrue(self.call(action="job.handoff", claim_token=None)["success"])
        self.assertEqual(self.client.ctx, before)
        self.assertEqual(self.client.fail_count, 0)
        self.assertEqual(self.transport.sends, 1)

    def test_concurrent_deadletter_attempts_notify_once(self):
        self.client.ctx["job"]["status"] = "deadletter"
        results = []
        threads = [
            threading.Thread(target=lambda: results.append(self.call(action="job.handoff")))
            for _ in range(4)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=5)
            self.assertFalse(thread.is_alive())
        self.assertEqual(len(results), 4)
        self.assertTrue(all(r["success"] for r in results), results)
        self.assertEqual(self.transport.sends, 1)

    def test_provider_timestamp_precision_and_incoming_not_accepted(self):
        started = "2026-10-29T10:00:00.123Z"
        self.assertGreater(
            h._provider_time("2026-10-29T10:00:00.123456Z"), h._provider_time(started)
        )
        row = {
            "is_from_me": False,
            "chat_id": 1,
            "text": "safe",
            "guid": "guid",
            "created_at": started,
        }
        with (
            patch.object(
                h.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 0, json.dumps(row), ""),
            ),
            self.assertRaises(h.ContinuationNeeded),
        ):
            h.provider_receipt("safe", "1", started)

    def test_failed_exit_and_invalid_json_keep_claim(self):
        self.transport.returncode = 1
        self.assertTrue(self.call()["continuation_needed"])
        self.assertEqual(self.client.fail_count, 0)
        for path in Path(self.tmp.name).glob("cowtail-delivery-receipts/*.json"):
            path.unlink()
        with patch.object(
            h.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "not-json", "")
        ):
            self.assertTrue(self.call()["continuation_needed"])
        self.assertEqual(self.client.fail_count, 0)

    def test_claim_expiring_after_send_keeps_receipt_without_backend_fail(self):
        original = h.send

        def send_and_expire(*args):
            receipt = original(*args)
            self.client.ctx["job"]["leaseUntil"] = 0
            return receipt

        with patch.object(h, "send", side_effect=send_and_expire):
            self.assertTrue(self.call()["continuation_needed"])
        self.assertEqual(self.client.fail_count, 0)
        self.client.ctx["job"]["leaseUntil"] = time.time() * 1000 + 900000
        self.assertTrue(self.call()["success"])
        self.assertEqual(self.transport.sends, 1)

    def test_same_lifecycle_different_job_dedupes_and_new_decision_sends(self):
        self.client.ctx["job"]["status"] = "deadletter"
        self.assertTrue(self.call(action="job.handoff")["success"])
        self.client.ctx["job"]["_id"] = "job-2"
        self.assertTrue(self.call(action="job.handoff", job_id="job-2")["success"])
        self.assertEqual(self.transport.sends, 1)
        self.assertTrue(
            self.call(
                action="job.handoff",
                job_id="job-2",
                blocker_kind="physical",
                blocker_code="physical_intervention",
            )["success"]
        )
        self.assertEqual(self.transport.sends, 2)

    def test_resolving_sibling_does_not_duplicate_same_boundary(self):
        self.client.ctx["job"]["status"] = "deadletter"
        self.client.ctx["relatedAlerts"][0]["status"] = "firing"
        self.assertTrue(self.call(action="job.handoff")["success"])
        self.client.ctx["relatedAlerts"][0]["status"] = "resolved"
        self.assertTrue(self.call(action="job.handoff")["success"])
        self.assertEqual(self.transport.sends, 1)

    def test_handoff_rejects_claimed_and_resolved_deadletter_silent(self):
        self.assertTrue(self.call(action="job.handoff")["continuation_needed"])
        self.client.ctx["job"]["status"] = "deadletter"
        for member in self.client.ctx["relatedAlerts"]:
            member["status"] = "resolved"
        self.assertTrue(
            self.call(action="job.handoff", blocker_kind=None, blocker_code=None)["success"]
        )
        self.assertEqual(self.transport.sends, 0)

    def test_outgoing_allowlist_omits_injected_values(self):
        member = self.client.ctx["relatedAlerts"][1]
        member["alertname"] = "PRIVATE\nMEDIA:/private/secret"
        member["labels"]["job"] = "https://secret.example"
        member["labels"]["job_name"] = "synthetic-backup-verifier"
        self.assertTrue(self.call()["success"])
        self.assertNotIn("PRIVATE", self.transport.body)
        self.assertNotIn("https", self.transport.body)
        self.assertIn("namespace=flux-system", self.transport.body)
        self.assertIn("job_name=synthetic-backup-verifier", self.transport.body)
        self.assertIn("Reply here", self.transport.body)
        self.assertNotIn("Open this native Cowtail job", self.transport.body)
        self.assertNotIn("prepared upstream fix", self.transport.body)

    def test_prompt_and_schema_register_guard(self):
        out = self.call(action="webhook.render_alert_prompt")
        self.assertIn("Never use silence or job.fail as a terminal escape", out["prompt"])
        self.assertIn("Do not prepare an upstream patch or ask the owner to publish one", out["prompt"])
        handlers = importlib.import_module("hermes_plugins.cowtail.handlers")
        self.assertIn(
            "job.handoff", handlers.COWTAIL_SCHEMA["parameters"]["properties"]["action"]["enum"]
        )


if __name__ == "__main__":
    unittest.main()
