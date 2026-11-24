import type { ItemActionRequest, ItemRecord } from "@maudecode/cowtail-protocol";
import { useState, type FormEvent } from "react";

import { errorMessage } from "../../lib/api";
import { formatReturnTime } from "../../lib/format";
import { useItemAction } from "../../lib/queries";
import { snoozePresets } from "../../lib/snooze";
import { Icon, IconButton } from "../ui";

const optionButton =
  "h-[26px] cursor-pointer rounded-[7px] border border-gray-200 bg-surface-2 px-2 text-[0.7rem] text-txt disabled:cursor-default disabled:opacity-50";

// The controls for what an item still offers. A `choose` action shows its options as text;
// every other action is an icon button.
export default function ItemActions({ item }: { item: ItemRecord }) {
  const action = useItemAction(item.id);
  const [panel, setPanel] = useState<"reply" | "snooze" | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const actions = item.availableActions ?? [];
  if (actions.length === 0) return null;

  const send = (key: string, request: ItemActionRequest) => {
    setBusy(key);
    action.mutate(request, {
      onSuccess: () => {
        setPanel(null);
        setReply("");
      },
      onSettled: () => setBusy(null),
    });
  };
  const sendReply = (event: FormEvent) => {
    event.preventDefault();
    if (reply.trim()) send("reply", { type: "reply", text: reply.trim() });
  };

  return (
    <div className="relative ml-auto flex shrink-0 flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {actions.map((offered) => {
          switch (offered.type) {
            case "choose":
              return offered.options.map((option) => (
                <button
                  key={`choose-${option}`}
                  type="button"
                  className={optionButton}
                  disabled={busy !== null}
                  onClick={() => send(`choose-${option}`, { type: "choose", option })}
                >
                  {option}
                </button>
              ));
            case "approve":
            case "deny": {
              // The server refuses an answer without Face ID while the owner requires it,
              // and a browser has no Face ID: the answer belongs to the iOS app then.
              const verb = offered.type === "approve" ? "Approve" : "Deny";
              return (
                <IconButton
                  key={offered.type}
                  icon={offered.type === "approve" ? "check" : "x"}
                  label={item.approvalNeedsAuth ? `${verb} in the iOS app, with Face ID` : verb}
                  tone={offered.type === "approve" ? "yes" : "no"}
                  disabled={busy !== null || item.approvalNeedsAuth === true}
                  aria-busy={busy === offered.type}
                  onClick={() => send(offered.type, { type: offered.type })}
                />
              );
            }
            case "ack":
              return (
                <IconButton
                  key="ack"
                  icon="ack"
                  label="Acknowledge"
                  disabled={busy !== null}
                  aria-busy={busy === "ack"}
                  onClick={() => send("ack", { type: "ack" })}
                />
              );
            case "reply":
            case "snooze":
              return (
                <IconButton
                  key={offered.type}
                  icon={offered.type === "reply" ? "reply" : "clock"}
                  label={offered.type === "reply" ? "Reply" : "Snooze"}
                  aria-expanded={panel === offered.type}
                  disabled={busy !== null}
                  onClick={() => setPanel(panel === offered.type ? null : offered.type)}
                />
              );
            case "open":
              return (
                <a
                  key={`open-${offered.url}`}
                  href={offered.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open link"
                  aria-label="Open link"
                  className="grid size-[26px] place-items-center rounded-[7px] border border-gray-200 bg-surface-2"
                >
                  <Icon name="link" />
                </a>
              );
          }
        })}
      </div>
      {panel === "reply" && (
        <form onSubmit={sendReply} className="flex items-center gap-1.5">
          <input
            aria-label="Reply"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            className="h-[26px] w-48 rounded-[7px] border border-gray-200 bg-bg px-2 text-[0.75rem] max-[400px]:w-36"
          />
          <IconButton
            type="submit"
            icon="send"
            label="Send reply"
            disabled={busy !== null || !reply.trim()}
            aria-busy={busy === "reply"}
          />
        </form>
      )}
      {panel === "snooze" && (
        <SnoozePicker
          busy={busy}
          onClose={() => setPanel(null)}
          onPick={(key, until) => send(key, { type: "snooze", until })}
        />
      )}
      <ActionError error={action.error} />
    </div>
  );
}

export function ActionError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-[0.7rem] text-accent-text">
      {errorMessage(error)}
    </p>
  );
}

// The popover from the Snooze button: four presets with the time each returns at, then a
// custom date and time.
function SnoozePicker({
  busy,
  onClose,
  onPick,
}: {
  busy: string | null;
  onClose: () => void;
  onPick: (key: string, until: number) => void;
}) {
  const [now] = useState(() => new Date());
  const [custom, setCustom] = useState("");
  const customAt = custom ? new Date(custom).getTime() : Number.NaN;
  const pickCustom = (event: FormEvent) => {
    event.preventDefault();
    if (customAt > Date.now()) onPick("snooze-custom", customAt);
  };

  return (
    <dialog
      open
      aria-label="Snooze until"
      onKeyDown={(event) => event.key === "Escape" && onClose()}
      className="absolute top-full right-0 left-auto z-10 m-0 mt-1.5 grid w-[300px] grid-cols-[minmax(0,1fr)] max-w-[calc(100vw-32px)] rounded-[10px] border border-gray-200 bg-surface-2 px-3 pt-1 pb-2 text-txt shadow-[0_14px_34px_#000c]"
    >
      <h3 className="py-1.5 font-mono text-[0.6rem] font-normal uppercase tracking-[0.13em] text-gray-600">
        Snooze until
      </h3>
      {snoozePresets(now).map(({ label, until }) => (
        <button
          key={label}
          type="button"
          disabled={busy !== null}
          aria-busy={busy === `snooze-${label}`}
          onClick={() => onPick(`snooze-${label}`, until)}
          className="flex cursor-pointer items-center justify-between gap-3 border-b border-line py-1.5 text-left text-[0.8rem] disabled:cursor-default disabled:opacity-50"
        >
          <span>{label}</span>
          <span className="font-mono text-[0.7rem] text-gray-600">
            {formatReturnTime(until, now.getTime())}
          </span>
        </button>
      ))}
      <form onSubmit={pickCustom} className="flex items-center gap-2 pt-1.5 text-[0.8rem]">
        <label htmlFor="snooze-custom">Custom</label>
        <input
          id="snooze-custom"
          type="datetime-local"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          className="h-[26px] min-w-0 flex-1 rounded-lg border border-gray-200 bg-bg px-1.5 font-mono text-[0.7rem]"
        />
        <IconButton
          type="submit"
          icon="check"
          label="Snooze until this time"
          disabled={busy !== null || !(customAt > now.getTime())}
          aria-busy={busy === "snooze-custom"}
        />
      </form>
    </dialog>
  );
}
