import { describe, expect, test } from "bun:test";
import { buildCowtailTarget, normalizeCowtailTarget, isSupportedCowtailAgent } from "./session-keys.js";

describe("Cowtail session helpers", () => {
  test("normalizes explicit cowtail target prefixes", () => {
    expect(normalizeCowtailTarget("cowtail:thread_123")).toBe("thread_123");
    expect(normalizeCowtailTarget(" thread_123 ")).toBe("thread_123");
  });

  test("builds direct Cowtail target for a thread id", () => {
    expect(buildCowtailTarget("thread_123")).toBe("cowtail:thread_123");
  });

  test("only supports the default OpenClaw agent in v1", () => {
    expect(isSupportedCowtailAgent("main")).toBe(true);
    expect(isSupportedCowtailAgent("ops")).toBe(false);
  });
});
