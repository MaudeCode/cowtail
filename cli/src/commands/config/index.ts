import { defineCommandEntry, defineCommandGroup } from "../types";

import { ConfigShowCommand, CONFIG_SHOW_DESCRIPTION } from "./show";

export const CONFIG_GROUP_DESCRIPTION = `Local config inspection commands.`;

export const configCommandGroup = defineCommandGroup(`config`, CONFIG_GROUP_DESCRIPTION, [
  defineCommandEntry(`show`, CONFIG_SHOW_DESCRIPTION, ConfigShowCommand),
]);

export { ConfigShowCommand };
