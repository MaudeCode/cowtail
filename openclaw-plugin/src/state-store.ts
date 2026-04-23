import fs from "node:fs/promises";
import path from "node:path";

type CowtailState = {
  lastSeenSequence?: number;
};

export class CowtailStateStore {
  readonly filePath: string;

  constructor(stateDir: string, accountId: string) {
    this.filePath = path.join(stateDir, "plugins", "cowtail", accountId, "state.json");
  }

  async readLastSeenSequence(): Promise<number | undefined> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as CowtailState;
      return typeof parsed.lastSeenSequence === "number" &&
        Number.isInteger(parsed.lastSeenSequence) &&
        parsed.lastSeenSequence >= 0
        ? parsed.lastSeenSequence
        : undefined;
    } catch {
      return undefined;
    }
  }

  async writeLastSeenSequence(sequence: number): Promise<void> {
    if (!Number.isInteger(sequence) || sequence < 0) {
      return;
    }
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify({ lastSeenSequence: sequence })}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}
