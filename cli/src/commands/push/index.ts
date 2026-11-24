import { defineCommandEntry, defineCommandGroup } from "../types.ts";

import { PushSendCommand, PUSH_SEND_DESCRIPTION } from "./send.ts";
import { PushTestCommand, PUSH_TEST_DESCRIPTION } from "./test.ts";

export const PUSH_GROUP_DESCRIPTION = `Push notification commands.`;

export const pushCommandGroup = defineCommandGroup(`push`, PUSH_GROUP_DESCRIPTION, [
  defineCommandEntry(`send`, PUSH_SEND_DESCRIPTION, PushSendCommand),
  defineCommandEntry(`test`, PUSH_TEST_DESCRIPTION, PushTestCommand),
]);

export { PushSendCommand, PushTestCommand };
