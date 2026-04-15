import { defineCommandEntry, defineCommandGroup } from "../types";

import { AlertCreateCommand, ALERT_CREATE_DESCRIPTION } from "./create";
import { AlertDeleteCommand, ALERT_DELETE_DESCRIPTION } from "./delete";
import { AlertListCommand, ALERT_LIST_DESCRIPTION } from "./list";
import { AlertShowCommand, ALERT_SHOW_DESCRIPTION } from "./show";

export const ALERT_GROUP_DESCRIPTION = `Alert record commands.`;

export const alertCommandGroup = defineCommandGroup(`alert`, ALERT_GROUP_DESCRIPTION, [
  defineCommandEntry(`create`, ALERT_CREATE_DESCRIPTION, AlertCreateCommand),
  defineCommandEntry(`list`, ALERT_LIST_DESCRIPTION, AlertListCommand),
  defineCommandEntry(`show`, ALERT_SHOW_DESCRIPTION, AlertShowCommand),
  defineCommandEntry(`delete`, ALERT_DELETE_DESCRIPTION, AlertDeleteCommand),
]);

export { AlertCreateCommand, AlertListCommand, AlertShowCommand, AlertDeleteCommand };
