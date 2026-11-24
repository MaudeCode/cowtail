import { describe, expect, test } from "vitest";

import { itemCreateRequestSchema, itemRecordSchema } from "./items.ts";

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

describe("item records", () => {
  const record = {
    id: "item-1",
    source: "deployer",
    kind: "done",
    urgency: "whenever",
    state: "open",
    needsOwner: false,
    title: "Deployed",
    body: "",
    links: [],
    context: {},
    occurrenceCount: 1,
    actions: [],
    createdAt: 1,
    updatedAt: 1,
  };

  test("carry the source's name, and its icon URL only when it has one", () => {
    const sourceInfo = { slug: "deployer", displayName: "Mac deployer" };
    expect(itemRecordSchema.safeParse(record).success).toBe(false);
    expect(itemRecordSchema.parse({ ...record, sourceInfo }).sourceInfo).toEqual(sourceInfo);
    const iconUrl = "https://cowtail.example.test/actions/api/sources/deployer/icon";
    expect(
      itemRecordSchema.parse({ ...record, sourceInfo: { ...sourceInfo, iconUrl } }).sourceInfo,
    ).toEqual({ ...sourceInfo, iconUrl });
  });
});
