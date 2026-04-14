import { Command, Option } from "clipanion";

import {
  pushResultSchema,
  pushSendRequestSchema,
} from "@maudecode/cowtail-protocol";

import { formatIssueList, validationError } from "../../lib/errors";
import { postJson } from "../../lib/http";
import { JsonCommand } from "../../lib/output";
import {
  parseJsonObject,
  requireNonEmptyString,
} from "../../lib/parse";

export const PUSH_SEND_DESCRIPTION = `Send a push notification to a Cowtail user.`;

export class PushSendCommand extends JsonCommand {
  static paths = [[`push`, `send`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: PUSH_SEND_DESCRIPTION,
  });

  userId = Option.String(`--user-id`, {
    description: `Required. Apple sub or Cowtail user ID.`,
  });

  title = Option.String(`--title`, {
    description: `Required. Notification title.`,
  });

  body = Option.String(`--body`, {
    description: `Required. Notification body.`,
  });

  data = Option.String(`--data`, {
    description: `JSON object payload.`,
  });

  async execute(): Promise<void> {
    const payloadResult = pushSendRequestSchema.safeParse({
      userId: requireNonEmptyString(this.userId, "user ID"),
      title: requireNonEmptyString(this.title, "title"),
      body: requireNonEmptyString(this.body, "body"),
      data: parseJsonObject(this.data, "data"),
    });

    if (!payloadResult.success) {
      throw validationError(formatIssueList(payloadResult.error.issues));
    }

    const response = pushResultSchema.parse(
      await postJson("/api/push/send", payloadResult.data, { requireServiceAuth: true }),
    );

    this.printSuccess(
      `Sent push to ${response.userId} (${response.sent} sent, ${response.failed} failed)`,
      response,
    );
  }
}
