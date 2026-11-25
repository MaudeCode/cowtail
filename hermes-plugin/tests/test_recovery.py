from __future__ import annotations

import os
import sys
import unittest
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock, patch

from test_handlers import _handlers

recovery = _handlers.recovery
EXECUTION = {"deliveryId": "delivery-one", "admissionId": "admission-one", "sessionId": "session-one", "generation": 1}
RECEIPT = {
    "admission_id": "admission-one", "request_id": "delivery-one", "target_session_id": "session-one", "generation": 1,
    "status": "terminal", "outcome": "completed",
    "payload": {"native_text_v1": {"source": {"platform": "webhook", "user_id": "webhook:repair-test"}}},
}
ENDED = {"end_reason": "webhook_complete"}


class RecoveryTest(unittest.TestCase):
    def test_sweep_reports_only_exact_finalized_webhook_executions(self):
        client = Mock()
        jobs = [
            {"jobId": "abandoned-job", "execution": EXECUTION},
            {"jobId": "different-generation", "execution": {**EXECUTION, "generation": 2}},
        ]
        client.expired_executions.return_value = {"cursor": "page-two", "jobs": jobs}
        db = SimpleNamespace(get_session=lambda _: ENDED)
        modules = {
            "hermes_state": SimpleNamespace(SessionDB=lambda *, read_only: nullcontext(db)),
            "hermes_state_runtime": SimpleNamespace(get_session_admission=lambda db, *, admission_id: RECEIPT),
        }
        with (patch.dict(sys.modules, modules),
              patch.dict(os.environ, {"COWTAIL_RECOVERY_WEBHOOK_ROUTE": "repair-test"}),
              patch.object(recovery, "has_live_dependents", return_value=False)):
            self.assertEqual(recovery.sweep(client, "page-one"), "page-two")
        client.expired_executions.assert_called_once_with("page-one")
        client.report_stopped_execution.assert_called_once_with("abandoned-job", EXECUTION, "completed")

    def test_unknown_live_interrupted_rejected_or_missing_are_not_stop_proof(self):
        for receipt, session in (
            (None, ENDED), (RECEIPT, None), (RECEIPT, {"end_reason": "reset"}),
            ({**RECEIPT, "status": "started"}, ENDED), ({**RECEIPT, "status": "unknown"}, ENDED),
            ({**RECEIPT, "outcome": "interrupted"}, ENDED), ({**RECEIPT, "outcome": "rejected"}, ENDED),
        ):
            with self.subTest(receipt=receipt, session=session):
                self.assertIsNone(recovery.stopped_outcome(receipt, session, EXECUTION, "repair-test"))

    def test_replacement_tool_gate_does_not_remove_existing_approval_policy(self):
        self.addCleanup(recovery.clear_preflight, EXECUTION["sessionId"])
        recovery.require_reconciliation(EXECUTION, "job-one")
        session = EXECUTION["sessionId"]
        self.assertEqual(recovery.guard_reconciliation(session, "terminal")["action"], "block")
        self.assertEqual(recovery.guard_reconciliation(session, "cluster", {"action": "k8s.apply"})["action"], "block")
        self.assertIsNone(recovery.guard_reconciliation(session, "cluster", {"action": "k8s.get"}))
        self.assertIsNone(recovery.guard_reconciliation("different-session", "terminal"))
        recovery.finish_reconciliation({**EXECUTION, "generation": 2}, "job-one")
        self.assertEqual(recovery.guard_reconciliation(session, "terminal")["action"], "block")
        recovery.finish_reconciliation(EXECUTION, "job-one")
        self.assertIsNone(recovery.guard_reconciliation(session, "terminal"))

    def test_pending_approval_prevents_takeover_even_with_a_terminal_receipt(self):
        with patch.dict(sys.modules, {
            "tools.approval": SimpleNamespace(list_gateway_approvals=lambda _: [{"request_id": "held"}]),
            "tools.clarify_gateway": SimpleNamespace(has_pending=lambda _: False),
            "tools.process_registry": SimpleNamespace(process_registry=SimpleNamespace(list_sessions=lambda **_: [])),
        }):
            receipt = {**RECEIPT, "payload": {"native_text_v1": {"route": "session-route"}}}
            self.assertTrue(recovery.has_live_dependents(receipt))
