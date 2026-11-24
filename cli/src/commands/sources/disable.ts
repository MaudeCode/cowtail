import { Command, Option } from "clipanion";

import { sourceResponseSchema } from "@maudecode/cowtail-protocol";

import { patchJson } from "../../lib/http.ts";
import { JsonCommand } from "../../lib/output.ts";
import { requireNonEmptyString } from "../../lib/parse.ts";

export const SOURCES_DISABLE_DESCRIPTION = `Disable a source; its token stops working.`;

export class SourcesDisableCommand extends JsonCommand {
  static paths = [[`sources`, `disable`]];

  static usage = Command.Usage({ category: `Commands`, description: SOURCES_DISABLE_DESCRIPTION });

  slug = Option.String();

  async execute(): Promise<void> {
    const slug = requireNonEmptyString(this.slug, "slug");
    const response = sourceResponseSchema.parse(
      await patchJson(
        `/api/sources/${encodeURIComponent(slug)}`,
        { enabled: false },
        { requireServiceAuth: true },
      ),
    );
    this.printSuccess(`Disabled source ${response.source.slug}`, response);
  }
}
