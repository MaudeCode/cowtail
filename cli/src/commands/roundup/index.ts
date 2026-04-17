import { defineCommandEntry, defineCommandGroup } from "../types";

import { RoundupTestCommand, ROUNDUP_TEST_DESCRIPTION } from "./test";

export const ROUNDUP_GROUP_DESCRIPTION = `Daily roundup commands.`;

export const roundupCommandGroup = defineCommandGroup(`roundup`, ROUNDUP_GROUP_DESCRIPTION, [
  defineCommandEntry(`test`, ROUNDUP_TEST_DESCRIPTION, RoundupTestCommand),
]);

export { RoundupTestCommand };
