import { validationError } from "./errors.ts";

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

const RELATIVE_UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

// A length of time like 30m, 3h or 2d, in milliseconds; undefined for anything else.
function relativeMs(value: string | undefined): number | undefined {
  const relative = value?.trim().match(/^(\d+)([mhd])$/);
  return relative
    ? Number(relative[1]) * RELATIVE_UNIT_MS[relative[2] as keyof typeof RELATIVE_UNIT_MS]
    : undefined;
}

export function parseDuration(value: string | undefined, label: string): number {
  const ms = relativeMs(value);
  if (ms === undefined) throw validationError(`${label} must look like 30m, 2h or 1d`);
  return ms;
}

// A time from now like 30m, 3h or 2d, or a millisecond timestamp or ISO date.
export function parseFutureTime(
  value: string | undefined,
  label: string,
  now = Date.now(),
): number | undefined {
  const relative = relativeMs(value);
  return relative === undefined ? parseTimestamp(value, label) : now + relative;
}

export function parseDateOnly(value: string | undefined, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw validationError(`${label} must not be empty`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw validationError(`${label} must be in YYYY-MM-DD format`);
  }

  const [year, month, day] = trimmed.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw validationError(`${label} must be a valid calendar date`);
  }

  return trimmed;
}

export function parseJsonObject(
  value: string | undefined,
  label: string,
): Record<string, unknown> | undefined {
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

// Splits repeated `key=value` options at the first `=`.
export function parseKeyValuePairs(
  values: string[] | undefined,
  label: string,
): [string, string][] {
  return (values ?? []).map((value) => {
    const separator = value.indexOf("=");
    const key = value.slice(0, separator).trim();
    const entry = value.slice(separator + 1).trim();
    if (separator < 1 || !key || !entry) {
      throw validationError(`${label} must look like key=value`);
    }
    return [key, entry];
  });
}
