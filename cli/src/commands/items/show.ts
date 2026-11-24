import { Command, Option } from "clipanion";

import { itemGetResponseSchema } from "@maudecode/cowtail-protocol";

import { getJson } from "../../lib/http.ts";
import { JsonCommand } from "../../lib/output.ts";
import { requireNonEmptyString } from "../../lib/parse.ts";
import { formatTimestamp } from "../../lib/render.ts";

export const ITEMS_SHOW_DESCRIPTION = `Show one item and its timeline.`;

export class ItemsShowCommand extends JsonCommand {
  static paths = [[`items`, `show`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: ITEMS_SHOW_DESCRIPTION,
  });

  id = Option.String(`--id`, { description: `Required. Item ID.` });

  async execute(): Promise<void> {
    const id = requireNonEmptyString(this.id, "id");
    const response = itemGetResponseSchema.parse(
      await getJson(`/api/items/${encodeURIComponent(id)}`, { requireServiceAuth: true }),
    );

    if (this.json) {
      this.printJson(response);
      return;
    }

    const { item, events } = response;
    this.printLine(
      [
        `ID: ${item.id}`,
        `Title: ${item.title}`,
        `Source: ${item.source}`,
        `Kind: ${item.kind}`,
        `Urgency: ${item.urgency}`,
        `State: ${item.state}`,
        `Needs owner: ${item.needsOwner ? "yes" : "no"}`,
        `Occurrences: ${item.occurrenceCount}`,
        `Created: ${formatTimestamp(item.createdAt)}`,
        ...(item.body ? ["", item.body] : []),
        ...item.links.map((link) => `Link: ${link.label} ${link.url}`),
        ...Object.entries(item.context).map(([key, value]) => `${key}: ${value}`),
        "",
        "Timeline:",
        ...events.map((event) => `  ${formatTimestamp(event.at)}  ${event.type}  ${event.actor}`),
      ].join("\n"),
    );
  }
}
