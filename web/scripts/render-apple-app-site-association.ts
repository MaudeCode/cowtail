import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DEFAULT_APP_ID = "TEAMID.com.example.cowtail";

const defaultTemplatePath = join(import.meta.dir, "..", "templates", "apple-app-site-association.template");
const defaultOutputPaths = [
  join(import.meta.dir, "..", "public", "apple-app-site-association"),
  join(import.meta.dir, "..", "public", ".well-known", "apple-app-site-association"),
];

export function renderAppleAppSiteAssociation(template: string, universalLinksAppId: string) {
  return template.replaceAll("${UNIVERSAL_LINKS_APP_ID}", universalLinksAppId);
}

export function writeAppleAppSiteAssociationFiles({
  templatePath = defaultTemplatePath,
  outputPaths = defaultOutputPaths,
  universalLinksAppId = process.env.UNIVERSAL_LINKS_APP_ID || DEFAULT_APP_ID,
}: {
  templatePath?: string;
  outputPaths?: string[];
  universalLinksAppId?: string;
} = {}) {
  const template = readFileSync(templatePath, "utf8");
  const rendered = renderAppleAppSiteAssociation(template, universalLinksAppId);

  for (const outputPath of outputPaths) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, rendered);
  }

  return { rendered, outputPaths, universalLinksAppId };
}

if (import.meta.main) {
  const { outputPaths, universalLinksAppId } = writeAppleAppSiteAssociationFiles();
  console.log(
    `Rendered apple-app-site-association for ${universalLinksAppId} to ${outputPaths.join(", ")}`,
  );
}
