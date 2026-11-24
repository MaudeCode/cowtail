import { describe, expect, test } from "vitest";

import { sourceCreateRequestSchema, sourcePatchRequestSchema } from "./sources.ts";

describe("source requests", () => {
  test("take a lowercase slug of 2 to 32 characters that starts with a letter", () => {
    const slug = (value: string) =>
      sourceCreateRequestSchema.safeParse({ slug: value, displayName: "Name" }).success;
    expect(["deployer", "t3-factory", `a${"b".repeat(31)}`].map(slug)).toEqual([true, true, true]);
    expect(["d", "3d", "Deployer", "mac_deployer", `a${"b".repeat(32)}`].map(slug)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  test("a patch changes the name or the enabled flag", () => {
    expect(sourcePatchRequestSchema.safeParse({}).success).toBe(false);
    expect(sourcePatchRequestSchema.safeParse({ displayName: "x".repeat(41) }).success).toBe(false);
    expect(sourcePatchRequestSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });
});
