import { Command, Option } from "clipanion";

import { sourceTokenResponseSchema } from "@maudecode/cowtail-protocol";

import { postJson } from "../../lib/http.ts";
import { JsonCommand } from "../../lib/output.ts";
import { requireNonEmptyString } from "../../lib/parse.ts";
import { tokenLines } from "./add.ts";

export const SOURCES_ROTATE_DESCRIPTION = `Issue a source a new token; the old one stops working.`;

export class SourcesRotateCommand extends JsonCommand {
  static paths = [[`sources`, `rotate`]];

  static usage = Command.Usage({ category: `Commands`, description: SOURCES_ROTATE_DESCRIPTION });

  slug = Option.String();

  async execute(): Promise<void> {
    const slug = requireNonEmptyString(this.slug, "slug");
    const response = sourceTokenResponseSchema.parse(
      await postJson(`/api/sources/${encodeURIComponent(slug)}/token`, undefined, {
        requireServiceAuth: true,
      }),
    );
    this.printSuccess(
      `Rotated the token of ${response.source.slug}\n${tokenLines(response)}`,
      response,
    );
  }
}
