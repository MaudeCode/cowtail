import { healthResponseSchema } from "@maudecode/cowtail-protocol";
import { useState, useEffect, useCallback } from "react";
import type { ClusterHealth } from "../types";

async function fetchClusterHealth(): Promise<ClusterHealth> {
  const res = await fetch("/actions/api/health");
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const error =
      body && typeof body.error === "string" ? body.error : `Health endpoint failed: ${res.status}`;
    throw new Error(error);
  }

  const parsed = healthResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Health endpoint returned an invalid payload");
  }

  return parsed.data;
}

export function useClusterHealth(refreshIntervalMs = 30000) {
  const [health, setHealth] = useState<ClusterHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchClusterHealth();
      setHealth(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [refresh, refreshIntervalMs]);

  return { health, error };
}
