import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router-dom";

import { pipelineTone, toneFill } from "../../lib/itemPresentation";
import { healthQuery } from "../../lib/queries";
import { Badge, Icon } from "../ui";
import type { IconName } from "../ui/Icon";

const links: [string, string, IconName][] = [
  ["/", "Home", "inbox"],
  ["/cluster", "Cluster", "server"],
  ["/history", "History", "history"],
  ["/settings", "Settings", "gear"],
];

function ClusterChip() {
  const { data } = useQuery(healthQuery);
  const state = data?.alertPipeline?.state;
  return (
    <Badge>
      <i
        className={`inline-block size-[7px] rounded-full ${toneFill[state ? pipelineTone[state] : "muted"]}`}
      />
      cluster
    </Badge>
  );
}

// Every signed-in page: the brand, the areas and the cluster's state.
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
        <span className="ml-auto">
          <ClusterChip />
        </span>
      </header>
      <main className="px-[22px] pb-[22px] max-[959px]:px-4">
        <Outlet />
      </main>
    </div>
  );
}
