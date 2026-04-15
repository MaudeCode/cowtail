import { Command, Option } from "clipanion";

import { userDevicesResponseSchema } from "@maudecode/cowtail-protocol";

import { getJson } from "../../lib/http";
import { JsonCommand } from "../../lib/output";
import { requireNonEmptyString } from "../../lib/parse";
import { formatOptionalText, formatTimestamp } from "../../lib/render";

export const USERS_DEVICES_DESCRIPTION = `List enabled devices for a user.`;

export class UsersDevicesCommand extends JsonCommand {
  static paths = [[`users`, `devices`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: USERS_DEVICES_DESCRIPTION,
  });

  userId = Option.String(`--user-id`, {
    description: `Required. User ID.`,
  });

  async execute(): Promise<void> {
    const userId = requireNonEmptyString(this.userId, "user ID");
    const response = userDevicesResponseSchema.parse(
      await getJson(`/api/users/${encodeURIComponent(userId)}/devices`, {
        requireServiceAuth: true,
      }),
    );

    if (this.json) {
      this.printJson(response);
      return;
    }

    if (response.devices.length === 0) {
      this.printLine(`No enabled devices for ${userId}`);
      return;
    }

    this.printLine(
      response.devices
        .map(
          (device) =>
            `${device.deviceToken}  ${device.platform}/${device.environment}  ${formatOptionalText(device.deviceName)}  lastSeen=${formatTimestamp(device.lastSeenAt)}`,
        )
        .join("\n"),
    );
  }
}
