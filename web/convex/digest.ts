import type { DailyDigestPushPayload } from "@maudecode/cowtail-protocol";

export type DigestCounts = {
  total: number;
  fixed: number;
  selfResolved: number;
  noise: number;
  escalated: number;
  fixes: number;
};

export type DigestWindow = {
  digestFrom: string;
  digestTo: string;
  digestKey: string;
  fromTimestamp: number;
  toTimestamp: number;
};

function getFormatter(
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    hourCycle: "h23",
    ...options,
    timeZone,
  });
}

function getOffsetMilliseconds(instant: Date, timeZone: string): number {
  const timeZoneName = getFormatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "longOffset",
  })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;

  if (!timeZoneName) {
    throw new Error(`Unable to resolve time zone offset for ${timeZone}`);
  }

  const match = timeZoneName.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) {
    if (timeZoneName === "GMT") {
      return 0;
    }

    throw new Error(`Unsupported time zone offset format: ${timeZoneName}`);
  }

  const [, sign, hours, minutes] = match;
  const magnitude = (Number(hours) * 60 + Number(minutes)) * 60 * 1000;
  return sign === "-" ? -magnitude : magnitude;
}

function zonedDateTimeToUtcTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const offset = getOffsetMilliseconds(new Date(guess), timeZone);
    const nextGuess = Date.UTC(year, month - 1, day, hour, minute, second) - offset;

    if (nextGuess === guess) {
      return guess;
    }

    guess = nextGuess;
  }

  return guess;
}

function datePartsForInstant(instant: Date, timeZone: string) {
  const parts = getFormatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);

  const lookup = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(lookup.get("year")),
    month: Number(lookup.get("month")),
    day: Number(lookup.get("day")),
    hour: Number(lookup.get("hour")),
    minute: Number(lookup.get("minute")),
  };
}

function formatDateOnlyParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDaysToDateOnly(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return formatDateOnlyParts(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

export function dateOnlyForInstant(instant: Date, timeZone: string): string {
  const parts = datePartsForInstant(instant, timeZone);
  return formatDateOnlyParts(parts.year, parts.month, parts.day);
}

export function resolvePreviousDigestWindow(now: Date, timeZone: string): DigestWindow {
  const today = dateOnlyForInstant(now, timeZone);
  const digestFrom = addDaysToDateOnly(today, -1);
  return resolveDigestWindow(digestFrom, digestFrom, timeZone);
}

export function resolveDigestWindow(
  digestFrom: string,
  digestTo: string,
  timeZone: string,
): DigestWindow {
  const [fromYear, fromMonth, fromDay] = digestFrom.split("-").map(Number);
  const nextDateOnly = addDaysToDateOnly(digestTo, 1);
  const [nextYear, nextMonth, nextDay] = nextDateOnly.split("-").map(Number);

  const fromTimestamp = zonedDateTimeToUtcTimestamp(
    fromYear,
    fromMonth,
    fromDay,
    0,
    0,
    0,
    timeZone,
  );
  const nextTimestamp = zonedDateTimeToUtcTimestamp(
    nextYear,
    nextMonth,
    nextDay,
    0,
    0,
    0,
    timeZone,
  );

  return {
    digestFrom,
    digestTo,
    digestKey: `${digestFrom}:${digestTo}`,
    fromTimestamp,
    toTimestamp: nextTimestamp - 1,
  };
}

export function shouldRunDailyDigestAt(now: Date, timeZone: string, localHour: number): boolean {
  const parts = datePartsForInstant(now, timeZone);
  return parts.hour === localHour && parts.minute === 0;
}

export function buildDigestCounts(
  alerts: Array<{ outcome: string }>,
  fixes: Array<unknown>,
): DigestCounts {
  return {
    total: alerts.length,
    fixed: alerts.filter((alert) => alert.outcome === "fixed").length,
    selfResolved: alerts.filter((alert) => alert.outcome === "self-resolved").length,
    noise: alerts.filter((alert) => alert.outcome === "noise").length,
    escalated: alerts.filter((alert) => alert.outcome === "escalated").length,
    fixes: fixes.length,
  };
}

export function formatDigestLabel(digestFrom: string, digestTo: string): string {
  const fromDate = new Date(`${digestFrom}T12:00:00Z`);
  const toDate = new Date(`${digestTo}T12:00:00Z`);
  const fromLabel = fromDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const toLabel = toDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return fromLabel === toLabel ? fromLabel : `${fromLabel}–${toLabel}`;
}

export function buildDailyDigestBody(window: DigestWindow, counts: DigestCounts): string {
  const label = formatDigestLabel(window.digestFrom, window.digestTo);

  if (counts.total === 0) {
    if (counts.fixes > 0) {
      return `${label}: No alerts fired, ${counts.fixes} fix${counts.fixes === 1 ? "" : "es"} shipped.`;
    }

    return `${label}: No alerts fired. Quiet day.`;
  }

  const segments = [
    `${counts.total} alert${counts.total === 1 ? "" : "s"}`,
    `${counts.fixed} fixed`,
    `${counts.selfResolved} self-resolved`,
    `${counts.escalated} escalated`,
  ];

  if (counts.fixes > 0) {
    segments.push(`${counts.fixes} fix${counts.fixes === 1 ? "" : "es"} shipped`);
  }

  return `${label}: ${segments.join(", ")}.`;
}

export function buildDailyDigestPayload(
  window: DigestWindow,
  siteOrigin: string,
): DailyDigestPushPayload {
  const normalizedOrigin = siteOrigin.replace(/\/+$/, "");
  return {
    type: "daily_digest",
    digestFrom: window.digestFrom,
    digestTo: window.digestTo,
    url: `${normalizedOrigin}/digest?from=${window.digestFrom}&to=${window.digestTo}`,
  };
}
