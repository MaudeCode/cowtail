import type { MaintenanceWindowStartRequest } from "@maudecode/cowtail-protocol";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { formatDuration } from "../../lib/format";
import { maintenanceScope } from "../../lib/itemPresentation";
import {
  maintenanceQuery,
  sourcesQuery,
  useEndMaintenance,
  useStartMaintenance,
} from "../../lib/queries";
import { useNow } from "../../lib/useNow";
import { Icon, IconButton } from "../ui";
import { ActionError } from "../items/ItemActions";

const MINUTE = 60_000;
const presets = [
  ["30m", 30 * MINUTE],
  ["1h", 60 * MINUTE],
  ["2h", 120 * MINUTE],
  ["4h", 240 * MINUTE],
] as const;

type AlertScope = "all" | "namespace" | "alertname";
const alertScopes: [AlertScope, string][] = [
  ["all", "All alerts"],
  ["namespace", "A namespace"],
  ["alertname", "An alert name"],
];

const field =
  "h-[26px] min-w-0 rounded-lg border border-gray-200 bg-bg px-2 text-[0.75rem] text-txt";

// The wrench in the top bar and the dialog it opens.
export function MaintenanceButton() {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <IconButton
        icon="wrench"
        label="Start a maintenance window"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      />
      {open && <MaintenanceDialog onClose={() => setOpen(false)} />}
    </span>
  );
}

