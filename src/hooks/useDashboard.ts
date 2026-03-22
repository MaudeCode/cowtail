import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Alert, Outcome } from '../types';
import { mockAlerts } from '../data/mockAlerts';

type DatePreset = '24h' | '7d' | '30d' | 'custom';

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getPresetRange(preset: DatePreset): { start: string; end: string } {
  const now = new Date();
  const end = formatDate(now);
  switch (preset) {
    case '24h': {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return { start: formatDate(d), end };
    }
    case '7d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return { start: formatDate(d), end };
    }
    case '30d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return { start: formatDate(d), end };
    }
    case 'custom':
      return { start: '', end: '' };
  }
}

function readUrlParams(): { from?: string; to?: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
  };
}

function writeUrlParams(start: string, end: string) {
  const params = new URLSearchParams();
  if (start) params.set('from', start);
  if (end) params.set('to', end);
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}

export interface AlertGroup {
  alertName: string;
  highestSeverity: Alert['severity'];
  alerts: Alert[];
  latestTimestamp: string;
}

export function useDashboard() {
  // Read URL params on mount
  const urlParams = readUrlParams();

  const [outcomeFilter, setOutcomeFilter] = useState<Outcome | 'all'>('all');
  const [datePreset, setDatePreset] = useState<DatePreset>(
    urlParams.from || urlParams.to ? 'custom' : '7d'
  );
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>(() => {
    if (urlParams.from || urlParams.to) {
      return {
        start: urlParams.from ?? '',
        end: urlParams.to ?? formatDate(new Date()),
      };
    }
    return getPresetRange('7d');
  });
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);

  // Sync URL params when date range changes
  useEffect(() => {
    writeUrlParams(dateRange.start, dateRange.end);
  }, [dateRange]);

  const handlePreset = useCallback((preset: DatePreset) => {
    setDatePreset(preset);
    if (preset !== 'custom') {
      setDateRange(getPresetRange(preset));
    }
  }, []);

  const handleDateChange = useCallback((field: 'start' | 'end', value: string) => {
    setDatePreset('custom');
    setDateRange(prev => ({ ...prev, [field]: value }));
  }, []);

  // Date-filtered alerts (before outcome filter) — used for stats
  const dateFiltered = useMemo(() => {
    return mockAlerts.filter((a: Alert) => {
      const ts = new Date(a.timestamp);
      if (dateRange.start && ts < new Date(dateRange.start)) return false;
      if (dateRange.end && ts > new Date(dateRange.end + 'T23:59:59Z')) return false;
      return true;
    });
  }, [dateRange]);

  // Outcome-filtered alerts — used for the alert list
  const filtered = useMemo(() => {
    if (outcomeFilter === 'all') return dateFiltered;
    return dateFiltered.filter((a: Alert) => a.outcome === outcomeFilter);
  }, [outcomeFilter, dateFiltered]);

  // Group alerts by name
  const groups = useMemo((): AlertGroup[] => {
    const map = new Map<string, Alert[]>();
    for (const a of filtered) {
      const existing = map.get(a.alertName);
      if (existing) {
        existing.push(a);
      } else {
        map.set(a.alertName, [a]);
      }
    }
    return Array.from(map.entries()).map(([alertName, alerts]) => {
      const sorted = alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const severityOrder = { critical: 0, warning: 1, info: 2 } as const;
      const highestSeverity = sorted.reduce((acc, a) => {
        return severityOrder[a.severity] < severityOrder[acc] ? a.severity : acc;
      }, sorted[0].severity);
      return {
        alertName,
        highestSeverity,
        alerts: sorted,
        latestTimestamp: sorted[0].timestamp,
      };
    }).sort((a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime());
  }, [filtered]);

  // Stats — always based on date range, NOT outcome filter
  const stats = useMemo(() => ({
    total: dateFiltered.length,
    fixed: dateFiltered.filter(a => a.outcome === 'fixed').length,
    selfResolved: dateFiltered.filter(a => a.outcome === 'self-resolved').length,
    noise: dateFiltered.filter(a => a.outcome === 'noise').length,
    escalated: dateFiltered.filter(a => a.outcome === 'escalated').length,
  }), [dateFiltered]);

  const toggleGroup = useCallback((name: string) => {
    setExpandedGroup(prev => prev === name ? null : name);
    setExpandedAlert(null);
  }, []);

  const toggleAlert = useCallback((id: string) => {
    setExpandedAlert(prev => prev === id ? null : id);
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
  };
}
