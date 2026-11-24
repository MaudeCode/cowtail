const HOUR_MS = 60 * 60 * 1000;

// The snooze picker's choices in the owner's local zone: an hour, four hours, tomorrow at
// 09:00, and the next Monday after today at 09:00.
export function snoozePresets(now: Date): { label: string; until: number }[] {
  const nineAm = (daysAhead: number) => {
    const day = new Date(now);
    day.setDate(day.getDate() + daysAhead);
    return day.setHours(9, 0, 0, 0);
  };
  return [
    { label: "1 hour", until: now.getTime() + HOUR_MS },
    { label: "4 hours", until: now.getTime() + 4 * HOUR_MS },
    { label: "Tomorrow", until: nineAm(1) },
    { label: "Next Monday", until: nineAm((8 - now.getDay()) % 7 || 7) },
  ];
}
