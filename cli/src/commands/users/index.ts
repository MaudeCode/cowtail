import { defineCommandEntry, defineCommandGroup } from "../types";

import { UsersDevicesCommand, USERS_DEVICES_DESCRIPTION } from "./devices";
import { UsersListCommand, USERS_LIST_DESCRIPTION } from "./list";

export const USERS_GROUP_DESCRIPTION = `User inspection commands.`;

export const usersCommandGroup = defineCommandGroup(`users`, USERS_GROUP_DESCRIPTION, [
  defineCommandEntry(`list`, USERS_LIST_DESCRIPTION, UsersListCommand),
  defineCommandEntry(`devices`, USERS_DEVICES_DESCRIPTION, UsersDevicesCommand),
]);

export { UsersListCommand, UsersDevicesCommand };
