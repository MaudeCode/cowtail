import { Command, Option } from "clipanion";

import { fixGetResponseSchema } from "@maudecode/cowtail-protocol";

import { getJson } from "../../lib/http";
import { JsonCommand } from "../../lib/output";
import { requireNonEmptyString } from "../../lib/parse";
import { formatOptionalText, formatTimestamp } from "../../lib/render";

export const FIX_SHOW_DESCRIPTION = `Show a single fix.`;

export class FixShowCommand extends JsonCommand {
  static paths = [[`fix`, `show`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: FIX_SHOW_DESCRIPTION,
  });

  id = Option.String(`--id`, {
    description: `Required. Fix ID.`,
  });

  async execute(): Promise<void> {
    const id = requireNonEmptyString(this.id, "id");
    const response = fixGetResponseSchema.parse(
      await getJson(`/api/fixes/${encodeURIComponent(id)}`),
    );

    if (this.json) {
      this.printJson(response);
      return;
    }

    const fix = response.fix;
    this.printLine(
      [
        `ID: ${fix.id}`,
        `Timestamp: ${formatTimestamp(fix.timestamp)}`,
        `Scope: ${fix.scope}`,
        `Description: ${fix.description}`,
        `Root cause: ${fix.rootCause}`,
        `Commit: ${formatOptionalText(fix.commit)}`,
        `Alert IDs: ${fix.alertIds.join(", ")}`,
      ].join("\n"),
    );
  }
}
