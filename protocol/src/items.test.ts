import { describe, expect, test } from "vitest";

import {
  itemCreateRequestSchema,
  itemEventRecordSchema,
  itemRecordSchema,
  priorOccurrenceSchema,
} from "./items.ts";

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

describe("investigation history on item detail", () => {
  test("an event keeps the evidence Hermes recorded", () => {
    const evidence = [{ step: "Read logs", command: "kubectl logs pod", output: "OOMKilled" }];
    const event = {
      id: "event-1",
      itemId: "item-1",
      at: 1,
      type: "hermes_update",
      actor: "hermes",
      payload: { text: "Raised the limit" },
      evidence,
    };
    expect(itemEventRecordSchema.parse(event).evidence).toEqual(evidence);
  });

  test("a prior occurrence carries its result and its fixes, the commit optional", () => {
    const prior = {
      alertId: "alert-1",
      firedAt: 1,
      resolvedAt: 2,
      outcome: "fixed",
      rootCause: "Memory limit too low",
      summary: "OOMKilled at 256Mi",
      ownerDisposition: "escalated",
      cause: "Memory limit too low",
      fixCommit: "7be01d4",
      fixes: [
        { description: "Raise the limit", rootCause: "Memory limit too low", commit: "7be01d4" },
        { description: "Drain the node", rootCause: "Bad node" },
      ],
    };
    expect(priorOccurrenceSchema.parse(prior)).toEqual(prior);
    expect(priorOccurrenceSchema.safeParse({ ...prior, outcome: "recorded" }).success).toBe(false);
  });
});
