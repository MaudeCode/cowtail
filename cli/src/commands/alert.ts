import {
  alertCreateRequestSchema,
  alertOutcomes,
  alertStatuses,
  createResponseSchema,
} from "@maudecode/cowtail-protocol";

import { getAlertCreateHelpText, printHelp } from "./help";
import { formatIssueList, validationError } from "../lib/errors";
import { postJson } from "../lib/http";
import {
  ensureNoPositionals,
  getBooleanFlag,
  getStringFlag,
  parseFlags,
  parseTimestamp,
  requireStringFlag,
} from "../lib/parse";
import { printSuccess, runCommand } from "../lib/output";

const ALERT_CREATE_FLAGS = {
  alertname: { type: "string" },
  severity: { type: "string" },
  namespace: { type: "string" },
  status: { type: "string" },
  outcome: { type: "string" },
  summary: { type: "string" },
  action: { type: "string" },
  "root-cause": { type: "string" },
  node: { type: "string" },
  messaged: { type: "boolean" },
  timestamp: { type: "string" },
  "resolved-at": { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean" },
} as const;

export async function runAlertCommand(action?: string, args: string[] = []): Promise<void> {
  if (!action || action === "help" || action === "--help" || action === "-h") {
    printHelp(["alert"]);
    return;
  }

  if (action !== "create") {
    throw new Error("Usage: cowtail alert create [options]");
  }

  await runCommand(args, async (json) => {
    const parsed = parseFlags(args, ALERT_CREATE_FLAGS);

    if (getBooleanFlag(parsed, "help")) {
      console.log(getAlertCreateHelpText());
      return;
    }

    ensureNoPositionals(parsed, "Usage: cowtail alert create [options]");

    const payloadResult = alertCreateRequestSchema.safeParse({
      alertname: requireStringFlag(parsed, "alertname", "alertname"),
      severity: requireStringFlag(parsed, "severity", "severity"),
      namespace: requireStringFlag(parsed, "namespace", "namespace"),
      status: requireStringFlag(parsed, "status", "status"),
      outcome: requireStringFlag(parsed, "outcome", "outcome"),
      summary: requireStringFlag(parsed, "summary", "summary"),
      action: requireStringFlag(parsed, "action", "action"),
      rootCause: getStringFlag(parsed, "root-cause")?.trim(),
      node: getStringFlag(parsed, "node")?.trim(),
      messaged: getBooleanFlag(parsed, "messaged") ? true : undefined,
      timestamp: parseTimestamp(getStringFlag(parsed, "timestamp"), "timestamp"),
      resolvedAt: parseTimestamp(getStringFlag(parsed, "resolved-at"), "resolved-at"),
    });

    if (!payloadResult.success) {
      throw validationError(formatIssueList(payloadResult.error.issues));
    }

    const status = payloadResult.data.status;
    const outcome = payloadResult.data.outcome;
    if (!alertStatuses.includes(status)) {
      throw validationError(`status must be one of: ${alertStatuses.join(", ")}`);
    }
    if (!alertOutcomes.includes(outcome)) {
      throw validationError(`outcome must be one of: ${alertOutcomes.join(", ")}`);
    }

    const response = createResponseSchema.parse(
      await postJson("/api/alerts", payloadResult.data),
    );
    printSuccess(json, `Created alert ${response.id}`, response);
  });
}
