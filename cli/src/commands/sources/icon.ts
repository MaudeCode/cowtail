import { readFileSync } from "node:fs";

import { Command, Option } from "clipanion";

import { sourceResponseSchema, type SourceResponse } from "@maudecode/cowtail-protocol";

import { validationError } from "../../lib/errors.ts";
import { putBytes } from "../../lib/http.ts";
import { JsonCommand } from "../../lib/output.ts";
import { requireNonEmptyString } from "../../lib/parse.ts";

export const SOURCES_ICON_DESCRIPTION = `Set a source's icon from a square PNG.`;

// Cowtail checks the image: a square PNG of 64 to 1024 pixels, at most 256 KB.
export async function uploadSourceIcon(slug: string, file: string): Promise<SourceResponse> {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    throw validationError(`Cannot read ${file}: ${(error as Error).message}`);
  }
  return sourceResponseSchema.parse(
    await putBytes(
      `/api/sources/${encodeURIComponent(slug)}/icon`,
      { bytes, contentType: "image/png" },
      { requireServiceAuth: true },
    ),
  );
}

export class SourcesIconCommand extends JsonCommand {
  static paths = [[`sources`, `icon`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: SOURCES_ICON_DESCRIPTION,
    examples: [[`Set the deployer's icon`, `cowtail sources icon deployer deployer.png`]],
  });

  slug = Option.String();
  file = Option.String();

  async execute(): Promise<void> {
    const slug = requireNonEmptyString(this.slug, "slug");
    const response = await uploadSourceIcon(slug, requireNonEmptyString(this.file, "file"));
    this.printSuccess(`Set the icon of ${response.source.slug}`, response);
  }
}
