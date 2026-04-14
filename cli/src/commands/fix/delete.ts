import { Command, Option } from "clipanion";

import { okResponseSchema } from "@maudecode/cowtail-protocol";

import { deleteJson } from "../../lib/http";
import { JsonCommand } from "../../lib/output";
import { requireNonEmptyString } from "../../lib/parse";

export const FIX_DELETE_DESCRIPTION = `Delete a single fix.`;

export class FixDeleteCommand extends JsonCommand {
  static paths = [[`fix`, `delete`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: FIX_DELETE_DESCRIPTION,
  });

  id = Option.String(`--id`, {
    description: `Required. Fix ID.`,
  });

  async execute(): Promise<void> {
    const id = requireNonEmptyString(this.id, "id");
    const response = okResponseSchema.parse(
      await deleteJson(`/api/fixes/${encodeURIComponent(id)}`),
    );

    this.printSuccess(`Deleted fix ${id}`, response);
  }
}
