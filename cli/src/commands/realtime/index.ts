import { defineCommandEntry, defineCommandGroup } from "../types";

import { RealtimeHealthCommand, REALTIME_HEALTH_DESCRIPTION } from "./health";

export const REALTIME_GROUP_DESCRIPTION = `Cowtail Realtime commands.`;

export const realtimeCommandGroup = defineCommandGroup(`realtime`, REALTIME_GROUP_DESCRIPTION, [
  defineCommandEntry(`health`, REALTIME_HEALTH_DESCRIPTION, RealtimeHealthCommand),
]);

export { RealtimeHealthCommand };
