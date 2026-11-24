import { Command, Option } from "clipanion";

import { itemStatsResponseSchema } from "@maudecode/cowtail-protocol";

import { getJson } from "../../lib/http.ts";
import { JsonCommand } from "../../lib/output.ts";
import { parseTimestamp } from "../../lib/parse.ts";
import { formatTimestamp } from "../../lib/render.ts";

export const ITEMS_STATS_DESCRIPTION = `Show item outcomes, resolve times, noise, repeats, daily volume and what is firing.`;

export class ItemsStatsCommand extends JsonCommand {
  static paths = [[`items`, `stats`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: ITEMS_STATS_DESCRIPTION,
  });

  from = Option.String(`--from`, {
    description: `Start, as milliseconds since epoch or ISO timestamp. Default: 7 days back.`,
  });

  to = Option.String(`--to`, {
    description: `End, as milliseconds since epoch or ISO timestamp. Default: now.`,
  });

  async execute(): Promise<void> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({
      from: parseTimestamp(this.from, "from"),
      to: parseTimestamp(this.to, "to"),
    })) {
      if (value !== undefined) params.set(key, String(value));
    }

    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    const stats = itemStatsResponseSchema.parse(
      await getJson(`/api/items/stats${suffix}`, { requireServiceAuth: true }),
    );

    if (this.json) {
      this.printJson(stats);
      return;
    }

    const pairs = (record: Record<string, number>) =>
      Object.entries(record)
        .map(([key, count]) => `${key} ${count}`)
        .join(", ");
    this.printLine(
      [
        `Range: ${formatTimestamp(stats.from)} to ${formatTimestamp(stats.to)} (${stats.timeZone})`,
        `Created: ${stats.createdCount}`,
        `Resolved: ${stats.resolvedCount} (${pairs(stats.outcomeMix)})`,
        `Noise rate: ${(stats.noiseRate * 100).toFixed(1)}%`,
        "",
        "Time to resolve (median, p90):",
        ...stats.timeToResolve.map(
          (row) => `  ${row.kind}  ${row.medianMs}ms  ${row.p90Ms}ms  (${row.count})`,
        ),
        "",
        "Repeat offenders:",
        ...stats.repeatOffenders.map(
          (row) =>
            `  ${row.title}  x${row.occurrenceCount}  ${Math.round(row.noiseShare * 100)}% noise  last ${formatTimestamp(row.lastSeenAt)}`,
        ),
        "",
        "Daily volume:",
        ...stats.dailyVolume.map(
          (day) => `  ${day.date}  ${day.total}${day.total ? `  (${pairs(day.bySource)})` : ""}`,
        ),
        "",
        `Firing: ${stats.firingCount}`,
        ...stats.firingByNamespace.map((row) => `  ${row.namespace || "(none)"}  ${row.count}`),
      ].join("\n"),
    );
  }
}
