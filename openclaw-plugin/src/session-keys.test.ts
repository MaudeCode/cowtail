import { describe, expect, test } from "bun:test";
import {
  buildCowtailTarget,
  normalizeCowtailTarget,
  resolveCowtailThreadIdFromSessionKey,
  isSupportedCowtailAgent,
} from "./session-keys.js";

describe("Cowtail session helpers", () => {
  test("normalizes explicit cowtail target prefixes", () => {
    expect(normalizeCowtailTarget("cowtail:thread_123")).toBe("thread_123");
    expect(normalizeCowtailTarget(" thread_123 ")).toBe("thread_123");
  });

  test("builds direct Cowtail target for a thread id", () => {
    expect(buildCowtailTarget("thread_123")).toBe("cowtail:thread_123");
  });

  test("extracts Cowtail thread ids from agent-routed session keys", () => {
    expect(resolveCowtailThreadIdFromSessionKey("agent:main:cowtail:thread_123")).toBe(
      "thread_123",
    );
    expect(resolveCowtailThreadIdFromSessionKey("agent:main:cowtail:direct:thread_123")).toBe(
      "thread_123",
    );
    expect(
      resolveCowtailThreadIdFromSessionKey("agent:main:cowtail:default:direct:thread_123"),
    ).toBe("thread_123");
    expect(resolveCowtailThreadIdFromSessionKey("agent:main:direct:thread_123")).toBe("thread_123");
  });

  test("does not treat bare Cowtail targets as thread document ids", () => {
    expect(resolveCowtailThreadIdFromSessionKey("cowtail:thread_123")).toBeUndefined();
  });

  test("only supports the default OpenClaw agent in v1", () => {
    expect(isSupportedCowtailAgent("main")).toBe(true);
    expect(isSupportedCowtailAgent("ops")).toBe(false);
  });
});
