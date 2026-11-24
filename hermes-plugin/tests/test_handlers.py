from __future__ import annotations

import importlib
import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_PARENT = "hermes_plugins"
PACKAGE = "hermes_plugins.cowtail"
if PACKAGE_PARENT not in sys.modules:
    parent = types.ModuleType(PACKAGE_PARENT)
    parent.__path__ = []
    sys.modules[PACKAGE_PARENT] = parent
spec = importlib.util.spec_from_file_location(
    PACKAGE,
    ROOT / "__init__.py",
    submodule_search_locations=[str(ROOT)],
)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
module.__package__ = PACKAGE
module.__path__ = [str(ROOT)]
sys.modules[PACKAGE] = module
spec.loader.exec_module(module)

_handlers = importlib.import_module("hermes_plugins.cowtail.handlers")
handle_cowtail = _handlers.handle_cowtail


class FakeCowtailClient:
    def __init__(self):
        self.calls = []
        self.worker_id = "test-worker"
        self.failed = None

    def status(self):
        self.calls.append(("status",))
        return {"api_base": "https://cowtail.example", "worker_token_configured": True}

    def get_alert(self, alert_id):
        self.calls.append(("get_alert", alert_id))
        return {"ok": True, "alert": {"id": alert_id}}

    def query_alerts(self, from_ms=None, to_ms=None, outcome=None, severity=None):
        self.calls.append(("query_alerts", from_ms, to_ms, outcome, severity))
        return {"ok": True, "alerts": []}

    def write_alert(self, payload):
        self.calls.append(("write_alert", payload))
        return {"ok": True, "id": "alert-1"}

    def write_fix(self, payload):
        self.calls.append(("write_fix", payload))
        return {"ok": True, "id": "fix-1"}

    def claim_job(self, job_id=None, lease_seconds=900):
        self.calls.append(("claim_job", job_id, lease_seconds))
        return {"ok": True, "claimed": True, "job": {"_id": job_id or "job-1"}}

    def get_job(self, job_id):
        self.calls.append(("get_job", job_id))
        if self.failed:
            return {
                "job": {
                    "_id": job_id,
                    "status": "deadletter",
                    "attempts": 1,
                    "sourceEventId": "event-1",
                    "errorHistory": [self.failed],
                }
            }
        return {
            "ok": True,
            "job": {
                "_id": job_id,
                "status": "claimed",
                "claimToken": "claim-1",
                "claimedBy": self.worker_id,
                "leaseUntil": 9999999999999,
                "attempts": 1,
                "maxAttempts": 5,
                "sourceEventId": "event-1",
                "alertId": "alert-1",
                "errorHistory": [],
            },
            "sourceEvent": {"id": "event-1"},
            "relatedAlerts": [{"id": "alert-1", "status": "resolved"}],
        }

    def renew_job(self, job_id, claim_token, lease_seconds=900):
        self.calls.append(("renew_job", job_id, claim_token, lease_seconds))
        return {"ok": True, "leaseUntil": 123}

    def complete_job(self, job_id, payload):
        self.calls.append(("complete_job", job_id, payload))
        return {"ok": True}

    def fail_job(self, job_id, payload):
        self.calls.append(("fail_job", job_id, payload))
        self.failed = {k: payload[k] for k in ("phase", "error", "retryable")}
        return {"ok": True, "status": "deadletter"}

    def requeue_job(self, job_id):
        self.calls.append(("requeue_job", job_id))
        return {"ok": True}

    def deadletters(self, limit=50):
        self.calls.append(("deadletters", limit))
        return {"ok": True, "jobs": []}


