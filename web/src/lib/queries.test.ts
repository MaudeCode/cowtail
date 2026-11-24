import { expect, test } from "vitest";

import { inbox, item } from "../test/fixtures";
import { showSnoozeInInbox } from "./queries";

// A poll can return the server's result of a write still waiting for its reply.
test("a snooze or unsnooze shown over the server's result of it changes nothing", () => {
  const until = new Date(2030, 0, 2, 9, 0).getTime();
  const snoozed = inbox({
    upcoming: [
      item({ state: "snoozed", needsOwner: false, needsOwnerWhenOpen: true, snoozedUntil: until }),
    ],
  });
  const reopened = inbox({ needsYou: [item({ kind: "approval", needsOwner: true })] });

  expect(showSnoozeInInbox(snoozed, "item-1", { type: "snooze", until }) ?? snoozed).toEqual(
    snoozed,
  );
  expect(showSnoozeInInbox(reopened, "item-1", { type: "unsnooze" }) ?? reopened).toEqual(reopened);
});
