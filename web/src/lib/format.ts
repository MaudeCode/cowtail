export function formatTs(ts: string) {
  const d = new Date(ts);
  return (
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      timeZone: "America/New_York",
    }) +
    " " +
    d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    })
  );
}

// 14:02
export function formatClock(at: number) {
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// Today 13:41, Fri 09:00 within the next six days, otherwise 30 Nov 09:00.
export function formatReturnTime(at: number, now = Date.now()) {
  const midnight = (instant: number) => new Date(instant).setHours(0, 0, 0, 0);
  // Rounded, so a day that a DST change shortens or lengthens still counts as one.
  const days = Math.round((midnight(at) - midnight(now)) / 86_400_000);
  if (days === 0) return `Today ${formatClock(at)}`;
  if (days > 0 && days < 7) {
    return `${new Date(at).toLocaleDateString("en-GB", { weekday: "short" })} ${formatClock(at)}`;
  }
  return `${formatShortDate(at)} ${formatClock(at)}`;
}

// Sun 22 Nov 22:31–23:18, or 22:31–now while it lasts.
export function formatSpan(start: number, end?: number) {
  const day = new Date(start).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return `${day} ${formatClock(start)}–${end === undefined ? "now" : formatClock(end)}`;
}

// 12 Nov
export function formatShortDate(at: number) {
  return new Date(at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

// Mon 23 Nov, from the server's YYYY-MM-DD day.
export function formatDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// 19m, 2h 10m, 1m 40s
export function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const parts: [number, string][] = [
    [Math.floor(seconds / 86_400), "d"],
    [Math.floor(seconds / 3_600) % 24, "h"],
    [Math.floor(seconds / 60) % 60, "m"],
    [seconds % 60, "s"],
  ];
  const first = parts.findIndex(([value]) => value > 0);
  if (first === -1) return "0s";
  return parts
    .slice(first, first + 2)
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${value}${unit}`)
    .join(" ");
}

// 0:07, 12:40, 1:02:05: how long a run has taken.
export function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3_600);
  const clock = `${Math.floor(seconds / 60) % 60}:${String(seconds % 60).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${clock.padStart(5, "0")}` : clock;
}

// 2m, from the largest unit only.
export function formatAge(at: number, now = Date.now()) {
  return formatDuration(now - at).split(" ")[0];
}

// 18h, until a time to come, from the largest unit only.
export function formatUntil(at: number, now = Date.now()) {
  return formatAge(now, at);
}

// 14:02 today, otherwise 12 Nov 14:02.
export function formatWhen(at: number, now = Date.now()) {
  return formatShortDate(at) === formatShortDate(now)
    ? formatClock(at)
    : `${formatShortDate(at)} ${formatClock(at)}`;
}

export function formatPercent(share: number) {
  return `${Math.round(share * 1000) / 10}%`;
}
