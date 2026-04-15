import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { CliError, usageError } from "./errors";
import { cowtailVersionLabel } from "./version";

const REPO = "MaudeCode/cowtail";

type SupportedOs = "darwin" | "linux";
type SupportedArch = "arm64" | "x64";

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

  const { os, arch } = resolveSupportedPlatform();
  const assetName = `cowtail-${os}-${arch}.tar.gz`;
  const assetUrl = `https://github.com/${REPO}/releases/download/${targetVersion}/${assetName}`;
  const checksumsUrl = `https://github.com/${REPO}/releases/download/${targetVersion}/checksums.txt`;

  const tempRoot = mkdtempSync(join(tmpdir(), "cowtail-update-"));

  try {
    const archivePath = join(tempRoot, assetName);
    const archiveBytes = await download(assetUrl);
    writeFileSync(archivePath, archiveBytes);

    const expectedChecksum = await fetchExpectedChecksum(checksumsUrl, assetName);
    const actualChecksum = sha256(archiveBytes);

    if (expectedChecksum !== actualChecksum) {
      throw new CliError(`Checksum mismatch for ${assetName}`);
    }

    execFileSync("tar", ["-xzf", archivePath, "-C", tempRoot]);

    const extractedBinaryPath = join(tempRoot, "cowtail");
    if (!existsSync(extractedBinaryPath)) {
      throw new CliError(`Release archive did not contain a cowtail binary`);
    }

    const stagingDir = mkdtempSync(join(dirname(executablePath), ".cowtail-update-"));
    const stagedBinaryPath = join(stagingDir, basename(executablePath));

    copyFileSync(extractedBinaryPath, stagedBinaryPath);
    chmodSync(stagedBinaryPath, 0o755);
    renameSync(stagedBinaryPath, executablePath);
    rmSync(stagingDir, { recursive: true, force: true });

    return {
      currentVersion: cowtailVersionLabel,
      targetVersion,
      executablePath,
      updateAvailable: true,
      updateAllowed: true,
      updated: true,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function resolveSelfExecutablePath(): string {
  const executablePath = process.execPath;
  const runtime = basename(executablePath).toLowerCase();

  if (runtime === "bun" || runtime === "bunx" || runtime === "node") {
    throw usageError("Self-update only works from the installed compiled cowtail binary");
  }

  return executablePath;
}

function resolveSupportedPlatform(): { os: SupportedOs; arch: SupportedArch } {
  let os: SupportedOs;
  switch (process.platform) {
    case "darwin":
      os = "darwin";
      break;
    case "linux":
      os = "linux";
      break;
    default:
      throw new CliError(`Unsupported operating system: ${process.platform}`);
  }

  let arch: SupportedArch;
  switch (process.arch) {
    case "arm64":
      arch = "arm64";
      break;
    case "x64":
      arch = "x64";
      break;
    default:
      throw new CliError(`Unsupported architecture: ${process.arch}`);
  }

  return { os, arch };
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

async function fetchExpectedChecksum(checksumsUrl: string, assetName: string): Promise<string> {
  const contents = await downloadText(checksumsUrl);
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const match = trimmed.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match && match[2] === assetName) {
      return match[1].toLowerCase();
    }
  }

  throw new CliError(`Could not find checksum entry for ${assetName}`);
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "cowtail-cli",
    },
  });

  if (!response.ok) {
    throw new CliError(`Failed to download ${url} (${response.status})`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function downloadText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "cowtail-cli",
    },
  });

  if (!response.ok) {
    throw new CliError(`Failed to download ${url} (${response.status})`);
  }

  return await response.text();
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
