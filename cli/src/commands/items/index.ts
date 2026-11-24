import { defineCommandEntry, defineCommandGroup } from "../types.ts";

import { ItemsListCommand, ITEMS_LIST_DESCRIPTION } from "./list.ts";
import { ItemsShowCommand, ITEMS_SHOW_DESCRIPTION } from "./show.ts";

export const ITEMS_GROUP_DESCRIPTION = `Item commands.`;

export const itemsCommandGroup = defineCommandGroup(`items`, ITEMS_GROUP_DESCRIPTION, [
  defineCommandEntry(`list`, ITEMS_LIST_DESCRIPTION, ItemsListCommand),
  defineCommandEntry(`show`, ITEMS_SHOW_DESCRIPTION, ItemsShowCommand),
]);

export { NotifyCommand, NOTIFY_DESCRIPTION } from "./notify.ts";