class HandlerTests(unittest.TestCase):
    def test_status(self):
        client = FakeCowtailClient()
        out = json.loads(handle_cowtail({"action": "status"}, client))
        self.assertTrue(out["success"])
        self.assertEqual(client.calls, [("status",)])
        self.assertNotIn("token", json.dumps(out).lower().replace("worker_token_configured", ""))

    def test_claim_forwards_job_and_lease(self):
        client = FakeCowtailClient()
        out = json.loads(
            handle_cowtail({"action": "job.claim", "job_id": "job-1", "lease_seconds": 120}, client)
        )
        self.assertTrue(out["success"])
        self.assertEqual(client.calls, [("claim_job", "job-1", 120)])

    def test_claim_compacts_large_batches_and_preserves_token_and_ids(self):
        class LargeBatchClient(FakeCowtailClient):
            def claim_job(self, job_id=None, lease_seconds=900):
                self.calls.append(("claim_job", job_id, lease_seconds))
                return {
                    "ok": True,
                    "claimed": True,
                    "job": {"_id": job_id, "claimToken": "private-claim-token"},
                    "alert": {"id": "alert-000", "summary": "Primary", "rawPayload": "x" * 5000},
                    "sourceEvent": {"id": "event-1"},
                    "relatedAlerts": [
                        {
                            "id": f"alert-{index:03d}",
                            "alertname": "SyntheticBatch",
                            "severity": "warning",
                            "status": "firing",
                            "summary": f"Synthetic alert {index}",
                            "labels": {"instance": f"synthetic-{index:03d}"},
                            "rawPayload": "x" * 5000,
                        }
                        for index in range(200)
                    ],
                }

        client = LargeBatchClient()
        raw = handle_cowtail({"action": "job.claim", "job_id": "job-1"}, client)
        out = json.loads(raw)
        result = out["result"]

        self.assertEqual(result["claimToken"], "private-claim-token")
        self.assertNotIn("claimToken", result["job"])
        self.assertEqual(result["relatedAlertCount"], 200)
        self.assertEqual(len(result["relatedAlertIds"]), 200)
        self.assertEqual(len(result["relatedAlerts"]), 200)
        self.assertNotIn("rawPayload", result["relatedAlerts"][0])
        self.assertLess(len(raw), 100_000)

    def test_complete_requires_claim_token_and_maps_payload(self):
        client = FakeCowtailClient()
        out = json.loads(
            handle_cowtail(
                {
                    "action": "job.complete",
                    "job_id": "job-1",
                    "claim_token": "claim-1",
                    "outcome": "fixed",
                    "summary": "Fixed it",
                    "action_taken": "Patched GitOps",
                    "root_cause": "bad config",
                    "batch_results": [
                        {
                            "alert_id": "alert-1",
                            "outcome": "fixed",
                            "summary": "Fixed it",
                            "action_taken": "Patched GitOps",
                            "root_cause": "bad config",
                        }
                    ],
                },
                client,
            )
        )
        self.assertTrue(out["success"])
        self.assertEqual(client.calls[0][0], "complete_job")
        self.assertEqual(client.calls[0][1], "job-1")
        self.assertEqual(client.calls[0][2]["claimToken"], "claim-1")
        self.assertEqual(client.calls[0][2]["action"], "Patched GitOps")
        self.assertEqual(client.calls[0][2]["results"][0]["alertId"], "alert-1")

    def test_complete_derives_legacy_summary_from_batch_results(self):
        client = FakeCowtailClient()
        out = json.loads(
            handle_cowtail(
                {
                    "action": "job.complete",
                    "job_id": "job-1",
                    "claim_token": "claim-1",
                    "batch_results": [
                        {
                            "alert_id": "alert-1",
                            "outcome": "recorded",
                            "summary": "Investigated alert",
                            "action_taken": "Recorded evidence",
                        }
                    ],
                },
                client,
            )
        )
        self.assertTrue(out["success"])
        payload = client.calls[0][2]
        self.assertEqual(payload["outcome"], "recorded")
        self.assertEqual(payload["summary"], "Investigated alert")
        self.assertEqual(payload["action"], "Recorded evidence")

    def test_complete_preserves_legacy_single_alert_completion(self):
        client = FakeCowtailClient()
        out = json.loads(
            handle_cowtail(
                {
                    "action": "job.complete",
                    "job_id": "job-1",
                    "claim_token": "claim-1",
                    "outcome": "fixed",
                    "summary": "Fixed it",
                    "action_taken": "Patched GitOps",
                },
                client,
            )
        )
        self.assertTrue(out["success"])
        payload = client.calls[0][2]
        self.assertEqual(payload["outcome"], "fixed")
        self.assertNotIn("results", payload)

    def test_complete_rejects_pending_batch_outcome(self):
        client = FakeCowtailClient()
        out = json.loads(
            handle_cowtail(
                {
                    "action": "job.complete",
                    "job_id": "job-1",
                    "claim_token": "claim-1",
                    "batch_results": [
                        {
                            "alert_id": "alert-1",
                            "outcome": "pending",
                            "summary": "Not handled",
                            "action_taken": "No action",
                        }
                    ],
                },
                client,
            )
        )
        self.assertFalse(out["success"])
        self.assertIn("pending is not allowed", out["error"])
        self.assertEqual(client.calls, [])

    def test_complete_missing_claim_token_returns_error(self):
        out = json.loads(
            handle_cowtail(
                {
                    "action": "job.complete",
                    "job_id": "job-1",
                    "outcome": "fixed",
                    "summary": "Fixed it",
                    "action_taken": "Patched GitOps",
                },
                FakeCowtailClient(),
            )
        )
        self.assertFalse(out["success"])
        self.assertIn("claim_token", out["error"])

    def test_complete_rejects_outcomes_outside_protocol_enum(self):
        client = FakeCowtailClient()
        out = json.loads(
            handle_cowtail(
                {
                    "action": "job.complete",
                    "job_id": "job-1",
                    "claim_token": "claim-1",
                    "outcome": "verified_synthetic_probe",
                    "summary": "Probe complete",
                    "action_taken": "Verified pipeline",
                    "batch_results": [
                        {
                            "alert_id": "alert-1",
                            "outcome": "verified_synthetic_probe",
                            "summary": "Probe complete",
                            "action_taken": "Verified pipeline",
                        }
                    ],
                },
                client,
            )
        )
        self.assertFalse(out["success"])
        self.assertIn("outcome must be one of", out["error"])
        self.assertEqual(client.calls, [])

    def test_fail_maps_retryable(self):
        client = FakeCowtailClient()
        out = json.loads(
            handle_cowtail(
                {
                    "action": "job.fail",
                    "job_id": "job-1",
                    "claim_token": "claim-1",
                    "phase": "logs",
                    "error": "kubectl failed",
                    "retryable": False,
                },
                client,
            )
        )
        self.assertTrue(out["success"])
        self.assertEqual(client.calls[1][0], "fail_job")
        self.assertFalse(client.calls[1][2]["retryable"])

    def test_render_alert_prompt(self):
        out = json.loads(
            handle_cowtail(
                {"action": "webhook.render_alert_prompt", "job_id": "job-1"}, FakeCowtailClient()
            )
        )
        self.assertTrue(out["success"])
        self.assertIn("job_id=job-1", out["prompt"])
        self.assertIn("every related alert as a first-class investigation target", out["prompt"])
        self.assertIn("Obtain current evidence", out["prompt"])
        self.assertIn("never copy or preserve an earlier sibling summary", out["prompt"])
        self.assertIn("even if its current status is resolved", out["prompt"])
        self.assertIn("Cowtail will reject incomplete batches", out["prompt"])

    def test_render_prompt_includes_prior_occurrences(self):
        prior = {
            "alertId": "alert-0",
            "firedAt": 1,
            "outcome": "fixed",
            "rootCause": "Memory limit too low",
            "summary": "OOMKilled at 256Mi",
            "fixes": [{"description": "Raise the limit", "rootCause": "Memory limit too low", "commit": "7be01d4"}],
        }

        class HistoryClient(FakeCowtailClient):
            def get_job(self, job_id):
                return {**super().get_job(job_id), "priorOccurrences": {"alert-1": [prior]}}

        prompt = json.loads(handle_cowtail(
            {"action": "webhook.render_alert_prompt", "job_id": "job-1"}, HistoryClient()
        ))["prompt"]

        self.assertIn("check whether the previous root cause and fix apply", prompt)
        self.assertIn(json.dumps({"alert-1": [prior]}, sort_keys=True), prompt)
        self.assertIn("record each diagnostic command and its key output as evidence", prompt)

    def test_render_prompt_without_history_when_job_read_fails(self):
        class OfflineClient(FakeCowtailClient):
            def get_job(self, job_id):
                raise _handlers.CowtailError("Cowtail request failed")

        out = json.loads(handle_cowtail(
            {"action": "webhook.render_alert_prompt", "job_id": "job-1"}, OfflineClient()
        ))

        self.assertTrue(out["success"])
        self.assertIn("job_id=job-1", out["prompt"])
        self.assertNotIn("Prior occurrences by alert ID", out["prompt"])

    def test_complete_forwards_evidence(self):
        evidence = [
            {"step": "Read the last termination state", "command": "kubectl describe pod", "output": "OOMKilled"},
            {"step": "Raise the limit in GitOps"},
        ]
        result = {"alert_id": "alert-1", "outcome": "fixed", "summary": "Fixed it", "action_taken": "Patched"}
        for args in (
            {"batch_results": [{**result, "evidence": evidence}]},
            {"outcome": "fixed", "summary": "Fixed it", "action_taken": "Patched", "evidence": evidence},
        ):
            with self.subTest(batch="batch_results" in args):
                client = FakeCowtailClient()
                out = json.loads(handle_cowtail(
                    {"action": "job.complete", "job_id": "job-1", "claim_token": "claim-1", **args}, client
                ))
                self.assertTrue(out["success"])
                payload = client.calls[0][2]
                sent = (payload["results"][0] if "results" in payload else payload).get("evidence")
                self.assertEqual(sent, evidence)

    def test_completion_schema_takes_evidence(self):
        properties = _handlers.COWTAIL_SCHEMA["parameters"]["properties"]
        for schema in (properties.get("evidence"), properties["batch_results"]["items"]["properties"].get("evidence")):
            self.assertIsNotNone(schema)
            self.assertEqual(schema["maxItems"], 20)
            self.assertEqual(schema["items"]["required"], ["step"])

    def test_unsupported_action(self):
        out = json.loads(handle_cowtail({"action": "nope"}, FakeCowtailClient()))
        self.assertFalse(out["success"])

    def test_render_prompt_checks_usage_before_upstream_diagnosis(self):
        prompt = json.loads(handle_cowtail({
            "action": "webhook.render_alert_prompt", "job_id": "synthetic-investigation"
        }, FakeCowtailClient()))["prompt"]
        for requirement in (
            "Load the alertmanager skill before diagnosis",
            "are hypotheses, not established facts",
            "Check our usage first",
            "exact-version minimal reproduction under documented supported usage",
            "expected versus actual results",
            "ruling out local configuration and invocation errors",
            "diagnosis unconfirmed and continue targeted investigation",
            "does not establish root cause or remove permission",
            "Do not prepare an upstream patch or ask the owner to publish one",
        ):
            with self.subTest(requirement=requirement):
                self.assertIn(requirement, prompt)
        self.assertLess(prompt.index("Check our usage first"), prompt.index("outside automated alert repair"))
        self.assertNotIn("Prepare any available safe upstream local fix", prompt)

    def test_render_prompt_separates_kopiur_counters_from_restore_proof(self):
        prompt = json.loads(handle_cowtail({
            "action": "webhook.render_alert_prompt", "job_id": "synthetic-investigation"
        }, FakeCowtailClient()))["prompt"]
        for requirement in (
            "same snapshot manifest and source identity",
            "cached/new-file counters, complete tree counts and actual restored content",
            "A failed predicate or unexpected counter alone is not that proof",
            "Never infer corruption from those counts alone",
        ):
            with self.subTest(requirement=requirement):
                self.assertIn(requirement, prompt)


if __name__ == "__main__":
    unittest.main()
