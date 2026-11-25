import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import rulesCommand from "@maudecode/ci/lib/rules.js";
import { afterEach, expect, test } from "vitest";

const baseFile = createRequire(import.meta.url).resolve("@maudecode/ci/rules/test-rules.base.json");
const sleepMessage = JSON.parse(readFileSync(baseFile, "utf8")).rules["clock-sleep"].message;
const config = JSON.parse(readFileSync(resolve(import.meta.dirname, "test-rules.json"), "utf8"));
const fixtureNowMessage = config.rules["clock-fixture-now"].message;

const trees: string[] = [];
afterEach(() => {
  for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true });
});

/** Run Cowtail's test-rules config over a disposable tree holding one test file. */
function scan(source: string) {
  const tree = mkdtempSync(join(tmpdir(), "cowtail-test-rules-"));
  trees.push(tree);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), text);
  };
  // The temporary tree has no node_modules, so the shared base is named by its resolved path.
  write("script/ci/test-rules.json", JSON.stringify({ ...config, extends: baseFile }));
  write("web/src/poll.test.ts", source);
  const output: string[] = [];
  const io = {
    cwd: tree,
    out: (line: string) => output.push(line),
    err: (line: string) => output.push(line),
  };
  return {
    status: rulesCommand.rules(["--config", "script/ci/test-rules.json"], io),
    output: output.join("\n"),
  };
}

test("a fixed sleep fails the rules command with the clock-sleep message, and the file without it passes", () => {
  // The delay is interpolated so this file's own source holds no sleep for the rule to count.
  const sleep = `  await new Promise((done) => setTimeout(done, ${100}));\n`;
  const source = `test("polls", async () => {\n${sleep}  await screen.findByText("ready");\n});\n`;

  const failed = scan(source);
  expect(failed.status).toBe(1);
  expect(failed.output).toContain(`web/src/poll.test.ts:2 clock-sleep: ${sleepMessage}`);

  expect(scan(source.replace(sleep, ""))).toEqual({
    status: 0,
    output: expect.stringContaining("none above the baseline"),
  });
});

test("a module-level fixture time read from the real clock fails with the clock-fixture-now message, and one inside a test passes", () => {
  // Assembled so this file's own source holds no top-level real-clock constant for the rule to count.
  const now = ["export const NOW", "Date.now();"].join(" = ");

  const failed = scan(`${now}\n`);
  expect(failed.status).toBe(1);
  expect(failed.output).toContain(`web/src/poll.test.ts:1 clock-fixture-now: ${fixtureNowMessage}`);

  expect(scan(`test("reads now", () => {\n  const start = Date.now();\n});\n`)).toEqual({
    status: 0,
    output: expect.stringContaining("none above the baseline"),
  });
});
