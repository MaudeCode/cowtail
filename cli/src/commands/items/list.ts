import { Command, Option } from "clipanion";

import { itemListResponseSchema } from "@maudecode/cowtail-protocol";

import { validationError } from "../../lib/errors.ts";
import { getJson } from "../../lib/http.ts";
import { JsonCommand } from "../../lib/output.ts";
import { optionalTrimmedString, parseTimestamp } from "../../lib/parse.ts";
import { formatTimestamp } from "../../lib/render.ts";

export const ITEMS_LIST_DESCRIPTION = `List items, newest first.`;

export class ItemsListCommand extends JsonCommand {
  static paths = [[`items`, `list`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: ITEMS_LIST_DESCRIPTION,
  });

  state = Option.String(`--state`, {
    description: `Filter by state: open, acked, snoozed, resolved or expired.`,
  });

  needsOwner = Option.Boolean(`--needs-owner`, {
    description: `Only items that need the owner; --no-needs-owner for the rest.`,
  });

  source = Option.String(`--source`, { description: `Filter by producer.` });

  from = Option.String(`--from`, {
    description: `Created at or after, as milliseconds since epoch or ISO timestamp.`,
  });

  to = Option.String(`--to`, {
    description: `Created at or before, as milliseconds since epoch or ISO timestamp.`,
  });

  limit = Option.String(`--limit`, { description: `At most this many items (1-500).` });

  async execute(): Promise<void> {
    if (this.limit !== undefined && !/^\d+$/.test(this.limit.trim())) {
      throw validationError("limit must be a whole number");
    }
    const params = new URLSearchParams();
    const filters: Record<string, string | number | boolean | undefined> = {
      state: optionalTrimmedString(this.state),
      needsOwner: this.needsOwner,
      source: optionalTrimmedString(this.source),
      from: parseTimestamp(this.from, "from"),
      to: parseTimestamp(this.to, "to"),
      limit: optionalTrimmedString(this.limit),
    };
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) params.set(key, String(value));
    }

    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    const response = itemListResponseSchema.parse(
      await getJson(`/api/items${suffix}`, { requireServiceAuth: true }),
    );

    if (this.json) {
      this.printJson(response);
      return;
    }

    if (response.items.length === 0) {
      this.printLine("No items");
      return;
    }

    this.printLine(
      response.items
        .map((item) =>
          [
            item.id,
            formatTimestamp(item.createdAt),
            `${item.source}/${item.kind}/${item.urgency}`,
            item.needsOwner ? `${item.state}!` : item.state,
            item.occurrenceCount > 1 ? `${item.title} x${item.occurrenceCount}` : item.title,
          ].join("  "),
        )
        .join("\n"),
    );
  }
}
