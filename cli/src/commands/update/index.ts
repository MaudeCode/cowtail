import { Command, Option } from "clipanion";

import { JsonCommand } from "../../lib/output.ts";
import { checkForUpdate, installUpdate } from "../../lib/update.ts";

export const UPDATE_DESCRIPTION = `Update the installed cowtail npm package to a release.`;

export class UpdateCommand extends JsonCommand {
  static paths = [[`update`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: UPDATE_DESCRIPTION,
  });

  version = Option.String(`--version`, {
    description: `Specific release tag to install, for example v0.1.3.`,
  });

  check = Option.Boolean(`--check`, {
    description: `Only check whether an update is available.`,
  });

  force = Option.Boolean(`--force`, {
    description: `Allow replacing a development build with a release.`,
  });

  async execute(): Promise<void> {
    if (this.check) {
      const result = await checkForUpdate(this.version, { force: this.force });

      if (this.json) {
        this.printJson(result);
        return;
      }

      if (!result.updateAllowed && result.blockedReason === "dev-build") {
        this.printLine(
          `Development build detected; use --force to replace it with ${result.targetVersion}`,
        );
        return;
      }

      if (result.updateAvailable) {
        this.printLine(`Update available: ${result.currentVersion} -> ${result.targetVersion}`);
      } else {
        this.printLine(`Already up to date: ${result.currentVersion}`);
      }
      return;
    }

    const result = await installUpdate(this.version, { force: this.force });

    if (this.json) {
      this.printJson(result);
      return;
    }

    if (result.updated) {
      this.printLine(`Updated cowtail to ${result.targetVersion}`);
    } else {
      this.printLine(`Already up to date: ${result.currentVersion}`);
    }
  }
}
