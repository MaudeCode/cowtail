import { defineCommandEntry, defineCommandGroup } from "../types";

import { AlertCreateCommand, ALERT_CREATE_DESCRIPTION } from "./create";

export const ALERT_GROUP_DESCRIPTION = `Alert record commands.`;

export const alertCommandGroup = defineCommandGroup(`alert`, ALERT_GROUP_DESCRIPTION, [
  defineCommandEntry(`create`, ALERT_CREATE_DESCRIPTION, AlertCreateCommand),
]);

export { AlertCreateCommand };
