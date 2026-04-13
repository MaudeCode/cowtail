import { usageError, validationError } from "./errors";

export type FlagSpec = {
  type: "boolean" | "string";
  multiple?: boolean;
};

type ParsedFlagValue = boolean | string | string[] | undefined;

export type ParsedFlags = Record<string, ParsedFlagValue>;

export type ParsedArgs = {
  flags: ParsedFlags;
  positionals: string[];
};

export function parseFlags(argv: string[], spec: Record<string, FlagSpec>): ParsedArgs {
  const flags: ParsedFlags = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }

    if (!token.startsWith("--")) {
      throw usageError(`Unknown flag: ${token}`);
    }

    const rawFlag = token.slice(2);
    const equalsIndex = rawFlag.indexOf("=");
    const flagName = equalsIndex >= 0 ? rawFlag.slice(0, equalsIndex) : rawFlag;
    const inlineValue = equalsIndex >= 0 ? rawFlag.slice(equalsIndex + 1) : undefined;
    const flagSpec = spec[flagName];

    if (!flagSpec) {
      throw usageError(`Unknown flag: --${flagName}`);
    }

    if (flagSpec.type === "boolean") {
      if (inlineValue !== undefined) {
        throw usageError(`Flag --${flagName} does not take a value`);
      }

      flags[flagName] = true;
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    if (
      value === undefined
      || (inlineValue === undefined && (value === "--" || value.startsWith("--")))
    ) {
      throw usageError(`Flag --${flagName} requires a value`);
    }

    if (inlineValue === undefined) {
      index += 1;
    }

    if (flagSpec.multiple) {
      const existing = flags[flagName];
      if (existing === undefined) {
        flags[flagName] = [value];
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else if (typeof existing === "string") {
        flags[flagName] = [existing, value];
      } else {
        throw usageError(`Flag --${flagName} cannot be repeated`);
      }
      continue;
    }

    if (flags[flagName] !== undefined) {
      throw usageError(`Flag --${flagName} may only be provided once`);
    }

    flags[flagName] = value;
  }

  return { flags, positionals };
}

export function getBooleanFlag(parsed: ParsedArgs, flagName: string): boolean {
  return parsed.flags[flagName] === true;
}

export function getStringFlag(parsed: ParsedArgs, flagName: string): string | undefined {
  const value = parsed.flags[flagName];
  return typeof value === "string" ? value : undefined;
}

export function getStringArrayFlag(parsed: ParsedArgs, flagName: string): string[] {
  const value = parsed.flags[flagName];
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    return [value];
  }

  return [];
}

export function ensureNoPositionals(parsed: ParsedArgs, message: string): void {
  if (parsed.positionals.length > 0) {
    throw usageError(message);
  }
}

export function requireStringFlag(parsed: ParsedArgs, flagName: string, label = flagName): string {
  return requireNonEmptyString(getStringFlag(parsed, flagName), label);
}

export function requireNonEmptyString(value: string | undefined, label: string): string {
  if (value === undefined) {
    throw validationError(`${label} is required`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw validationError(`${label} is required`);
  }

  return trimmed;
}

export function optionalTrimmedString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

export function parseTimestamp(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw validationError(`${label} must not be empty`);
  }

  if (/^-?\d+$/.test(trimmed)) {
    const numericValue = Number(trimmed);
    if (!Number.isFinite(numericValue)) {
      throw validationError(`${label} must be a valid millisecond timestamp`);
    }

    return Math.trunc(numericValue);
  }

  const parsedValue = Date.parse(trimmed);
  if (Number.isNaN(parsedValue)) {
    throw validationError(`${label} must be a millisecond timestamp or ISO date`);
  }

  return parsedValue;
}

export function parseJsonObject(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw validationError(`${label} must be valid JSON: ${message}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw validationError(`${label} must be a JSON object`);
  }

  return parsed as Record<string, unknown>;
}

export function parseCommaSeparatedStrings(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function assertAllowedValue(value: string, label: string, allowedValues: readonly string[]): string {
  if (!allowedValues.includes(value)) {
    throw validationError(`${label} must be one of: ${allowedValues.join(", ")}`);
  }

  return value;
}
