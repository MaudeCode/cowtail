import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  expect(typeof value).toBe("object");
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as JsonRecord;
}

async function readManifest(): Promise<JsonRecord> {
  const manifestPath = fileURLToPath(new URL("../openclaw.plugin.json", import.meta.url));
  return asRecord(await Bun.file(manifestPath).json());
}

describe("openclaw plugin manifest", () => {
  test("declares channel config metadata for cowtail", async () => {
    const manifest = await readManifest();
    expect(manifest.kind).toBe("channel");
    expect(manifest.channels).toContain("cowtail");

    const channelConfigs = asRecord(manifest.channelConfigs);
    const cowtailConfig = asRecord(channelConfigs.cowtail);
    const schema = asRecord(cowtailConfig.schema);
    const properties = asRecord(schema.properties);

    expect(properties.enabled).toBeDefined();
    expect(properties.url).toBeDefined();
    expect(properties.bridgeToken).toBeDefined();
    expect(properties.agentId).toBeDefined();
    expect(properties.connectTimeoutMs).toBeDefined();
    expect(properties.reconnectMinDelayMs).toBeDefined();
    expect(properties.reconnectMaxDelayMs).toBeDefined();
    expect(cowtailConfig.uiHints).toEqual(manifest.uiHints);
  });
});
