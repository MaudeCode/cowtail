import fs from "node:fs/promises";
import path from "node:path";

type CowtailState = {
  lastSeenSequence?: number;
};

function normalizeAccountId(accountId: string): string {
  const trimmed = accountId.trim();
  if (trimmed.length === 0) {
    throw new Error("Cowtail state accountId must not be empty");
  }
  return encodeURIComponent(trimmed);
}

export class CowtailStateStore {
  readonly filePath: string;

  constructor(stateDir: string, accountId: string) {
    const baseDir = path.resolve(stateDir, "plugins", "cowtail");
    const safeAccountId = normalizeAccountId(accountId);
    const filePath = path.resolve(baseDir, safeAccountId, "state.json");
    const relativePath = path.relative(baseDir, filePath);
    if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) {
      throw new Error("Cowtail state file must remain inside the Cowtail state directory");
    }
    this.filePath = filePath;
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
