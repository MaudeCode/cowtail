import { Command } from "clipanion";

import { loadConfig } from "../../lib/config";
import { formatBoolean, JsonCommand } from "../../lib/output";

export const CONFIG_SHOW_DESCRIPTION = `Show the resolved local CLI config.`;

export class ConfigShowCommand extends JsonCommand {
  static paths = [[`config`, `show`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: CONFIG_SHOW_DESCRIPTION,
  });

  async execute(): Promise<void> {
    const config = loadConfig();
    const payload = {
      configPath: config.configPath,
      configFound: config.configFound,
      baseUrl: config.baseUrl,
      hasBaseUrl: Boolean(config.baseUrl),
      hasPushBearerToken: Boolean(config.pushBearerToken),
      timeoutMs: config.timeoutMs,
    };

    if (this.json) {
      this.printJson(payload);
      return;
    }

    this.printLine([
      `Config path: ${config.configPath}`,
      `Config found: ${formatBoolean(config.configFound)}`,
      `Base URL: ${config.baseUrl ?? "(not configured)"}`,
      `Push token configured: ${formatBoolean(Boolean(config.pushBearerToken))}`,
      `Timeout (ms): ${config.timeoutMs}`,
    ].join("\n"));
  }
}
