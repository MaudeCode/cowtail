import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { configError } from "./errors";

export type CowtailConfig = {
  baseUrl?: string;
  pushBearerToken?: string;
  timeoutMs: number;
  configPath: string;
  configFound: boolean;
};

type EnvMap = Record<string, string | undefined>;
type RawConfigValue = Record<string, unknown>;

const DEFAULT_TIMEOUT_MS = 10000;

export function resolveConfigPath(env: EnvMap = process.env): string {
  const explicitPath = env.COWTAIL_CONFIG_PATH?.trim();
  if (explicitPath) {
    return resolve(explicitPath);
  }

  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  if (xdgConfigHome) {
    return resolve(xdgConfigHome, "cowtail", "config.json");
  }

  return join(homedir(), ".config", "cowtail", "config.json");
}

function loadConfigFile(configPath: string): { configFound: boolean; values: RawConfigValue } {
  if (!existsSync(configPath)) {
    return {
      configFound: false,
      values: {},
    };
  }

  const rawText = readFileSync(configPath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse config file at ${configPath}: ${message}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Config file at ${configPath} must contain a JSON object`);
  }

  return {
    configFound: true,
    values: parsed as RawConfigValue,
  };
}

function readOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Config field "${fieldName}" must be a string`);
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function readOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Config field "${fieldName}" must be a positive number`);
  }

  return Math.trunc(value);
}

export function loadConfig(env: EnvMap = process.env): CowtailConfig {
  const configPath = resolveConfigPath(env);
  const { configFound, values } = loadConfigFile(configPath);

  return {
    baseUrl: readOptionalString(values.baseUrl, "baseUrl"),
    pushBearerToken: readOptionalString(values.pushBearerToken, "pushBearerToken"),
    timeoutMs: readOptionalPositiveInteger(values.timeoutMs, "timeoutMs") || DEFAULT_TIMEOUT_MS,
    configPath,
    configFound,
  };
}

export function requireBaseUrl(config: CowtailConfig): string {
  if (!config.baseUrl) {
    throw configError(`baseUrl is required in ${config.configPath}`);
  }

  return config.baseUrl;
}
