"""Runbook runs against a fake MaudeUtils stream server on localhost and the fake Cowtail API."""

from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from test_platform import PlatformTest

TOKEN = "maude-token"
SCRIPTS = {
    "gateway-restart": {
        "name": "Restart Hermes Gateway",
        "description": "Restart the gateway",
        "command": "/srv/scripts/gateway-restart.sh",
        "icon": "🔄",
        "category": "hermes",
        "confirm": "Restart the Hermes gateway?",
        "danger": True,
    },
    "disk-usage": {
        "name": "Disk usage",
        "command": "df -h",
        "confirm": None,
        "icon": "💽",
        "category": "diagnostics",
    },
}


class FakeMaudeUtils(BaseHTTPRequestHandler):
    """GET /api/scripts, and POST /api/run-stream/<id> streaming ``events`` as NDJSON."""

    events: list[dict] = []

    def do_GET(self):
        if self.path == "/api/scripts":
            self._json(200, SCRIPTS)
        else:
            self._json(404, {"error": "Not found"})

    def do_POST(self):
        if self.headers.get("authorization") != f"Bearer {TOKEN}":
            return self._json(401, {"error": "Unauthorized — enter your token above"})
        script_id = self.path.removeprefix("/api/run-stream/")
        if script_id not in SCRIPTS:
            return self._json(404, {"error": "Script not found"})
        self.send_response(200)
        self.send_header("content-type", "application/x-ndjson")
        self.end_headers()
        for seq, event in enumerate(self.events, start=1):
            self.wfile.write(f"{json.dumps({**event, 'seq': seq})}\n".encode())
            self.wfile.flush()

    def _json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class RunbookTest(PlatformTest):
    def setUp(self):
        super().setUp()
        server = ThreadingHTTPServer(("127.0.0.1", 0), FakeMaudeUtils)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        env = {"MAUDEUTILS_URL": f"http://127.0.0.1:{server.server_port}", "MAUDEUTILS_TOKEN": TOKEN}
        environ = patch.dict(os.environ, env)
        environ.start()
        self.addCleanup(environ.stop)
        self.runbook = __import__("hermes_plugins.cowtail.runbook", fromlist=["runbook"])
        FakeMaudeUtils.events = []

    def run_claimed(self, script_id: str, clock_ticks: list[float]):
        """Claims one run of `script_id` through the adapter and waits for it to finish."""
        self.cowtail.runs = [{"id": "run-1", "scriptId": script_id, "claimToken": "token-1", "attempts": 1}]

        async def run():
            with patch.object(self.runbook, "_clock", side_effect=clock_ticks):
                await self.adapter.start_runbook_runs()
                for task in list(self.adapter._runs):
                    await task

        self.run_async(run())

    def runbook_calls(self):
        return [(path, body) for _, path, body in self.cowtail.requests if "/runbook-runs/run-1/" in path]

    def test_the_heartbeat_carries_the_maudeutils_catalog(self):
        snapshot = self.platform.collect_snapshot()

        self.assertEqual(
            snapshot["runbook"],
            [
                {
                    "id": "gateway-restart",
                    "name": "Restart Hermes Gateway",
                    "category": "hermes",
                    "description": "Restart the gateway",
                    "icon": "🔄",
                    "confirm": "Restart the Hermes gateway?",
                    "danger": True,
                },
                {"id": "disk-usage", "name": "Disk usage", "category": "diagnostics", "icon": "💽"},
            ],
        )

    def test_a_claimed_run_streams_its_output_in_batches_then_reports_the_exit_code(self):
        FakeMaudeUtils.events = [
            {"type": "start", "command": "df -h"},
            {"type": "stdout", "data": "Filesystem  Size\n"},
            {"type": "stderr", "data": "warning: slow disk\n"},
            {"type": "heartbeat", "elapsedMs": 1500},
            {"type": "stdout", "data": "/dev/nvme0  916G\n"},
            {"type": "exit", "exitCode": 0, "durationMs": 1700},
        ]

        # Read once at the start, once per event after `start`, and once for the last batch.
        self.run_claimed("disk-usage", [0.0, 0.0, 0.2, 0.4, 1.5, 1.6, 1.7, 1.7])

        self.assertEqual(
            self.runbook_calls(),
            [
                (
                    "/api/hermes/runbook-runs/run-1/output",
                    {"claimToken": "token-1", "seq": 0, "text": "Filesystem  Size\nwarning: slow disk\n"},
                ),
                (
                    "/api/hermes/runbook-runs/run-1/output",
                    {"claimToken": "token-1", "seq": 1, "text": "/dev/nvme0  916G\n"},
                ),
                ("/api/hermes/runbook-runs/run-1/complete", {"claimToken": "token-1", "exitCode": 0}),
            ],
        )

    def test_a_run_maudeutils_refuses_reports_a_failed_exit(self):
        cases = [
            ("unknown-script", {}, "MaudeUtils refused the run: HTTP 404 (Script not found)\n"),
            (
                "disk-usage",
                {"MAUDEUTILS_TOKEN": "stale"},
                "MaudeUtils refused the run: HTTP 401 (Unauthorized — enter your token above)\n",
            ),
        ]
        for script_id, env, message in cases:
            with self.subTest(script_id=script_id), patch.dict(os.environ, env):
                self.cowtail.requests.clear()

                self.run_claimed(script_id, [0.0, 0.1, 0.2])

                self.assertEqual(
                    self.runbook_calls(),
                    [
                        (
                            "/api/hermes/runbook-runs/run-1/output",
                            {"claimToken": "token-1", "seq": 0, "text": message},
                        ),
                        ("/api/hermes/runbook-runs/run-1/complete", {"claimToken": "token-1", "exitCode": -1}),
                    ],
                )
