import { validationError } from "./errors";

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
