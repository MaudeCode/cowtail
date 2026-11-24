import type { RunbookRunRecord } from "@maudecode/cowtail-protocol";
import { useState, type FormEvent } from "react";

import { useRunbookRun } from "../../lib/queries";
import { ActionError, Icon, IconButton } from "../ui";

const textButtonShape =
  "h-[26px] cursor-pointer rounded-[7px] border px-2 text-[0.7rem] disabled:cursor-default disabled:opacity-50";
export const textButton = `${textButtonShape} border-gray-200 bg-surface-2 text-txt`;

type Script = { id: string; name: string; confirmText?: string; needsAuth?: boolean };

// Starts a runbook script: a Run icon button in the Runbook, or the play glyph and the action's
// label on an item. A script that asks to confirm shows its prompt first; one that also needs
// Face ID belongs to the iOS app, since a browser has none.
export default function RunScriptButton({
  script,
  itemId,
  label,
  disabled = false,
  onStarted,
}: {
  script: Script;
  itemId?: string;
  // An item's action label; without one the button is the Run icon.
  label?: string;
  disabled?: boolean;
  onStarted?: (run: RunbookRunRecord) => void;
}) {
  const run = useRunbookRun();
  const [confirming, setConfirming] = useState(false);
  const asksToConfirm = script.confirmText !== undefined;
  const name = script.needsAuth
    ? `Run ${script.name} in the iOS app, with Face ID`
    : `Run ${script.name}`;
  const blocked = disabled || script.needsAuth === true || run.isPending;

  const start = () =>
    run.mutate(
      { scriptId: script.id, itemId, confirmed: asksToConfirm },
      {
        onSuccess: (reply) => {
          setConfirming(false);
          onStarted?.(reply.run);
        },
      },
    );
  const onClick = () => (asksToConfirm ? setConfirming(!confirming) : start());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    start();
  };

  return (
    <div className="relative flex flex-col items-end gap-1">
      {label === undefined ? (
        <IconButton
          icon="play"
          label={name}
          tone={asksToConfirm ? "no" : "plain"}
          disabled={blocked}
          aria-busy={run.isPending}
          aria-expanded={asksToConfirm ? confirming : undefined}
          onClick={onClick}
        />
      ) : (
        <button
          type="button"
          title={script.needsAuth ? name : undefined}
          className={`${textButton} flex items-center gap-1`}
          disabled={blocked}
          aria-busy={run.isPending}
          aria-expanded={asksToConfirm ? confirming : undefined}
          onClick={onClick}
        >
          <Icon name="play" className="size-3" />
          {label}
        </button>
      )}
      {confirming && (
        <dialog
          open
          aria-label={`Run ${script.name}`}
          onKeyDown={(event) => event.key === "Escape" && setConfirming(false)}
          className="absolute top-full right-0 left-auto z-10 m-0 mt-1.5 w-[280px] max-w-[calc(100vw-32px)] rounded-[10px] border border-gray-200 bg-surface-2 px-3 py-2 text-left text-txt shadow-[0_14px_34px_#000c]"
        >
          <p className="text-[0.8rem] whitespace-pre-wrap [overflow-wrap:anywhere]">
            {script.confirmText}
          </p>
          <form onSubmit={submit} className="mt-2 flex items-center justify-end gap-1.5">
            <IconButton icon="x" label="Cancel" onClick={() => setConfirming(false)} />
            <button
              type="submit"
              className={`${textButtonShape} border-[#b8242c99] bg-[#b8242c1f] text-accent-text`}
              disabled={run.isPending}
              aria-busy={run.isPending}
            >
              Run
            </button>
          </form>
        </dialog>
      )}
      <ActionError error={run.error} />
    </div>
  );
}
