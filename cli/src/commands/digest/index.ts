import { defineCommandEntry, defineCommandGroup } from "../types";

import { DigestTestCommand, DIGEST_TEST_DESCRIPTION } from "./test";

export const DIGEST_GROUP_DESCRIPTION = `Daily digest commands.`;

export const digestCommandGroup = defineCommandGroup(`digest`, DIGEST_GROUP_DESCRIPTION, [
  defineCommandEntry(`test`, DIGEST_TEST_DESCRIPTION, DigestTestCommand),
]);

export { DigestTestCommand };
