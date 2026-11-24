import { Command } from "clipanion";

import { sourceListResponseSchema } from "@maudecode/cowtail-protocol";

import { getJson } from "../../lib/http.ts";
import { JsonCommand } from "../../lib/output.ts";

export const SOURCES_LIST_DESCRIPTION = `List registered sources.`;

export class SourcesListCommand extends JsonCommand {
  static paths = [[`sources`, `list`]];

  static usage = Command.Usage({ category: `Commands`, description: SOURCES_LIST_DESCRIPTION });

  async execute(): Promise<void> {
    const response = sourceListResponseSchema.parse(
      await getJson("/api/sources", { requireServiceAuth: true }),
    );

    if (this.json) {
      this.printJson(response);
      return;
    }

    this.printLine(
      response.sources
        .map((source) =>
          [
            source.slug,
            source.displayName,
            source.enabled ? "enabled" : "disabled",
            source.hasToken ? "token" : "no token",
            source.iconUrl ? "icon" : "no icon",
          ].join("  "),
        )
        .join("\n") || "No sources",
    );
  }
}
