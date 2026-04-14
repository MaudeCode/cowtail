import { Command, Option } from "clipanion";

import { okResponseSchema } from "@maudecode/cowtail-protocol";

import { deleteJson } from "../../lib/http";
import { JsonCommand } from "../../lib/output";
import { requireNonEmptyString } from "../../lib/parse";

export const ALERT_DELETE_DESCRIPTION = `Delete a single alert.`;

export class AlertDeleteCommand extends JsonCommand {
  static paths = [[`alert`, `delete`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: ALERT_DELETE_DESCRIPTION,
  });

  id = Option.String(`--id`, {
    description: `Required. Alert ID.`,
  });

  async execute(): Promise<void> {
    const id = requireNonEmptyString(this.id, "id");
    const response = okResponseSchema.parse(
      await deleteJson(`/api/alerts/${encodeURIComponent(id)}`),
    );

    this.printSuccess(`Deleted alert ${id}`, response);
  }
}
