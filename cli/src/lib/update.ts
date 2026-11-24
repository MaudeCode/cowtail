import { spawnSync } from "node:child_process";

import { CliError, usageError } from "./errors.ts";
import { cowtailVersionLabel } from "./version.ts";

const REPO = "MaudeCode/cowtail";
const PACKAGE_NAME = "@maudecode/cowtail-cli";

export type UpdateCheckResult = {
  currentVersion: string;
  targetVersion: string;
  executablePath: string;
  updateAvailable: boolean;
  updateAllowed: boolean;
  blockedReason?: string;
};

export type UpdateInstallResult = UpdateCheckResult & {
  updated: boolean;
};

export async function checkForUpdate(
  requestedVersion?: string,
  options: { force?: boolean } = {},
): Promise<UpdateCheckResult> {
  const executablePath = resolveSelfExecutablePath();
  const targetVersion = requestedVersion
    ? normalizeVersion(requestedVersion)
    : await fetchLatestReleaseTag();
  const updateAllowed = !isDevBuild() || options.force === true;

  return {
    currentVersion: cowtailVersionLabel,
    targetVersion,
    executablePath,
    updateAvailable: cowtailVersionLabel !== targetVersion,
    updateAllowed,
    blockedReason: updateAllowed ? undefined : "dev-build",
  };
}

export async function installUpdate(
  requestedVersion?: string,
  options: { force?: boolean } = {},
): Promise<UpdateInstallResult> {
  const executablePath = resolveSelfExecutablePath();
  const targetVersion = requestedVersion
    ? normalizeVersion(requestedVersion)
    : await fetchLatestReleaseTag();

  if (isDevBuild() && options.force !== true) {
    throw usageError(
      "Current binary is a development build; rerun with --force to replace it with a release binary",
    );
  }

  if (cowtailVersionLabel === targetVersion) {
    return {
      currentVersion: cowtailVersionLabel,
      targetVersion,
      executablePath,
      updateAvailable: false,
      updateAllowed: true,
      updated: false,
    };
  }

  if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(targetVersion)) {
    throw usageError(`${targetVersion} is not a release version`);
  }

  // The CLI ships as an npm package only, so updating installs the requested version globally.
  const result = spawnSync(
    "npm",
    ["install", "--global", `${PACKAGE_NAME}@${targetVersion.slice(1)}`],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? (result.stderr || result.stdout).trim();
    throw new CliError(`Failed to install ${PACKAGE_NAME}@${targetVersion}: ${detail}`);
  }

  return {
    currentVersion: cowtailVersionLabel,
    targetVersion,
    executablePath,
    updateAvailable: true,
    updateAllowed: true,
    updated: true,
  };
}

function resolveSelfExecutablePath(): string {
  return process.argv[1] ?? process.execPath;
}

function normalizeVersion(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw usageError("version must not be empty");
  }

  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function isDevBuild(): boolean {
  return cowtailVersionLabel === "dev";
}

async function fetchLatestReleaseTag(): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "cowtail-cli",
    },
  });

  if (!response.ok) {
    throw new CliError(`Failed to resolve latest release (${response.status})`);
  }

  const payload = (await response.json()) as { tag_name?: unknown };
  if (typeof payload.tag_name !== "string" || payload.tag_name.trim() === "") {
    throw new CliError("Latest release response did not include a tag_name");
  }

  return payload.tag_name.trim();
}
