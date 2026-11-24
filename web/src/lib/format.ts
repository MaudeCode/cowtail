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

// 2m, from the largest unit only.
export function formatAge(at: number, now = Date.now()) {
  return formatDuration(now - at).split(" ")[0];
}

export function formatPercent(share: number) {
  return `${Math.round(share * 1000) / 10}%`;
}
