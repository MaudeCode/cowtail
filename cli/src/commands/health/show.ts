import { Command } from "clipanion";

import { healthResponseSchema } from "@maudecode/cowtail-protocol";

import { getJson } from "../../lib/http";
import { JsonCommand } from "../../lib/output";

export const HEALTH_SHOW_DESCRIPTION = `Show cluster health.`;

export class HealthShowCommand extends JsonCommand {
  static paths = [[`health`, `show`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: HEALTH_SHOW_DESCRIPTION,
  });

  async execute(): Promise<void> {
    const response = healthResponseSchema.parse(await getJson("/api/health"));

    if (this.json) {
      this.printJson(response);
      return;
    }

    const nodeLines = response.nodes.map(
      (node) =>
        `${node.name}  ${node.status}  cpu=${node.cpu.toFixed(1)}  mem=${node.memory.toFixed(1)}`,
    );

    this.printLine(
      [
        `Ceph: ${response.cephStatus} (${response.cephMessage})`,
        `Storage: ${response.storageUsed}/${response.storageTotal} ${response.storageUnit}`,
        `Nodes:`,
        ...nodeLines.map((line) => `  ${line}`),
      ].join("\n"),
    );
  }
}
