import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router-dom";

import { hermesLevelTone, pipelineTone, type Tone } from "../../lib/itemPresentation";
import { healthQuery, hermesStatusQuery } from "../../lib/queries";
import { Badge, Icon, StatusDot } from "../ui";
import type { IconName } from "../ui/Icon";
import { MaintenanceButton } from "./Maintenance";

const links: [string, string, IconName][] = [
  ["/", "Home", "inbox"],
  ["/cluster", "Cluster", "server"],
  ["/history", "History", "history"],
  ["/hermes", "Hermes", "spark"],
  ["/settings", "Settings", "gear"],
];

function StatusChip({ label, tone }: { label: string; tone: Tone }) {
  return (
    <Badge className="max-[599px]:border-transparent max-[599px]:px-0.5">
      <StatusDot tone={tone} />
      {/* Below 600 px the chips keep their dots; the labels stay for screen readers. */}
      <span className="max-[599px]:sr-only">{label}</span>
    </Badge>
  );
}

function ClusterChip() {
  const state = useQuery(healthQuery).data?.alertPipeline?.state;
  return <StatusChip label="cluster" tone={state ? pipelineTone[state] : "muted"} />;
}

function HermesChip() {
  const level = useQuery(hermesStatusQuery).data?.status?.statusLevel;
  return <StatusChip label="hermes" tone={level ? hermesLevelTone[level] : "muted"} />;
}

// Every signed-in page: the brand, the areas, and the cluster's and Hermes's state.
export default function Layout() {
  return (
    <div className="min-h-screen bg-bg text-[0.8125rem] text-txt">
      <header className="flex items-center gap-[22px] border-b border-line px-[22px] py-3 max-[959px]:gap-4 max-[959px]:px-4">
        <span className="font-bold tracking-[0.22em] text-accent-text">COWTAIL</span>
        <nav className="flex items-center gap-[22px] max-[959px]:gap-3.5">
          {links.map(([to, label, icon]) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-1.5 ${isActive ? "font-semibold text-txt" : "text-gray-600 hover:text-txt"}`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={icon} />
                  {/* Below 960 px only the current page keeps its label on screen. */}
                  <span className={isActive ? "" : "max-[959px]:sr-only"}>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <span className="ml-auto flex items-center gap-1.5">
          <ClusterChip />
          <HermesChip />
          <MaintenanceButton />
        </span>
      </header>
      <main className="px-[22px] pb-[22px] max-[959px]:px-4">
        <Outlet />
      </main>
    </div>
  );
}
