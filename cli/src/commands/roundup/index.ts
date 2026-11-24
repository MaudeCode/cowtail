import { defineCommandEntry, defineCommandGroup } from "../types.ts";

import { RoundupTestCommand, ROUNDUP_TEST_DESCRIPTION } from "./test.ts";

export const ROUNDUP_GROUP_DESCRIPTION = `Daily roundup commands.`;

export const roundupCommandGroup = defineCommandGroup(`roundup`, ROUNDUP_GROUP_DESCRIPTION, [
  defineCommandEntry(`test`, ROUNDUP_TEST_DESCRIPTION, RoundupTestCommand),
]);

export { RoundupTestCommand };
