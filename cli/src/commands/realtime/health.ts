import { Command } from "clipanion";

import { loadRealtimeHealthStatus } from "../../lib/realtime";
import { JsonCommand } from "../../lib/output";

export const REALTIME_HEALTH_DESCRIPTION = `Check Cowtail Realtime health.`;

export class RealtimeHealthCommand extends JsonCommand {
  static paths = [[`realtime`, `health`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: REALTIME_HEALTH_DESCRIPTION,
  });

  async execute(): Promise<void> {
    const result = await loadRealtimeHealthStatus();

    if (this.json) {
      this.printJson(result);
      return;
    }

    this.printLine(`Cowtail Realtime healthy: ${result.url} (${result.statusCode})`);
  }
}
