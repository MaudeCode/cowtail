import { Command, Option } from "clipanion";

import { createResponseSchema, fixCreateRequestSchema } from "@maudecode/cowtail-protocol";

import { formatIssueList, validationError } from "../../lib/errors";
import { postJson } from "../../lib/http";
import { JsonCommand } from "../../lib/output";
import {
  optionalTrimmedString,
  parseCommaSeparatedStrings,
  parseTimestamp,
  requireNonEmptyString,
} from "../../lib/parse";

export const FIX_CREATE_DESCRIPTION = `Create a fix linked to one or more alerts.`;

export class FixCreateCommand extends JsonCommand {
  static paths = [[`fix`, `create`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: FIX_CREATE_DESCRIPTION,
  });

  alertId = Option.Array(`--alert-id`, {
    description: `Alert ID. Repeat this option for multiple alerts.`,
  });

  alertIds = Option.String(`--alert-ids`, {
    description: `Comma-separated alert IDs.`,
  });

  description = Option.String(`--description`, {
    description: `Required. Fix description.`,
  });

  rootCause = Option.String(`--root-cause`, {
    description: `Required. Root cause text.`,
  });

  scope = Option.String(`--scope`, {
    description: `Required. Fix scope.`,
  });

  commit = Option.String(`--commit`, {
    description: `Commit SHA.`,
  });

  timestamp = Option.String(`--timestamp`, {
    description: `Milliseconds since epoch or ISO timestamp.`,
  });

  async execute(): Promise<void> {
    const alertIds = [...(this.alertId ?? []), ...parseCommaSeparatedStrings(this.alertIds)].map(
      (value) => requireNonEmptyString(value, "alert ID"),
    );

    if (alertIds.length === 0) {
      throw validationError("--alert-id or --alert-ids is required");
    }

    const payloadResult = fixCreateRequestSchema.safeParse({
      alertIds: Array.from(new Set(alertIds)),
      description: requireNonEmptyString(this.description, "description"),
      rootCause: requireNonEmptyString(this.rootCause, "root cause"),
      scope: requireNonEmptyString(this.scope, "scope"),
      commit: optionalTrimmedString(this.commit),
      timestamp: parseTimestamp(this.timestamp, "timestamp"),
    });

    if (!payloadResult.success) {
      throw validationError(formatIssueList(payloadResult.error.issues));
    }

    const response = createResponseSchema.parse(await postJson("/api/fixes", payloadResult.data));

    this.printSuccess(`Created fix ${response.id}`, response);
  }
}
