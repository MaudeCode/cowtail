import type { ErrorWithMeta } from "clipanion";

export class CliError extends Error {
  exitCode: number;

  constructor(message: string, options: { exitCode?: number } = {}) {
    super(message);
    this.name = "CliError";
    this.exitCode = options.exitCode ?? 1;
  }
}

export function usageError(message: string): CliError {
  return new CliError(message, { exitCode: 2 });
}

export function validationError(message: string): CliError {
  return new CliError(message, { exitCode: 2 });
}

export function configError(message: string): CliError {
  return new CliError(message, { exitCode: 2 });
}

export function formatIssueList(
  issues: Array<{ message: string; path?: ReadonlyArray<PropertyKey> }>,
): string {
  return issues
    .map((issue) => {
      const path = issue.path?.length ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  if (hasClipanionUsageMeta(error) || hasClipanionSyntaxErrorName(error)) {
    return new CliError(error.message, { exitCode: 2 });
  }

  if (error instanceof Error) {
    return new CliError(error.message);
  }

  return new CliError(String(error));
}

function hasClipanionUsageMeta(error: unknown): error is ErrorWithMeta {
  return (
    typeof error === "object"
    && error !== null
    && "clipanion" in error
    && typeof (error as { clipanion?: { type?: unknown } }).clipanion?.type === "string"
    && (error as { clipanion: { type: string } }).clipanion.type === "usage"
    && "message" in error
    && typeof (error as { message?: unknown }).message === "string"
  );
}

function hasClipanionSyntaxErrorName(error: unknown): error is Error {
  return (
    error instanceof Error
    && (error.name === "UnknownSyntaxError" || error.name === "AmbiguousSyntaxError")
  );
}
