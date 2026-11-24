import type { ItemActionRequest, ItemRecord } from "@maudecode/cowtail-protocol";
import { useState, type FormEvent } from "react";

import { errorMessage } from "../../lib/api";
import { useItemAction } from "../../lib/queries";
import { Icon, IconButton } from "../ui";

const HOUR_MS = 60 * 60 * 1000;
const SNOOZE_OPTIONS = [
  ["1h", HOUR_MS],
  ["4h", 4 * HOUR_MS],
  ["24h", 24 * HOUR_MS],
] as const;

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
    <div className="ml-auto flex shrink-0 flex-col items-end gap-1.5">
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
            case "deny":
              return (
                <IconButton
                  key={offered.type}
                  icon={offered.type === "approve" ? "check" : "x"}
                  label={offered.type === "approve" ? "Approve" : "Deny"}
                  tone={offered.type === "approve" ? "yes" : "no"}
                  disabled={busy !== null}
                  aria-busy={busy === offered.type}
                  onClick={() => send(offered.type, { type: offered.type })}
                />
              );
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
        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Snooze for</legend>
          {SNOOZE_OPTIONS.map(([label, ms]) => (
            <button
              key={label}
              type="button"
              className={optionButton}
              disabled={busy !== null}
              onClick={() => send(`snooze-${label}`, { type: "snooze", until: Date.now() + ms })}
            >
              {label}
            </button>
          ))}
        </fieldset>
      )}
      {action.error && (
        <p role="alert" className="text-[0.7rem] text-accent-text">
          {errorMessage(action.error)}
        </p>
      )}
    </div>
  );
}
