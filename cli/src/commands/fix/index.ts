import { defineCommandEntry, defineCommandGroup } from "../types";

import { FixCreateCommand, FIX_CREATE_DESCRIPTION } from "./create";

export const FIX_GROUP_DESCRIPTION = `Fix record commands.`;

export const fixCommandGroup = defineCommandGroup(`fix`, FIX_GROUP_DESCRIPTION, [
  defineCommandEntry(`create`, FIX_CREATE_DESCRIPTION, FixCreateCommand),
]);

export { FixCreateCommand };
