import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { provenanceCommits } from "./published.mjs";

const scriptPath = resolve(import.meta.dir, "published.mjs");
const sha = "3b7a46842748d7981f984d9125e420be1fd583af";
const otherSha = "f".repeat(40);
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const labelled = (revision: string) => ({
  config: { Labels: { "org.opencontainers.image.revision": revision } },
});

// Runs the image check against a fake `docker` that answers `imagetools inspect` with `image`, or "not found".
function checkImage(image: unknown) {
  const root = mkdtempSync(join(tmpdir(), "cowtail-release-"));
  tempRoots.push(root);
  const output = join(root, "output");
  writeFileSync(output, "");
  writeFileSync(
    join(root, "docker"),
    image === undefined
      ? `#!/bin/sh\necho "ERROR: $4: not found" >&2\nexit 1\n`
      : `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify(image)}\nJSON\n`,
  );
  chmodSync(join(root, "docker"), 0o755);
  const result = spawnSync(
    "node",
    [scriptPath, "image", "ghcr.io/example/cowtail:amd64-v1.2.3", sha],
    {
      encoding: "utf8",
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, GITHUB_OUTPUT: output },
    },
  );
  return { status: result.status, stderr: result.stderr, output: readFileSync(output, "utf8") };
}

describe("published.mjs", () => {
  test.each([
    ["absent", undefined, "publish=true\n"],
    ["published from this commit", labelled(sha), "publish=false\n"],
    [
      "an index whose platforms are all from this commit",
      { "linux/amd64": labelled(sha), "linux/arm64": labelled(sha) },
      "publish=false\n",
    ],
  ])("an image that is %s succeeds", (_, image, output) => {
    expect(checkImage(image)).toMatchObject({ status: 0, output });
  });

  test.each([
    ["published from another commit", labelled(otherSha)],
    [
      "an index with a platform from another commit",
      { "linux/amd64": labelled(sha), "linux/arm64": labelled(otherSha) },
    ],
    ["without a revision label", { config: { Labels: {} } }],
  ])("an image %s is refused", (_, image) => {
    const result = checkImage(image);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Release the next version.");
    expect(result.output).toBe("");
  });

  test("reads the commit from npm's SLSA provenance and ignores the publish attestation", () => {
    const envelope = (statement: unknown) => ({
      dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") },
    });
    const attestations = [
      {
        predicateType: "https://github.com/npm/attestation/tree/main/specs/publish/v0.1",
        bundle: envelope({ predicate: { name: "@maudecode/cowtail-cli", version: "1.2.3" } }),
      },
      {
        predicateType: "https://slsa.dev/provenance/v1",
        bundle: envelope({
          predicate: {
            buildDefinition: {
              resolvedDependencies: [
                {
                  uri: "git+https://github.com/MaudeCode/cowtail@refs/heads/main",
                  digest: { gitCommit: sha },
                },
              ],
            },
          },
        }),
      },
    ];
    expect(provenanceCommits(attestations)).toEqual([sha]);
  });
});
