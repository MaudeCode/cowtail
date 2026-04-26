import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const scriptPath = resolve(import.meta.dir, "setup-worktree-local-config.sh");
const hookPath = resolve(import.meta.dir, "..", "..", ".githooks", "post-checkout");
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

  test("git worktree creation runs the post-checkout hook and copies local config", () => {
    const sandboxRoot = makeTempDir("cowtail-hook");
    const repoRoot = join(sandboxRoot, "repo");
    const worktreeRoot = join(sandboxRoot, "wt");

    mkdirSync(repoRoot, { recursive: true });

    const run = (command: string, cwd = repoRoot) =>
      spawnSync("bash", ["-lc", command], {
        cwd,
        encoding: "utf8",
      });

    expect(run("git init -q").status).toBe(0);
    expect(run("git config user.email test@example.com").status).toBe(0);
    expect(run("git config user.name test").status).toBe(0);

    writeFile(join(repoRoot, "README.md"), "test\n");
    writeFile(join(repoRoot, "web/.env"), "VITE_CONVEX_URL=https://source.test\n");
    writeFile(
      join(repoRoot, "script/codex/setup-worktree-local-config.sh"),
      readFileSync(scriptPath, "utf8"),
    );
    writeFile(join(repoRoot, ".githooks/post-checkout"), readFileSync(hookPath, "utf8"));

    expect(
      run("chmod +x script/codex/setup-worktree-local-config.sh .githooks/post-checkout").status,
    ).toBe(0);
    expect(run("git config core.hooksPath .githooks").status).toBe(0);
    expect(
      run(
        "git add README.md web/.env script/codex/setup-worktree-local-config.sh .githooks/post-checkout",
      ).status,
    ).toBe(0);
    expect(run("git commit -q -m init").status).toBe(0);

    const addWorktree = run(`git worktree add "${worktreeRoot}" -b hook-test`);
    expect(addWorktree.status).toBe(0);
    expect(readFileSync(join(worktreeRoot, "web/.env"), "utf8")).toBe(
      "VITE_CONVEX_URL=https://source.test\n",
    );
  });
});
