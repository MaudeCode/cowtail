import { Command } from "clipanion";

import { BaseCommand } from "../../lib/output.ts";
import { cowtailVersionLabel } from "../../lib/version.ts";

export const VERSION_DESCRIPTION = `Print the build version.`;

export class VersionCommand extends BaseCommand {
  static paths = [[`version`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: VERSION_DESCRIPTION,
  });

  async execute(): Promise<void> {
    this.printLine(cowtailVersionLabel);
  }
}
