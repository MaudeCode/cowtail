import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../convex/_generated/api";
import type { Outcome } from "../types";
import type { ConvexAlert } from "../lib/alerts";
import { toAlert } from "../lib/alerts";
import { parseLocalDate, parseLocalDateEnd, formatDateLocal } from "../lib/dates";

type DatePreset = "24h" | "7d" | "30d" | "custom";

type Alert = ReturnType<typeof toAlert>;

function formatDate(d: Date): string {
  return formatDateLocal(d);
}

function getPresetRange(preset: DatePreset): { start: string; end: string } {
  const now = new Date();
  const end = formatDate(now);
  switch (preset) {
    case "24h": {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return { start: formatDate(d), end };
    }
    case "7d": {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return { start: formatDate(d), end };
    }
    case "30d": {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return { start: formatDate(d), end };
    }
    case "custom":
      return { start: "", end: "" };
  }
}

function readUrlParams(): { from?: string; to?: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  };
}

function writeUrlParams(start: string, end: string) {
  const params = new URLSearchParams();
  if (start) params.set("from", start);
  if (end) params.set("to", end);
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

export interface AlertGroup {
  alertName: string;
  highestSeverity: Alert["severity"];
  alerts: Alert[];
  latestTimestamp: string;
}

export function useDashboard() {
  const urlParams = readUrlParams();

  const [outcomeFilter, setOutcomeFilter] = useState<Outcome | "all">("all");
  const [datePreset, setDatePreset] = useState<DatePreset>(
    urlParams.from || urlParams.to ? "custom" : "7d",
  );
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>(() => {
    if (urlParams.from || urlParams.to) {
      return {
        start: urlParams.from ?? "",
        end: urlParams.to ?? formatDate(new Date()),
      };
    }
    return getPresetRange("7d");
  });
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);

  useEffect(() => {
    writeUrlParams(dateRange.start, dateRange.end);
  }, [dateRange]);

  // Query Convex for alerts in the date range
  const from = dateRange.start ? parseLocalDate(dateRange.start).getTime() : 0;
  const to = dateRange.end ? parseLocalDateEnd(dateRange.end).getTime() : Date.now();

  const { data: convexAlerts } = useQuery(convexQuery(api.alerts.getByTimeRange, { from, to }));

  // Normalize to frontend Alert type
  const allAlerts = useMemo(() => {
    if (!convexAlerts) return [];
    return (convexAlerts as ConvexAlert[]).map(toAlert);
  }, [convexAlerts]);

  const handlePreset = useCallback((preset: DatePreset) => {
    setDatePreset(preset);
    if (preset !== "custom") {
      setDateRange(getPresetRange(preset));
    }
  }, []);

  const handleDateChange = useCallback((field: "start" | "end", value: string) => {
    setDatePreset("custom");
    setDateRange((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Outcome-filtered alerts
  const filtered = useMemo(() => {
    if (outcomeFilter === "all") return allAlerts;
    return allAlerts.filter((a) => a.outcome === outcomeFilter);
  }, [outcomeFilter, allAlerts]);

  // Group alerts by name
  const groups = useMemo((): AlertGroup[] => {
    const map = new Map<string, Alert[]>();
    for (const a of filtered) {
      const existing = map.get(a.alertName);
      if (existing) existing.push(a);
      else map.set(a.alertName, [a]);
    }
    return Array.from(map.entries())
      .map(([alertName, alerts]) => {
        const sorted = alerts.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
        const severityOrder = { critical: 0, warning: 1, info: 2 } as const;
        const highestSeverity = sorted.reduce((acc, a) => {
          return (severityOrder[a.severity] ?? 99) < (severityOrder[acc] ?? 99) ? a.severity : acc;
        }, sorted[0].severity);
        return { alertName, highestSeverity, alerts: sorted, latestTimestamp: sorted[0].timestamp };
      })
      .sort(
        (a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime(),
      );
  }, [filtered]);

  // Stats — always based on ALL alerts in date range, not outcome filter
  const stats = useMemo(
    () => ({
      total: allAlerts.length,
      fixed: allAlerts.filter((a) => a.outcome === "fixed").length,
      selfResolved: allAlerts.filter((a) => a.outcome === "self-resolved").length,
      noise: allAlerts.filter((a) => a.outcome === "noise").length,
      escalated: allAlerts.filter((a) => a.outcome === "escalated").length,
    }),
    [allAlerts],
  );

  const toggleGroup = useCallback((name: string) => {
    setExpandedGroup((prev) => (prev === name ? null : name));
    setExpandedAlert(null);
  }, []);

  const toggleAlert = useCallback((id: string) => {
    setExpandedAlert((prev) => (prev === id ? null : id));
  }, []);

  return {
    alerts: filtered,
    groups,
    stats,
    outcomeFilter,
    setOutcomeFilter,
    datePreset,
    handlePreset,
    dateRange,
    handleDateChange,
    expandedGroup,
    toggleGroup,
    expandedAlert,
    toggleAlert,
    isLoading: !convexAlerts,
  };
}
