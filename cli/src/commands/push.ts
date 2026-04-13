import {
  pushResultSchema,
  pushSendRequestSchema,
  pushTestRequestSchema,
} from "@maudecode/cowtail-protocol";

import { getPushSendHelpText, getPushTestHelpText, printHelp } from "./help";
import { formatIssueList, validationError } from "../lib/errors";
import { postJson } from "../lib/http";
import {
  ensureNoPositionals,
  getBooleanFlag,
  getStringFlag,
  parseFlags,
  parseJsonObject,
  requireStringFlag,
} from "../lib/parse";
import { printSuccess, runCommand } from "../lib/output";

const PUSH_FLAGS = {
  "user-id": { type: "string" },
  title: { type: "string" },
  body: { type: "string" },
  data: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean" },
} as const;

export async function runPushCommand(action?: string, args: string[] = []): Promise<void> {
  if (!action || action === "help" || action === "--help" || action === "-h") {
    printHelp(["push"]);
    return;
  }

  if (action !== "send" && action !== "test") {
    throw new Error("Usage: cowtail push <send|test> [options]");
  }

  await runCommand(args, async (json) => {
    const parsed = parseFlags(args, PUSH_FLAGS);

    if (getBooleanFlag(parsed, "help")) {
      console.log(action === "test" ? getPushTestHelpText() : getPushSendHelpText());
      return;
    }

    ensureNoPositionals(parsed, `Usage: cowtail push ${action} [options]`);

    const rawPayload = {
      userId: requireStringFlag(parsed, "user-id", "user ID"),
    };

    const title = getStringFlag(parsed, "title")?.trim();
    const body = getStringFlag(parsed, "body")?.trim();

    if (action === "send") {
      Object.assign(rawPayload, {
        title: requireStringFlag(parsed, "title", "title"),
        body: requireStringFlag(parsed, "body", "body"),
      });
    } else {
      if (title) {
        Object.assign(rawPayload, { title });
      }

      if (body) {
        Object.assign(rawPayload, { body });
      }
    }

    const data = parseJsonObject(getStringFlag(parsed, "data"), "data");
    if (data) {
      Object.assign(rawPayload, { data });
    }

    const payloadResult = (action === "send" ? pushSendRequestSchema : pushTestRequestSchema).safeParse(rawPayload);
    if (!payloadResult.success) {
      throw validationError(formatIssueList(payloadResult.error.issues));
    }

    const endpoint = action === "test" ? "/api/push/test" : "/api/push/send";
    const response = pushResultSchema.parse(
      await postJson(endpoint, payloadResult.data, { requireServiceAuth: true }),
    );
    const verb = action === "test" ? "Sent test push" : "Sent push";
    printSuccess(
      json,
      `${verb} to ${response.userId} (${response.sent} sent, ${response.failed} failed)`,
      response,
    );
  });
}
