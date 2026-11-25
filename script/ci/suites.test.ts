import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { matchesGlob, resolve } from "node:path";

import suites from "@maudecode/ci/lib/suites.js";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const config = JSON.parse(read(".github/ci-suites.json"));
const selected = (path: string) => suites.select(config, [path]).selected;

describe(".github/ci-suites.json", () => {
  // A path no rule matches runs every suite, so a new top-level path would widen CI without anyone choosing it.
  test("a rule matches every tracked path", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
    const unmatched = suites
      .select(config, tracked)
      .paths.filter((path) => path.rule === null)
      .map((path) => path.path);
    expect(unmatched).toEqual([]);
  });

  test("a protocol change runs every suite that consumes the protocol", () => {
    expect(selected("protocol/src/alerts.ts")).toEqual(["global", "web", "cli", "ios"]);
  });

  // The global suite runs the test-rules scan, so every scanned test file must reach it.
  test("an iOS test change runs the global suite's test-rules scan", () => {
    expect(selected("ios/CowtailKit/Tests/CowtailKitTests/App/CowtailStoreTests.swift")).toEqual([
      "global",
      "ios",
    ]);
    expect(selected("ios/CowtailUITests/Support/AppLaunching.swift")).toEqual(["global", "ios"]);
  });

  // ios-sim boots a simulator, about 7 minutes on a hosted Mac, for the tests that need the app host. Its rule is
  // the one list of what those tests cover; this reads that rule rather than a copy of it.
  describe("ios-sim", () => {
    const rule = config.rules.find((candidate: { paths: string[] }) =>
      candidate.paths.includes("ios/CowtailTests/**"),
    );
    const tracked = execFileSync("git", ["ls-files", "-z", "ios"], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);

    test("every path its rule lists runs ios-sim, and the rest of a change still runs ios", () => {
      for (const glob of rule.paths) {
        const covered = tracked.filter((path) => matchesGlob(path, glob));
        expect(covered, `${glob} matches no tracked file`).not.toEqual([]);
        for (const path of covered)
          expect(selected(path), path).toEqual(["global", "ios", "ios-sim"]);
      }
    });

    test("every app-hosted test is in its rule", () => {
      for (const path of tracked.filter((candidate) => candidate.startsWith("ios/CowtailTests/"))) {
        expect(selected(path), path).toContain("ios-sim");
      }
    });

    test("a package or view change runs ios without a simulator", () => {
      expect(selected("ios/CowtailKit/Sources/CowtailKit/App/CowtailStore.swift")).toEqual(["ios"]);
      expect(selected("ios/CowtailApp/Sources/UI/Items/InboxView.swift")).toEqual(["ios"]);
    });
  });

  // This file's own test is in the global suite; a routing change builds no app.
  test("a change to the suites file runs only the global suite", () => {
    expect(selected(".github/ci-suites.json")).toEqual(["global"]);
  });

  test("a Markdown change runs no suite", () => {
    expect(selected("README.md")).toEqual([]);
  });

  test("the @maudecode/ci package and both CI actions pin the same commit", () => {
    const pkg = JSON.parse(read("package.json")).devDependencies["@maudecode/ci"];
    const ci = read(".github/workflows/ci.yml");
    const pins = [
      pkg.match(/^github:MaudeCode\/\.github#([0-9a-f]{40})$/)?.[1],
      ci.match(/MaudeCode\/\.github\/actions\/ci-suites@([0-9a-f]{40})/)?.[1],
      ci.match(/MaudeCode\/\.github\/actions\/ci-gate@([0-9a-f]{40})/)?.[1],
    ];
    expect(pins[0]).toMatch(/^[0-9a-f]{40}$/);
    expect(pins).toEqual([pins[0], pins[0], pins[0]]);
  });
});
