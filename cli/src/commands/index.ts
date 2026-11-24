import { alertCommandGroup } from "./alert/index.ts";
import { configCommandGroup } from "./config/index.ts";
import { fixCommandGroup } from "./fix/index.ts";
import { healthCommandGroup } from "./health/index.ts";
import { itemsCommandGroup, NotifyCommand, NOTIFY_DESCRIPTION } from "./items/index.ts";
import { maintenanceCommandGroup } from "./maintenance/index.ts";
import { pushCommandGroup } from "./push/index.ts";
import { roundupCommandGroup } from "./roundup/index.ts";
import { sourcesCommandGroup } from "./sources/index.ts";
import { usersCommandGroup } from "./users/index.ts";
import { UpdateCommand, UPDATE_DESCRIPTION } from "./update/index.ts";
import { VersionCommand, VERSION_DESCRIPTION } from "./version/index.ts";
import type { CommandGroupDefinition } from "./types.ts";

export const commandGroups: CommandGroupDefinition[] = [
  alertCommandGroup,
  configCommandGroup,
  roundupCommandGroup,
  fixCommandGroup,
  healthCommandGroup,
  itemsCommandGroup,
  maintenanceCommandGroup,
  pushCommandGroup,
  sourcesCommandGroup,
  usersCommandGroup,
];

export const groupedCommandClasses = commandGroups.flatMap((group) =>
  group.commands.map((entry) => entry.commandClass),
);

export const commandGroupMap = new Map(commandGroups.map((group) => [group.name, group]));

export const leafCommandTargets = new Map(
  commandGroups.flatMap((group) =>
    group.commands.map((entry) => [`${group.name} ${entry.path}`, entry.commandClass] as const),
  ),
);

export const standaloneCommands = [
  {
    path: `notify`,
    description: NOTIFY_DESCRIPTION,
    commandClass: NotifyCommand,
  },
  {
    path: `update`,
    description: UPDATE_DESCRIPTION,
    commandClass: UpdateCommand,
  },
  {
    path: `version`,
    description: VERSION_DESCRIPTION,
    commandClass: VersionCommand,
  },
];

export type { CommandEntryDefinition, CommandGroupDefinition } from "./types.ts";
