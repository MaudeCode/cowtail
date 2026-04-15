import { defineCommandEntry, defineCommandGroup } from "../types";

import { ConfigDoctorCommand, CONFIG_DOCTOR_DESCRIPTION } from "./doctor";
import { ConfigShowCommand, CONFIG_SHOW_DESCRIPTION } from "./show";
import { ConfigValidateCommand, CONFIG_VALIDATE_DESCRIPTION } from "./validate";

export const CONFIG_GROUP_DESCRIPTION = `Local config inspection commands.`;

export const configCommandGroup = defineCommandGroup(`config`, CONFIG_GROUP_DESCRIPTION, [
  defineCommandEntry(`show`, CONFIG_SHOW_DESCRIPTION, ConfigShowCommand),
  defineCommandEntry(`validate`, CONFIG_VALIDATE_DESCRIPTION, ConfigValidateCommand),
  defineCommandEntry(`doctor`, CONFIG_DOCTOR_DESCRIPTION, ConfigDoctorCommand),
]);

export { ConfigShowCommand, ConfigValidateCommand, ConfigDoctorCommand };
