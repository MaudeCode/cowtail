import type { HealthResponse } from "@maudecode/cowtail-protocol";
import { useEffect, useState } from "react";

import { getConfig } from "../../lib/config";
import { formatAge } from "../../lib/format";
import { pipelineLabel, pipelineTone, toneText, type Tone } from "../../lib/itemPresentation";
import { KeyValue, ProgressBar, Section, SectionLabel } from "../ui";

const cephTone: Record<HealthResponse["cephStatus"], Tone> = {
  HEALTH_OK: "ok",
  HEALTH_WARN: "today",
  HEALTH_ERR: "now",
};

function Pipeline({ health }: { health: HealthResponse }) {
  const pipeline = health.alertPipeline;
  if (!pipeline) return null;
  return (
    <span className={toneText[pipelineTone[pipeline.state]]}>{pipelineLabel[pipeline.state]}</span>
  );
}

function watchdogAge(health: HealthResponse) {
  const at = health.alertPipeline?.lastWatchdogAt;
  return at === undefined ? "never" : `${formatAge(at)} ago`;
}

function Nodes({ health }: { health: HealthResponse }) {
  return health.nodes.map((node) => (
    <div key={node.name} className="border-b border-line py-1.5">
      <div className="flex justify-between font-mono text-[0.75rem]">
        <span>{node.name}</span>
        <span className={node.status === "Ready" ? "text-ok" : "text-accent-text"}>
          {node.status}
        </span>
      </div>
      <ProgressBar label="CPU" value={node.cpu} />
      <ProgressBar label="MEM" value={node.memory} />
    </div>
  ));
}

function Storage({ health }: { health: HealthResponse }) {
  const percent = health.storageTotal > 0 ? (health.storageUsed / health.storageTotal) * 100 : 0;
  return (
    <ProgressBar
      wide
      label="Storage"
      value={Math.round(percent)}
      display={`${health.storageUsed} / ${health.storageTotal} ${health.storageUnit}`}
    />
  );
}

function CephLink({ health }: { health: HealthResponse }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    getConfig().then((config) => setUrl(config.cephDashboardUrl ?? null));
  }, []);
  if (health.cephStatus === "HEALTH_OK" || !url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent-text hover:underline"
    >
      Ceph dashboard
    </a>
  );
}

// Home shows the cluster as one section; the Cluster page splits it into pipeline, nodes
// and Ceph.
export default function ClusterHealth({
  health,
  layout,
}: {
  health: HealthResponse;
  layout: "home" | "cluster";
}) {
  const ceph = <span className={toneText[cephTone[health.cephStatus]]}>{health.cephStatus}</span>;

  if (layout === "home") {
    return (
      <Section
        label="Cluster"
        detail={
          health.alertPipeline && (
            <span>
              <Pipeline health={health} /> · Watchdog {watchdogAge(health)}
            </span>
          )
        }
      >
        <Nodes health={health} />
        <KeyValue label="Ceph">
          {ceph} · {health.cephMessage}
        </KeyValue>
        <CephLink health={health} />
        <Storage health={health} />
      </Section>
    );
  }

  const ready = health.nodes.filter((node) => node.status === "Ready").length;
  return (
    <div>
      <Section label="Alert pipeline" detail={<Pipeline health={health} />}>
        <KeyValue label="Last Watchdog">
          <span className="font-mono">{watchdogAge(health)}</span>
        </KeyValue>
      </Section>
      <SectionLabel label="Nodes" detail={`${ready} ready`} />
      <Nodes health={health} />
      <Section label="Ceph" detail={ceph}>
        <KeyValue label="Status">{health.cephMessage}</KeyValue>
        <CephLink health={health} />
        <Storage health={health} />
      </Section>
    </div>
  );
}
