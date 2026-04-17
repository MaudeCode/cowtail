import { Command, Option } from "clipanion";

import { roundupTestRequestSchema, roundupTestResultSchema } from "@maudecode/cowtail-protocol";

import { formatIssueList, validationError } from "../../lib/errors";
import { postJson } from "../../lib/http";
import { JsonCommand } from "../../lib/output";
import { parseDateOnly, requireNonEmptyString } from "../../lib/parse";

export const ROUNDUP_TEST_DESCRIPTION = `Send a daily roundup push notification.`;

export class RoundupTestCommand extends JsonCommand {
  static paths = [[`roundup`, `test`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: ROUNDUP_TEST_DESCRIPTION,
  });

  userId = Option.String(`--user-id`, {
    description: `Required. Apple sub or Cowtail user ID.`,
  });

  from = Option.String(`--from`, {
    description: `Optional roundup start date in YYYY-MM-DD format.`,
  });

  to = Option.String(`--to`, {
    description: `Optional roundup end date in YYYY-MM-DD format.`,
  });

  async execute(): Promise<void> {
    const payloadResult = roundupTestRequestSchema.safeParse({
      userId: requireNonEmptyString(this.userId, "user ID"),
      from: parseDateOnly(this.from, "from"),
      to: parseDateOnly(this.to, "to"),
    });

    if (!payloadResult.success) {
      throw validationError(formatIssueList(payloadResult.error.issues));
    }

    if (
      payloadResult.data.from !== undefined &&
      payloadResult.data.to !== undefined &&
      payloadResult.data.from > payloadResult.data.to
    ) {
      throw validationError("from must be less than or equal to to");
    }

    const response = roundupTestResultSchema.parse(
      await postJson("/api/roundup/test", payloadResult.data, { requireServiceAuth: true }),
    );

    this.printSuccess(
      `Sent roundup to ${response.userId} (${response.sent} sent, ${response.failed} failed)`,
      response,
    );
  }
}
