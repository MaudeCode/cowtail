import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const scriptPath = resolve(import.meta.dir, "setup-worktree-local-config.sh");
const tempRoots: string[] = [];

function makeTempDir(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `${name}-`));
  tempRoots.push(dir);
  return dir;
}

function writeFile(path: string, contents: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("setup-worktree-local-config.sh", () => {
  test("copies repo-local config files into a new worktree", () => {
    const sourceRoot = makeTempDir("cowtail-source");
    const worktreeRoot = makeTempDir("cowtail-worktree");

    writeFile(join(sourceRoot, "web/.env"), "VITE_CONVEX_URL=https://example.test\n");
    writeFile(join(sourceRoot, "ios/Config/project.env"), "APP_NAME=Cowtail\n");

    const result = spawnSync("bash", [scriptPath], {
      env: {
        ...process.env,
        CODEX_SOURCE_TREE_PATH: sourceRoot,
        CODEX_WORKTREE_PATH: worktreeRoot,
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(readFileSync(join(worktreeRoot, "web/.env"), "utf8")).toBe(
      "VITE_CONVEX_URL=https://example.test\n",
    );
    expect(readFileSync(join(worktreeRoot, "ios/Config/project.env"), "utf8")).toBe(
      "APP_NAME=Cowtail\n",
    );
  });

  test("does not overwrite files that already exist in the worktree", () => {
    const sourceRoot = makeTempDir("cowtail-source");
    const worktreeRoot = makeTempDir("cowtail-worktree");

    writeFile(join(sourceRoot, "web/.env"), "VITE_CONVEX_URL=https://source.test\n");
    writeFile(join(worktreeRoot, "web/.env"), "VITE_CONVEX_URL=https://worktree.test\n");

    const result = spawnSync("bash", [scriptPath], {
      env: {
        ...process.env,
        CODEX_SOURCE_TREE_PATH: sourceRoot,
        CODEX_WORKTREE_PATH: worktreeRoot,
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(readFileSync(join(worktreeRoot, "web/.env"), "utf8")).toBe(
      "VITE_CONVEX_URL=https://worktree.test\n",
    );
  });
});
