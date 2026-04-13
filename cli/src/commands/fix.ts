import {
  createResponseSchema,
  fixCreateRequestSchema,
  fixScopes,
} from "@maudecode/cowtail-protocol";

import { getFixCreateHelpText, printHelp } from "./help";
import { formatIssueList, validationError } from "../lib/errors";
import { postJson } from "../lib/http";
import {
  ensureNoPositionals,
  getBooleanFlag,
  getStringArrayFlag,
  getStringFlag,
  parseCommaSeparatedStrings,
  parseFlags,
  parseTimestamp,
  requireNonEmptyString,
  requireStringFlag,
} from "../lib/parse";
import { printSuccess, runCommand } from "../lib/output";

const FIX_CREATE_FLAGS = {
  "alert-id": { type: "string", multiple: true },
  "alert-ids": { type: "string" },
  description: { type: "string" },
  "root-cause": { type: "string" },
  scope: { type: "string" },
  commit: { type: "string" },
  timestamp: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean" },
} as const;

export async function runFixCommand(action?: string, args: string[] = []): Promise<void> {
  if (!action || action === "help" || action === "--help" || action === "-h") {
    printHelp(["fix"]);
    return;
  }

  if (action !== "create") {
    throw new Error("Usage: cowtail fix create [options]");
  }

  await runCommand(args, async (json) => {
    const parsed = parseFlags(args, FIX_CREATE_FLAGS);

    if (getBooleanFlag(parsed, "help")) {
      console.log(getFixCreateHelpText());
      return;
    }

    ensureNoPositionals(parsed, "Usage: cowtail fix create [options]");

    const alertIds = [
      ...getStringArrayFlag(parsed, "alert-id"),
      ...parseCommaSeparatedStrings(getStringFlag(parsed, "alert-ids")),
    ].map((value) => requireNonEmptyString(value, "alert ID"));

    if (alertIds.length === 0) {
      throw validationError("--alert-id or --alert-ids is required");
    }

    const payloadResult = fixCreateRequestSchema.safeParse({
      alertIds: Array.from(new Set(alertIds)),
      description: requireStringFlag(parsed, "description", "description"),
      rootCause: requireStringFlag(parsed, "root-cause", "root cause"),
      scope: requireStringFlag(parsed, "scope", "scope"),
      commit: getStringFlag(parsed, "commit")?.trim(),
      timestamp: parseTimestamp(getStringFlag(parsed, "timestamp"), "timestamp"),
    });

    if (!payloadResult.success) {
      throw validationError(formatIssueList(payloadResult.error.issues));
    }

    if (!fixScopes.includes(payloadResult.data.scope)) {
      throw validationError(`scope must be one of: ${fixScopes.join(", ")}`);
    }

    const response = createResponseSchema.parse(
      await postJson("/api/fixes", payloadResult.data),
    );
    printSuccess(json, `Created fix ${response.id}`, response);
  });
}
