import { defineCommandEntry, defineCommandGroup } from "../types";

import { HealthShowCommand, HEALTH_SHOW_DESCRIPTION } from "./show";

export const HEALTH_GROUP_DESCRIPTION = `Cluster health commands.`;

export const healthCommandGroup = defineCommandGroup(`health`, HEALTH_GROUP_DESCRIPTION, [
  defineCommandEntry(`show`, HEALTH_SHOW_DESCRIPTION, HealthShowCommand),
]);

export { HealthShowCommand };
