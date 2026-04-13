import { subsListResponseSchema } from "@maudecode/cowtail-protocol";

import { getSubsListHelpText, printHelp } from "./help";
import { getJson } from "../lib/http";
import { ensureNoPositionals, getBooleanFlag, parseFlags } from "../lib/parse";
import { printJson, runCommand } from "../lib/output";

const SUBS_LIST_FLAGS = {
  json: { type: "boolean" },
  help: { type: "boolean" },
} as const;

export async function runSubsCommand(action?: string, args: string[] = []): Promise<void> {
  if (!action || action === "help" || action === "--help" || action === "-h") {
    printHelp(["subs"]);
    return;
  }

  if (action !== "list") {
    throw new Error("Usage: cowtail subs list [--json]");
  }

  await runCommand(args, async (json) => {
    const parsed = parseFlags(args, SUBS_LIST_FLAGS);

    if (getBooleanFlag(parsed, "help")) {
      console.log(getSubsListHelpText());
      return;
    }

    ensureNoPositionals(parsed, "Usage: cowtail subs list [--json]");

    const response = subsListResponseSchema.parse(
      await getJson("/api/subs", { requireServiceAuth: true }),
    );

    if (json) {
      printJson(response);
      return;
    }

    if (response.subs.length === 0) {
      console.log("No current subs");
      return;
    }

    console.log(response.subs.map((entry) => `${entry.userId} (${entry.enabledDeviceCount} enabled device${entry.enabledDeviceCount === 1 ? "" : "s"})`).join("\n"));
  });
}
