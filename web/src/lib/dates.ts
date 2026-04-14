/**
 * Parse a date-only string (YYYY-MM-DD) as local midnight.
 *
 * JavaScript's `new Date("2026-03-22")` parses as UTC midnight,
 * which shifts to the previous day in western timezones.
 * This function always parses as local time.
 */
export function parseLocalDate(dateStr: string): Date {
  // If it's already a full ISO string or has time info, parse normally
  if (dateStr.includes("T") || dateStr.includes(" ")) {
    return new Date(dateStr);
  }
  // Date-only: append T00:00:00 (no Z) so it parses as local time
  return new Date(dateStr + "T00:00:00");
}

/**
 * Parse a date-only string as the END of that day in local time (23:59:59).
 */
export function parseLocalDateEnd(dateStr: string): Date {
  if (dateStr.includes("T") || dateStr.includes(" ")) {
    return new Date(dateStr);
  }
  return new Date(dateStr + "T23:59:59");
}

/**
 * Format a Date as YYYY-MM-DD in local time.
 */
export function formatDateLocal(d: Date): string {
  return d.toLocaleDateString("en-CA"); // en-CA gives YYYY-MM-DD format
}
