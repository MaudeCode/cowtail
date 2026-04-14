export function formatTimestamp(timestamp: number | undefined): string {
  if (timestamp === undefined) {
    return "(not set)";
  }

  return new Date(timestamp).toISOString();
}

export function formatOptionalText(value: string | undefined): string {
  return value ?? "(not set)";
}
