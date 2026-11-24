import type {
  HermesSnapshot,
  RunbookRunRecord,
  RunbookScript,
  RunbookSection,
} from "@maudecode/cowtail-protocol";

import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { approvalsNeedAuth } from "./notificationPreferences";

// Cowtail's calls on the MaudeUtils catalog Hermes reports: which scripts ask to confirm,
// which also need Face ID, and which are running now.

// The catalog from the latest heartbeat; none before Hermes reports one.
export async function runbookCatalog(ctx: QueryCtx): Promise<RunbookScript[]> {
  const status = await ctx.db.query("hermesStatus").first();
  return (status?.snapshot as HermesSnapshot | undefined)?.runbook ?? [];
}

// The prompt to show before a run: the script's own, or a generic one for a dangerous script
// that has none. Undefined when the script runs on a tap.
export function runbookConfirmText(script: RunbookScript): string | undefined {
  if (script.confirm?.trim()) return script.confirm;
  return script.danger ? `Run ${script.name}?` : undefined;
}

export async function runbookNeedsAuth(ctx: QueryCtx, script: RunbookScript) {
  return runbookConfirmText(script) !== undefined && (await approvalsNeedAuth(ctx));
}

async function activeScriptIds(ctx: QueryCtx) {
  const ids = new Set<string>();
  for (const status of ["queued", "running"] as const) {
    const runs = await ctx.db
      .query("runbookRuns")
      .withIndex("by_status_availableAt", (q) => q.eq("status", status))
      .collect();
    for (const run of runs) ids.add(run.scriptId);
  }
  return ids;
}

// One section per category in the catalog's order, each script in the catalog's order.
export async function runbookSections(ctx: QueryCtx, catalog: RunbookScript[]) {
  const running = await activeScriptIds(ctx);
  const needAuth = await approvalsNeedAuth(ctx);
  const sections = new Map<string, RunbookSection>();
  for (const script of catalog) {
    const confirmText = runbookConfirmText(script);
    const section = sections.get(script.category) ?? { category: script.category, scripts: [] };
    section.scripts.push({
      ...script,
      confirmText,
      needsAuth: confirmText !== undefined && needAuth,
      running: running.has(script.id),
    });
    sections.set(script.category, section);
  }
  return [...sections.values()];
}

type ItemAction = Doc<"items">["actions"][number];

// An item's `run` actions with the server's calls on their scripts; a script the catalog no
// longer holds cannot run, so its action is left out.
export async function withRunbookCalls(ctx: QueryCtx, actions: ItemAction[]) {
  if (!actions.some((action) => action.type === "run")) return actions;
  const catalog = new Map((await runbookCatalog(ctx)).map((script) => [script.id, script]));
  const needAuth = await approvalsNeedAuth(ctx);
  return actions.flatMap((action): ItemAction[] => {
    if (action.type !== "run") return [action];
    const script = catalog.get(action.scriptId);
    if (!script) return [];
    const confirmText = runbookConfirmText(script);
    return [
      {
        type: "run",
        scriptId: action.scriptId,
        label: action.label,
        confirmText,
        needsAuth: confirmText !== undefined && needAuth,
      },
    ];
  });
}

export function runbookRunRecord(run: Doc<"runbookRuns">): RunbookRunRecord {
  return {
    id: String(run._id),
    scriptId: run.scriptId,
    scriptName: run.scriptName,
    itemId: run.itemId ? String(run.itemId) : undefined,
    status: run.status,
    active: run.status === "queued" || run.status === "running",
    exitCode: run.exitCode,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}
