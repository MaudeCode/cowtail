import { Command } from "clipanion";

import { inspectConfig } from "../../lib/config";
import { JsonCommand } from "../../lib/output";

export const CONFIG_VALIDATE_DESCRIPTION = `Validate the local CLI config.`;

export class ConfigValidateCommand extends JsonCommand {
  static paths = [[`config`, `validate`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: CONFIG_VALIDATE_DESCRIPTION,
  });

  async execute(): Promise<number> {
    const report = inspectConfig();

    if (this.json) {
      this.printJson(report);
    } else if (report.valid) {
      this.printLine(`Config valid: ${report.configPath}`);
    } else {
      this.printLine(
        [
          `Config invalid: ${report.configPath}`,
          ...report.errors.map((error) => `- ${error}`),
        ].join("\n"),
      );
    }

    return report.valid ? 0 : 1;
  }
}