// A title, a length, and what to silence: all alerts, one namespace or alert name, and any
// other sources to hold back.
function MaintenanceDialog({ onClose }: { onClose: () => void }) {
  const start = useStartMaintenance();
  const sources = useQuery(sourcesQuery);
  const [title, setTitle] = useState("");
  const [preset, setPreset] = useState<string>("1h");
  const [customMinutes, setCustomMinutes] = useState("");
  const [scope, setScope] = useState<AlertScope | null>("all");
  const [scopeValue, setScopeValue] = useState("");
  const [held, setHeld] = useState<string[]>([]);

  const durationMs =
    preset === "custom"
      ? Number(customMinutes) * MINUTE
      : (presets.find(([key]) => key === preset)?.[1] ?? 0);
  // A namespace or alert name needs its value; with no alert scope, a source.
  const scopeReady = scope === "all" || (scope !== null && scopeValue.trim() !== "");
  const valid =
    title.trim() !== "" &&
    Number.isInteger(durationMs) &&
    durationMs >= MINUTE &&
    (scope === null ? held.length > 0 : scopeReady);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const request: MaintenanceWindowStartRequest = {
      title: title.trim(),
      durationMs,
      matchers:
        scope === "namespace" || scope === "alertname"
          ? [{ label: scope, value: scopeValue.trim() }]
          : [],
      sources: scope === "all" ? [...held, "alertmanager"] : held,
    };
    start.mutate(request, { onSuccess: onClose });
  };

  const choices = (sources.data ?? []).filter((source) => source !== "alertmanager");
  return (
    <dialog
      open
      aria-label="Maintenance window"
      onKeyDown={(event) => event.key === "Escape" && onClose()}
      className="absolute top-full right-0 left-auto z-20 m-0 mt-1.5 max-h-[calc(100dvh-64px)] w-[320px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-[10px] border border-gray-200 bg-surface-2 px-3 pt-3 text-left text-txt shadow-[0_14px_34px_#000c]"
    >
      <form onSubmit={submit} className="grid gap-2">
        <h3 className="text-[0.9rem] font-semibold">Maintenance window</h3>
        <input
          aria-label="Title"
          placeholder="Cluster upgrade"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={field}
        />
        <fieldset className="flex overflow-hidden rounded-lg border border-gray-200">
          <legend className="sr-only">Length</legend>
          {[...presets.map(([key]) => key), "custom"].map((key) => (
            <label
              key={key}
              className={`flex-1 cursor-pointer py-1 text-center text-[0.7rem] has-[:focus-visible]:outline-2 ${preset === key ? "bg-surface font-semibold text-txt" : "text-gray-600"}`}
            >
              <input
                type="radio"
                name="maintenance-length"
                className="sr-only"
                checked={preset === key}
                onChange={() => setPreset(key)}
              />
              {key === "custom" ? "Custom" : key}
            </label>
          ))}
        </fieldset>
        {preset === "custom" && (
          <label className="flex items-center gap-2 text-[0.75rem]">
            Minutes
            <input
              type="number"
              min={1}
              step={1}
              value={customMinutes}
              onChange={(event) => setCustomMinutes(event.target.value)}
              className={`${field} flex-1 font-mono`}
            />
          </label>
        )}
        <div>
          <h4 className="border-b border-gray-200 pt-1.5 pb-1 font-mono text-[0.6rem] font-normal uppercase tracking-[0.13em] text-gray-600">
            Silence
          </h4>
          {alertScopes.map(([key, label]) => (
            <div key={key} className="border-b border-line py-1">
              {/* One alert scope at a time; choosing it again clears it. */}
              <label className="flex w-full cursor-pointer items-center justify-between text-[0.8rem] has-[:focus-visible]:outline-2">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={scope === key}
                  onChange={() => setScope(scope === key ? null : key)}
                />
                {label}
                {scope === key && <Icon name="check" className="size-3.5 text-ok" />}
              </label>
              {scope === key && key !== "all" && (
                <input
                  aria-label={key === "namespace" ? "Namespace" : "Alert name"}
                  value={scopeValue}
                  onChange={(event) => setScopeValue(event.target.value)}
                  className={`${field} mt-1 w-full font-mono`}
                />
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-1 text-[0.8rem]">
            Sources
            <span className="flex flex-wrap justify-end gap-1">
              {choices.map((source) => {
                const on = held.includes(source);
                return (
                  <button
                    key={source}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setHeld(on ? held.filter((entry) => entry !== source) : [...held, source])
                    }
                    className={`cursor-pointer rounded-full border px-1.5 font-mono text-[0.65rem] leading-4 ${on ? "border-gray-400 text-txt" : "border-gray-200 text-gray-600"}`}
                  >
                    {source}
                  </button>
                );
              })}
            </span>
          </div>
        </div>
        <p className="text-[0.7rem] text-gray-600">Cowtail's own watchdog items still push.</p>
        <ActionError error={start.error} />
        {/* On a short screen the body scrolls under the submit, which stays in view. */}
        <div className="sticky bottom-0 bg-surface-2 pb-3">
          <button
            type="submit"
            disabled={!valid || start.isPending}
            aria-busy={start.isPending}
            className="h-8 w-full cursor-pointer rounded-[7px] border border-accent bg-accent text-[0.75rem] font-semibold text-txt disabled:cursor-default disabled:opacity-50"
          >
            Start {durationMs >= MINUTE ? formatDuration(durationMs) : ""} window
          </button>
        </div>
      </form>
    </dialog>
  );
}

// One banner per running window, above Needs you: what it silences, the time left, and an
// End window button.
export function MaintenanceBanners() {
  const windows = useQuery(maintenanceQuery);
  const end = useEndMaintenance();
  const now = useNow();
  return (
    <>
      {windows.data?.active.map((window) => (
        <div
          key={window.id}
          className="mt-2.5 flex items-center gap-2 rounded-lg border border-[#d4880a80] bg-[#d4880a1a] px-[9px] py-[7px]"
        >
          <Icon name="wrench" className="size-3.5 text-warn" />
          <div className="min-w-0 flex-1">
            <div className="font-medium [overflow-wrap:anywhere]">{window.title}</div>
            <div className="text-[0.7rem] text-gray-600">
              {maintenanceScope(window)} silenced ·{" "}
              {formatDuration(Math.ceil((window.endsAt - now) / MINUTE) * MINUTE)} left
            </div>
            {window.silenceError && (
              <p role="alert" className="text-[0.7rem] text-accent-text">
                Alertmanager did not silence these alerts: {window.silenceError}
              </p>
            )}
          </div>
          <IconButton icon="stop" label="End window" onClick={() => end.mutate(window.id)} />
        </div>
      ))}
      <ActionError error={end.error} />
    </>
  );
}
