import { useState, useEffect, useCallback } from 'react';
import type { ClusterHealth, NodeHealth } from '../types';

interface PromResult {
  metric: Record<string, string>;
  value: [number, string];
}

interface PromResponse {
  status: string;
  data: { resultType: string; result: PromResult[] };
}

async function promQuery(query: string): Promise<PromResult[]> {
  const url = `/prometheus/api/v1/query?query=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Prometheus query failed: ${res.status}`);
  const data: PromResponse = await res.json();
  if (data.status !== 'success') throw new Error('Prometheus query error');
  return data.data.result;
}

function val(r: PromResult): number {
  return parseFloat(r.value[1]);
}

async function fetchClusterHealth(): Promise<ClusterHealth> {
  const [cpuResults, memResults, nodeStatus, cephHealth, cephTotal, cephUsed] =
    await Promise.all([
      promQuery(
        '(1 - avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))) * 100 * on(instance) group_left(nodename) node_uname_info'
      ),
      promQuery(
        '(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100 * on(instance) group_left(nodename) node_uname_info'
      ),
      promQuery(
        'kube_node_status_condition{condition="Ready",status="true"}'
      ),
      promQuery('ceph_health_status'),
      promQuery('ceph_cluster_total_bytes'),
      promQuery('ceph_cluster_total_used_bytes'),
    ]);

  // Build node readiness map
  const readyNodes = new Set(
    nodeStatus.filter((r) => val(r) === 1).map((r) => r.metric.node)
  );

  // Build CPU map by nodename
  const cpuMap = new Map<string, number>();
  for (const r of cpuResults) {
    cpuMap.set(r.metric.nodename, Math.round(val(r)));
  }

  // Build memory map by nodename
  const memMap = new Map<string, number>();
  for (const r of memResults) {
    memMap.set(r.metric.nodename, Math.round(val(r)));
  }

  // Combine into nodes array
  const allNodeNames = new Set([...cpuMap.keys(), ...memMap.keys()]);
  const nodes: NodeHealth[] = Array.from(allNodeNames)
    .sort()
    .map((name) => ({
      name,
      status: readyNodes.has(name) ? ('Ready' as const) : ('NotReady' as const),
      cpu: cpuMap.get(name) ?? 0,
      memory: memMap.get(name) ?? 0,
    }));

  // Ceph
  const cephStatusVal = cephHealth.length > 0 ? Math.round(val(cephHealth[0])) : 0;
  const cephStatusMap: Record<number, 'HEALTH_OK' | 'HEALTH_WARN' | 'HEALTH_ERR'> = {
    0: 'HEALTH_OK',
    1: 'HEALTH_WARN',
    2: 'HEALTH_ERR',
  };

  const totalTiB = cephTotal.length > 0 ? val(cephTotal[0]) / 1024 ** 4 : 0;
  const usedTiB = cephUsed.length > 0 ? val(cephUsed[0]) / 1024 ** 4 : 0;

  return {
    nodes,
    cephStatus: cephStatusMap[cephStatusVal] ?? 'HEALTH_OK',
    cephMessage: cephStatusVal === 0 ? 'All PGs active+clean' : 'Degraded — check Ceph dashboard',
    storageTotal: parseFloat(totalTiB.toFixed(2)),
    storageUsed: parseFloat(usedTiB.toFixed(2)),
    storageUnit: 'TiB',
  };
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
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [refresh, refreshIntervalMs]);

  return { health, error };
}
