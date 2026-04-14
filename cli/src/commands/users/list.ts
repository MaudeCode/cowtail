import { Command } from "clipanion";

import { usersListResponseSchema } from "@maudecode/cowtail-protocol";

import { getJson } from "../../lib/http";
import { JsonCommand } from "../../lib/output";

export const USERS_LIST_DESCRIPTION = `List users with enabled push devices.`;

export class UsersListCommand extends JsonCommand {
  static paths = [[`users`, `list`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: USERS_LIST_DESCRIPTION,
    details: `
      Requires \`baseUrl\` and \`pushBearerToken\` in the Cowtail config file.
    `,
  });

  async execute(): Promise<void> {
    const response = usersListResponseSchema.parse(
      await getJson("/api/users", { requireServiceAuth: true }),
    );

    if (this.json) {
      this.printJson(response);
      return;
    }

    if (response.users.length === 0) {
      this.printLine("No current users");
      return;
    }

    this.printLine(
      response.users
        .map((entry) => `${entry.userId} (${entry.enabledDeviceCount} enabled device${entry.enabledDeviceCount === 1 ? "" : "s"})`)
        .join("\n"),
    );
  }
}
