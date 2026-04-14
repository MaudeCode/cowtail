import { Command, Option } from "clipanion";

import { pushResultSchema, pushTestRequestSchema } from "@maudecode/cowtail-protocol";

import { formatIssueList, validationError } from "../../lib/errors";
import { postJson } from "../../lib/http";
import { JsonCommand } from "../../lib/output";
import { optionalTrimmedString, parseJsonObject, requireNonEmptyString } from "../../lib/parse";

export const PUSH_TEST_DESCRIPTION = `Send a test push notification.`;

export class PushTestCommand extends JsonCommand {
  static paths = [[`push`, `test`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: PUSH_TEST_DESCRIPTION,
  });

  userId = Option.String(`--user-id`, {
    description: `Required. Apple sub or Cowtail user ID.`,
  });

  title = Option.String(`--title`, {
    description: `Optional notification title override.`,
  });

  body = Option.String(`--body`, {
    description: `Optional notification body override.`,
  });

  data = Option.String(`--data`, {
    description: `Optional JSON object payload.`,
  });

  async execute(): Promise<void> {
    const payloadResult = pushTestRequestSchema.safeParse({
      userId: requireNonEmptyString(this.userId, "user ID"),
      title: optionalTrimmedString(this.title),
      body: optionalTrimmedString(this.body),
      data: parseJsonObject(this.data, "data"),
    });

    if (!payloadResult.success) {
      throw validationError(formatIssueList(payloadResult.error.issues));
    }

    const response = pushResultSchema.parse(
      await postJson("/api/push/test", payloadResult.data, { requireServiceAuth: true }),
    );

    this.printSuccess(
      `Sent test push to ${response.userId} (${response.sent} sent, ${response.failed} failed)`,
      response,
    );
  }
}
