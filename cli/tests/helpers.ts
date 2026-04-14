import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = dirname(fileURLToPath(import.meta.url));
const cliDir = dirname(testsDir);

export type CliRunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeTempDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export function buildCliBinary(tempDir: string): string {
  const binaryPath = join(tempDir, "cowtail");
  const result = spawnSync(
    "bun",
    ["build", "./src/cli.ts", "--compile", "--outfile", binaryPath, "--env=COWTAIL_*"],
    {
      cwd: cliDir,
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    throw new Error(`Failed to build test binary:\n${result.stderr || result.stdout}`);
  }

  return binaryPath;
}

export function runCliBinary(
  binaryPath: string,
  args: string[],
  options: {
    env?: Record<string, string | undefined>;
  } = {},
): CliRunResult {
  const result = spawnSync(binaryPath, args, {
    cwd: cliDir,
    env: {
      ...process.env,
      ...options.env,
    },
    encoding: "utf8",
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function writeTempConfig(tempDir: string, value: Record<string, unknown>): string {
  const configPath = join(tempDir, "config.json");
  writeFileSync(configPath, JSON.stringify(value, null, 2));
  return configPath;
}
