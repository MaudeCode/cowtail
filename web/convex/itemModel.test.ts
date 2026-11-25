import type { ItemAction, ItemKind, ItemState } from "@maudecode/cowtail-protocol";
import { describe, expect, test } from "vitest";

import { itemAvailableActions } from "./itemModel";

const ack = { type: "ack" } as const;
const snooze = { type: "snooze" } as const;
const unsnooze = { type: "unsnooze" } as const;
const approve = { type: "approve" } as const;
const deny = { type: "deny" } as const;
const reply = { type: "reply" } as const;
const link = { type: "open", url: "https://logs.example.test/run/1" } as const;

function offered(kind: ItemKind, state: ItemState, actions: ItemAction[], answeredAt?: number) {
  return itemAvailableActions({ kind, state, actions, answeredAt });
}

describe("itemAvailableActions", () => {
  test.each(["fyi", "done", "failure", "alert"] as const)(
    "an open %s its producer gave no actions offers Acknowledge and Snooze",
    (kind) => {
      expect(offered(kind, "open", [])).toEqual([ack, snooze]);
    },
  );

  test.each([
    ["approval", [approve, deny]],
    ["question", [reply]],
  ] as const)("an open %s offers Snooze but no Acknowledge", (kind, actions) => {
    expect(offered(kind, "open", [...actions])).toEqual([...actions, snooze]);
  });

  test("an action the producer declared keeps its place and lists once", () => {
    expect(offered("alert", "open", [snooze, link, ack])).toEqual([snooze, link, ack]);
  });

  test("a snoozed item keeps its declared actions and offers Unsnooze", () => {
    expect(offered("approval", "snoozed", [approve, deny])).toEqual([approve, deny, unsnooze]);
  });

  test("an acked item keeps its declared actions but Acknowledge", () => {
    expect(offered("alert", "acked", [ack, snooze, link])).toEqual([snooze, link]);
  });

  test("an answered item offers no further answer and nothing synthesized", () => {
    expect(offered("fyi", "open", [reply, link], 1)).toEqual([link]);
  });

  test("an answered item snoozed from its push still offers Unsnooze", () => {
    expect(offered("fyi", "snoozed", [reply, link], 1)).toEqual([link, unsnooze]);
  });

  test("a closed item keeps only its links", () => {
    expect(offered("fyi", "resolved", [ack, link])).toEqual([link]);
  });
});
