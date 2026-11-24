import { Command, Option } from "clipanion";

import {
  sourceCreateRequestSchema,
  sourceTokenResponseSchema,
  type SourceTokenResponse,
} from "@maudecode/cowtail-protocol";

import { CliError, formatIssueList, toCliError, validationError } from "../../lib/errors.ts";
import { postJson } from "../../lib/http.ts";
import { JsonCommand } from "../../lib/output.ts";
import { uploadSourceIcon } from "./icon.ts";

export const SOURCES_ADD_DESCRIPTION = `Register a source and print its token.`;

// `add` and `rotate` are the only times Cowtail returns a source's token.
export function tokenLines(response: SourceTokenResponse): string {
  return [`Token: ${response.token}`, `This token will not be shown again.`].join("\n");
}

export class SourcesAddCommand extends JsonCommand {
  static paths = [[`sources`, `add`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: SOURCES_ADD_DESCRIPTION,
    examples: [
      [
        `Register the Mac deployer with an icon`,
        `cowtail sources add deployer --name "Mac deployer" --icon deployer.png`,
      ],
    ],
  });

  slug = Option.String();

  name = Option.String(`--name`, { description: `Required. Display name, up to 40 characters.` });

  icon = Option.String(`--icon`, { description: `A square PNG of 64 to 1024 pixels.` });

  async execute(): Promise<void> {
    const request = sourceCreateRequestSchema.safeParse({
      slug: this.slug,
      displayName: this.name,
    });
    if (!request.success) throw validationError(formatIssueList(request.error.issues));

    const created = sourceTokenResponseSchema.parse(
      await postJson("/api/sources", request.data, { requireServiceAuth: true }),
    );
    let response = created;
    if (this.icon) {
      try {
        response = {
          ...created,
          source: (await uploadSourceIcon(created.source.slug, this.icon)).source,
        };
      } catch (error) {
        // The source exists now; its token must not be lost with the failed upload.
        throw new CliError(
          `Created source ${created.source.slug}, but setting its icon failed: ${toCliError(error).message}\n${tokenLines(created)}`,
        );
      }
    }

    this.printSuccess(
      `Created source ${response.source.slug} (${response.source.displayName})\n${tokenLines(response)}`,
      response,
    );
  }
}
