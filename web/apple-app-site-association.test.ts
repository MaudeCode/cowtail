import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("apple-app-site-association generation", () => {
  test("writes both served paths from one template", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "cowtail-aasa-"));
    const templatePath = join(tempRoot, "apple-app-site-association.template");
    const rootOutputPath = join(tempRoot, "public", "apple-app-site-association");
    const wellKnownOutputPath = join(
      tempRoot,
      "public",
      ".well-known",
      "apple-app-site-association",
    );

    await Bun.write(
      templatePath,
      JSON.stringify(
        {
          applinks: {
            apps: [],
            details: [
              {
                appID: "${UNIVERSAL_LINKS_APP_ID}",
                paths: ["/", "/roundup", "/roundup/*", "/fixes", "/fixes/*"],
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    const { writeAppleAppSiteAssociationFiles } = await import(
      "./scripts/render-apple-app-site-association"
    );

    writeAppleAppSiteAssociationFiles({
      templatePath,
      universalLinksAppId: "TEAMID.com.example.cowtail",
      outputPaths: [rootOutputPath, wellKnownOutputPath],
    });

    const rootOutput = readFileSync(rootOutputPath, "utf8");
    const wellKnownOutput = readFileSync(wellKnownOutputPath, "utf8");

    expect(rootOutput).toContain('"appID": "TEAMID.com.example.cowtail"');
    expect(rootOutput).toContain('"/roundup"');
    expect(rootOutput).toContain('"/roundup/*"');
    expect(wellKnownOutput).toBe(rootOutput);
  });
});
