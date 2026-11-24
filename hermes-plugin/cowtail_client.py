"""Small HTTP client for Cowtail service APIs."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class CowtailError(RuntimeError):
    """Raised when Cowtail returns an error or the client is misconfigured."""


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name, default)
    if value is None:
        return None
    value = value.strip()
    return value or None


def cowtail_available() -> bool:
    return _env("COWTAIL_API_BASE") is not None and _env("COWTAIL_WORKER_TOKEN") is not None


def cowtail_platform_enabled() -> bool:
    """The Cowtail platform runs only where the owner turned it on, not wherever the tool works."""
    enabled = (_env("COWTAIL_PLATFORM_ENABLED") or "").lower() in ("1", "true", "yes")
    return enabled and cowtail_available()


class CowtailClient:
    """Cowtail HTTP API client.

    Secret values are read from environment and never returned by methods.
    """

    def __init__(self, api_base: str | None = None, worker_token: str | None = None, worker_id: str | None = None):
        self.api_base = (api_base or _env("COWTAIL_API_BASE") or "https://cowtail-actions.example.com").rstrip("/")
        self.worker_token = worker_token or _env("COWTAIL_WORKER_TOKEN")
        self.worker_id = worker_id or _env("COWTAIL_WORKER_ID") or "hermes-default-gateway"

    def _headers(self) -> dict[str, str]:
        if not self.worker_token:
            raise CowtailError("COWTAIL_WORKER_TOKEN is not configured")
        return {
            "authorization": f"Bearer {self.worker_token}",
            "content-type": "application/json",
            "accept": "application/json",
        }

    def _url(self, path: str, query: dict[str, Any] | None = None) -> str:
        url = f"{self.api_base}/{path.lstrip('/')}"
        if query:
            clean = {k: v for k, v in query.items() if v is not None}
            if clean:
                url = f"{url}?{urllib.parse.urlencode(clean)}"
        return url

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None, query: dict[str, Any] | None = None) -> dict[str, Any]:
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            self._url(path, query),
            data=data,
            method=method,
            headers=self._headers(),
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", errors="replace")
            raise CowtailError(f"Cowtail HTTP {error.code}: {raw[:500]}") from error
        except urllib.error.URLError as error:
            raise CowtailError(f"Cowtail request failed: {error.reason}") from error

        if not raw:
            return {"ok": True}
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and parsed.get("ok") is False:
            raise CowtailError(str(parsed.get("error") or "Cowtail returned ok=false"))
        if not isinstance(parsed, dict):
            raise CowtailError("Cowtail returned a non-object JSON payload")
        return parsed

    def status(self) -> dict[str, Any]:
        return {
            "api_base": self.api_base,
            "worker_token_configured": bool(self.worker_token),
            "worker_id": self.worker_id,
        }

    def get_alert(self, alert_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/alerts/{alert_id}")

    def query_alerts(self, from_ms: int | None = None, to_ms: int | None = None, outcome: str | None = None, severity: str | None = None) -> dict[str, Any]:
        return self._request("GET", "/api/alerts", query={"from": from_ms, "to": to_ms, "outcome": outcome, "severity": severity})

    def write_alert(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/alerts", payload)

    def write_fix(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/fixes", payload)

    def claim_job(self, job_id: str | None = None, lease_seconds: int = 900) -> dict[str, Any]:
        return self._request("POST", "/api/investigation-jobs/claim", {"jobId": job_id, "workerId": self.worker_id, "leaseSeconds": lease_seconds})

    def get_job(self, job_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/investigation-jobs/{job_id}")

    def renew_job(self, job_id: str, claim_token: str, lease_seconds: int = 900) -> dict[str, Any]:
        return self._request("POST", f"/api/investigation-jobs/{job_id}/renew", {"claimToken": claim_token, "leaseSeconds": lease_seconds})

    def complete_job(self, job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/investigation-jobs/{job_id}/complete", payload)

    def fail_job(self, job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/investigation-jobs/{job_id}/fail", payload)

    def requeue_job(self, job_id: str) -> dict[str, Any]:
        return self._request("POST", f"/api/investigation-jobs/{job_id}/requeue", {})

    def deadletters(self, limit: int = 50) -> dict[str, Any]:
        return self._request("GET", "/api/investigation-jobs/deadletters", query={"limit": limit})

    def create_item(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/items", payload)

    def claim_response(self, lease_seconds: int = 60) -> dict[str, Any]:
        return self._request("POST", "/api/hermes/responses/claim", {"workerId": self.worker_id, "leaseSeconds": lease_seconds})

    def complete_response(self, response_id: str, claim_token: str, text: str) -> dict[str, Any]:
        return self._request("POST", f"/api/hermes/responses/{response_id}/complete", {"claimToken": claim_token, "text": text})

    def fail_response(self, response_id: str, claim_token: str, reason: str) -> dict[str, Any]:
        return self._request("POST", f"/api/hermes/responses/{response_id}/fail", {"claimToken": claim_token, "reason": reason})

    def heartbeat(self, snapshot: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/hermes/heartbeat", snapshot)

    def claim_runbook_run(self, lease_seconds: int = 60) -> dict[str, Any]:
        return self._request("POST", "/api/hermes/runbook-runs/claim", {"workerId": self.worker_id, "leaseSeconds": lease_seconds})

    def runbook_output(self, run_id: str, claim_token: str, seq: int, text: str) -> dict[str, Any]:
        return self._request("POST", f"/api/hermes/runbook-runs/{run_id}/output", {"claimToken": claim_token, "seq": seq, "text": text})

    def complete_runbook_run(self, run_id: str, claim_token: str, exit_code: int) -> dict[str, Any]:
        return self._request("POST", f"/api/hermes/runbook-runs/{run_id}/complete", {"claimToken": claim_token, "exitCode": exit_code})

    def claim_postmortem_request(self, lease_seconds: int = 60) -> dict[str, Any]:
        return self._request("POST", "/api/hermes/postmortem-requests/claim", {"workerId": self.worker_id, "leaseSeconds": lease_seconds})

    def postmortem_delivered(self, request_id: str, claim_token: str) -> dict[str, Any]:
        return self._request("POST", f"/api/hermes/postmortem-requests/{request_id}/delivered", {"claimToken": claim_token})

    def post_postmortem(self, incident_id: str, text: str, request_id: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"text": text}
        if request_id:
            body["requestId"] = request_id
        return self._request("POST", f"/api/hermes/incidents/{incident_id}/postmortem", body)
