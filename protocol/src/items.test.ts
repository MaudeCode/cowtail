import { describe, expect, test } from "vitest";

import { itemCreateRequestSchema } from "./items.ts";

const request = { source: "hermes", kind: "fyi", urgency: "whenever", title: "Weekly report" };

describe("item create requests", () => {
  test("refuse keys the item store cannot hold", () => {
    for (const key of ["_id", "$set", ""]) {
      expect(
        itemCreateRequestSchema.safeParse({ ...request, context: { [key]: "x" } }).success,
      ).toBe(false);
      expect(
        itemCreateRequestSchema.safeParse({ ...request, replyTo: { [key]: "x" } }).success,
      ).toBe(false);
    }
    expect(
      itemCreateRequestSchema.parse({
        ...request,
        context: { "k8s.namespace": "media" },
        replyTo: { session_id: "abc" },
      }),
    ).toMatchObject({ context: { "k8s.namespace": "media" }, replyTo: { session_id: "abc" } });
  });

  test("accept only web links", () => {
    const link = (url: string) =>
      itemCreateRequestSchema.safeParse({ ...request, links: [{ label: "Log", url }] }).success;
    expect(link("https://logs.example.test/run/1")).toBe(true);
    expect(link("javascript:alert(1)")).toBe(false);
  });
});
