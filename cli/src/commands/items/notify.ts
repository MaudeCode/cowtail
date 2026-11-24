import { Command, Option } from "clipanion";

import { itemCreateRequestSchema, itemCreateResponseSchema } from "@maudecode/cowtail-protocol";

import { formatIssueList, validationError } from "../../lib/errors.ts";
import { postJson } from "../../lib/http.ts";
import { JsonCommand } from "../../lib/output.ts";
import {
  optionalTrimmedString,
  parseFutureTime,
  parseKeyValuePairs,
  parseTimestamp,
  requireNonEmptyString,
} from "../../lib/parse.ts";

export const NOTIFY_DESCRIPTION = `Create an item that needs the owner's attention.`;

export class NotifyCommand extends JsonCommand {
  static paths = [[`notify`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: NOTIFY_DESCRIPTION,
  });

  title = Option.String(`--title`, { description: `Required. Item title.` });

  kind = Option.String(`--kind`, {
    description: `Required. alert, failure, approval, question, fyi or done.`,
  });

  urgency = Option.String(`--urgency`, { description: `Required. now, today or whenever.` });

  body = Option.String(`--body`, { description: `Markdown body.` });

  source = Option.String(`--source`, { description: `Producer name. Defaults to manual.` });

  dedupeKey = Option.String(`--dedupe-key`, {
    description: `Counts a repeat into the open item with this key.`,
  });

  links = Option.Array(`--link`, { description: `A link as label=url. Repeatable.` });

  contextPairs = Option.Array(`--context`, { description: `Context as key=value. Repeatable.` });

  expiresAt = Option.String(`--expires-at`, {
    description: `Milliseconds since epoch or ISO timestamp.`,
  });

  remindAt = Option.String(`--remind-at`, {
    description: `Stay silent until this time, then remind: 30m, 3h, 2d, milliseconds since epoch or ISO timestamp.`,
  });

  async execute(): Promise<void> {
    const payloadResult = itemCreateRequestSchema.safeParse({
      source: optionalTrimmedString(this.source) ?? "manual",
      kind: requireNonEmptyString(this.kind, "kind"),
      urgency: requireNonEmptyString(this.urgency, "urgency"),
      title: requireNonEmptyString(this.title, "title"),
      body: optionalTrimmedString(this.body),
      dedupeKey: optionalTrimmedString(this.dedupeKey),
      links: this.links
        ? parseKeyValuePairs(this.links, "link").map(([label, url]) => ({ label, url }))
        : undefined,
      context: this.contextPairs
        ? Object.fromEntries(parseKeyValuePairs(this.contextPairs, "context"))
        : undefined,
      expiresAt: parseTimestamp(this.expiresAt, "expires-at"),
      remindAt: parseFutureTime(this.remindAt, "remind-at"),
    });

    if (!payloadResult.success) {
      throw validationError(formatIssueList(payloadResult.error.issues));
    }

    const response = itemCreateResponseSchema.parse(
      await postJson("/api/items", payloadResult.data, { requireServiceAuth: true }),
    );

    this.printSuccess(
      response.created
        ? `Created item ${response.id}`
        : `Repeated item ${response.id} (x${response.occurrenceCount})`,
      response,
    );
  }
}
