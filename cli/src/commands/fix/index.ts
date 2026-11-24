import { defineCommandEntry, defineCommandGroup } from "../types.ts";

import { FixCreateCommand, FIX_CREATE_DESCRIPTION } from "./create.ts";
import { FixDeleteCommand, FIX_DELETE_DESCRIPTION } from "./delete.ts";
import { FixListCommand, FIX_LIST_DESCRIPTION } from "./list.ts";
import { FixShowCommand, FIX_SHOW_DESCRIPTION } from "./show.ts";

export const FIX_GROUP_DESCRIPTION = `Fix record commands.`;

export const fixCommandGroup = defineCommandGroup(`fix`, FIX_GROUP_DESCRIPTION, [
  defineCommandEntry(`create`, FIX_CREATE_DESCRIPTION, FixCreateCommand),
  defineCommandEntry(`list`, FIX_LIST_DESCRIPTION, FixListCommand),
  defineCommandEntry(`show`, FIX_SHOW_DESCRIPTION, FixShowCommand),
  defineCommandEntry(`delete`, FIX_DELETE_DESCRIPTION, FixDeleteCommand),
]);

export { FixCreateCommand, FixListCommand, FixShowCommand, FixDeleteCommand };
