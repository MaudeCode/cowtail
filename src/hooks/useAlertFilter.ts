import { useState, useMemo } from 'react';
import type { Alert, Outcome } from '../types';
import { mockAlerts } from '../data/mockAlerts';

export function useAlertFilter() {
  const [outcomeFilter, setOutcomeFilter] = useState<Outcome | 'all'>('all');
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: '2026-03-18',
    end: '2026-03-22',
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return mockAlerts.filter((a: Alert) => {
      if (outcomeFilter !== 'all' && a.outcome !== outcomeFilter) return false;
      const ts = new Date(a.timestamp);
      if (dateRange.start && ts < new Date(dateRange.start)) return false;
      if (dateRange.end && ts > new Date(dateRange.end + 'T23:59:59Z')) return false;
      return true;
    });
  }, [outcomeFilter, dateRange]);

  const toggleExpanded = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return {
    alerts: filtered,
    outcomeFilter,
    setOutcomeFilter,
    dateRange,
    setDateRange,
    expandedId,
    toggleExpanded,
  };
}
