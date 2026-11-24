"""Runbook runs: MaudeUtils scripts the owner starts from Cowtail.

MaudeUtils runs on the Hermes host and stays unexposed. The heartbeat carries its script
catalog to Cowtail; the platform claims each run the owner asks for, starts it on the local
MaudeUtils, and forwards its output to Cowtail in batches, at most one a second, then reports
the exit code.

Env: MAUDEUTILS_URL turns runbook runs on (for example ``http://127.0.0.1:3847``);
MAUDEUTILS_TOKEN is MaudeUtils's bearer token.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

CATALOG_LIMIT = 500
# Characters per output batch; Cowtail takes 64 KB of UTF-16 a batch.
BATCH_CHARS = 32_000
BATCH_SECONDS = 1.0
# An output batch renews the claim's 60-second lease; a quiet script sends an empty one.
RENEW_SECONDS = 20.0
STREAM_TIMEOUT_SECONDS = 120
FAILED = -1
# The runner's clock, apart from the event loop's.
_clock: Callable[[], float] = time.monotonic


def _base_url() -> str | None:
    value = (os.environ.get("MAUDEUTILS_URL") or "").strip().rstrip("/")
    return value or None


def maudeutils_configured() -> bool:
    return _base_url() is not None


def _request(method: str, path: str) -> urllib.request.Request:
    headers = {"accept": "application/json"}
    token = (os.environ.get("MAUDEUTILS_TOKEN") or "").strip()
    if token:
        headers["authorization"] = f"Bearer {token}"
    return urllib.request.Request(f"{_base_url()}{path}", method=method, headers=headers)


def runbook_catalog() -> list[dict[str, Any]]:
    """MaudeUtils's scripts in its own order, as the heartbeat's ``runbook``."""
    with urllib.request.urlopen(_request("GET", "/api/scripts"), timeout=10) as response:
        scripts = json.loads(response.read().decode("utf-8"))
    entries = []
    for script_id, script in list(scripts.items())[:CATALOG_LIMIT]:
        entry: dict[str, Any] = {
            "id": str(script_id)[:200],
            "name": str(script.get("name") or script_id)[:200],
            "category": str(script.get("category") or "other")[:100],
        }
        for key, limit in (("description", 2000), ("icon", 50), ("confirm", 2000)):
            if script.get(key):
                entry[key] = str(script[key])[:limit]
        if script.get("danger") is True:
            entry["danger"] = True
        entries.append(entry)
    return entries


class _Output:
    """Output on its way to Cowtail, sent in numbered batches."""

    def __init__(self, cowtail: Any, run: dict[str, Any], now: float):
        self._cowtail, self._run = cowtail, run
        self._pending: list[str] = []
        self._seq = 0
        self._sent_at = now

    def begin(self) -> None:
        """Tells Cowtail the script is about to start. Cowtail never runs a script again once it
        heard this, so it goes before MaudeUtils is asked, and a failure here starts nothing."""
        self._send("")

    def add(self, text: str, now: float) -> None:
        self._pending.append(text)
        if now - self._sent_at >= BATCH_SECONDS:
            self.flush(now)

    def tick(self, now: float) -> None:
        if self._pending and now - self._sent_at >= BATCH_SECONDS:
            self.flush(now)
        elif now - self._sent_at >= RENEW_SECONDS:
            self._send("")
            self._sent_at = now

    def flush(self, now: float) -> None:
        text = "".join(self._pending)
        self._pending = []
        for start in range(0, len(text), BATCH_CHARS):
            self._send(text[start : start + BATCH_CHARS])
        self._sent_at = now

    def _send(self, text: str) -> None:
        self._cowtail.runbook_output(self._run["id"], self._run["claimToken"], self._seq, text)
        self._seq += 1


def _stream(output: _Output, script_id: str, clock: Callable[[], float]) -> int:
    """Runs the script on MaudeUtils and forwards its events; returns its exit code."""
    request = _request("POST", f"/api/run-stream/{urllib.parse.quote(script_id, safe='')}")
    with urllib.request.urlopen(request, timeout=STREAM_TIMEOUT_SECONDS) as response:
        for line in response:
            if not line.strip():
                continue
            event = json.loads(line)
            now = clock()
            kind = event.get("type")
            if kind in ("stdout", "stderr"):
                output.add(str(event.get("data") or ""), now)
            elif kind == "heartbeat":
                output.tick(now)
            elif kind == "exit":
                code = event.get("exitCode")
                return code if isinstance(code, int) and not isinstance(code, bool) else FAILED
            elif kind == "error":
                output.add(f"\nMaudeUtils could not run the script: {event.get('error')}\n", now)
                return FAILED
    output.add("\nMaudeUtils ended the run without an exit code.\n", clock())
    return FAILED


def _http_error(error: urllib.error.HTTPError) -> str:
    try:
        detail = json.loads(error.read().decode("utf-8", errors="replace")).get("error")
    except (ValueError, AttributeError):
        detail = None
    finally:
        error.close()
    return f"MaudeUtils refused the run: HTTP {error.code}" + (f" ({detail})" if detail else "")


def execute_run(cowtail: Any, run: dict[str, Any]) -> int:
    """Runs one claimed run to its end and reports it to Cowtail. A run MaudeUtils refuses or
    cannot start reports exit code -1 with the reason as its output."""
    clock = _clock
    output = _Output(cowtail, run, clock())
    output.begin()
    try:
        exit_code = _stream(output, str(run["scriptId"]), clock)
    except urllib.error.HTTPError as error:
        output.add(f"{_http_error(error)}\n", clock())
        exit_code = FAILED
    except (urllib.error.URLError, OSError, ValueError) as error:
        output.add(f"MaudeUtils is unreachable: {getattr(error, 'reason', error)}\n", clock())
        exit_code = FAILED
    output.flush(clock())
    cowtail.complete_runbook_run(run["id"], run["claimToken"], exit_code)
    return exit_code
