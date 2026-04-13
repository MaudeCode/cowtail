import { loadConfig } from "../lib/config";
import { getAuthHelpText, printHelp } from "./help";
import { getBooleanFlag, parseFlags, ensureNoPositionals } from "../lib/parse";
import { formatBoolean, printJson, runCommand } from "../lib/output";

const AUTH_FLAGS = {
  json: { type: "boolean" },
  help: { type: "boolean" },
} as const;

export async function runAuthCommand(action?: string, args: string[] = []): Promise<void> {
  if (!action || action === "help" || action === "--help" || action === "-h") {
    printHelp(["auth"]);
    return;
  }

  if (action !== "whoami") {
    throw new Error("Usage: cowtail auth whoami [--json]");
  }

  await runCommand(args, async (json) => {
    const parsed = parseFlags(args, AUTH_FLAGS);

    if (getBooleanFlag(parsed, "help")) {
      console.log(getAuthHelpText());
      return;
    }

    ensureNoPositionals(parsed, "Usage: cowtail auth whoami [--json]");

    const config = loadConfig();
    const payload = {
      configPath: config.configPath,
      configFound: config.configFound,
      baseUrl: config.baseUrl,
      hasBaseUrl: Boolean(config.baseUrl),
      hasPushBearerToken: Boolean(config.pushBearerToken),
      timeoutMs: config.timeoutMs,
    };

    if (json) {
      printJson(payload);
      return;
    }

    console.log([
      `Config path: ${config.configPath}`,
      `Config found: ${formatBoolean(config.configFound)}`,
      `Base URL: ${config.baseUrl ?? "(not configured)"}`,
      `Push token configured: ${formatBoolean(Boolean(config.pushBearerToken))}`,
      `Timeout (ms): ${config.timeoutMs}`,
    ].join("\n"));
  });
}
