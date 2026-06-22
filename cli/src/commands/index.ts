import { alertCommandGroup } from "./alert";
import { configCommandGroup } from "./config";
import { fixCommandGroup } from "./fix";
import { healthCommandGroup } from "./health";
import { pushCommandGroup } from "./push";
import { roundupCommandGroup } from "./roundup";
import { usersCommandGroup } from "./users";
import { UpdateCommand, UPDATE_DESCRIPTION } from "./update";
import { VersionCommand, VERSION_DESCRIPTION } from "./version";
import type { CommandGroupDefinition } from "./types";

export const commandGroups: CommandGroupDefinition[] = [
  alertCommandGroup,
  configCommandGroup,
  roundupCommandGroup,
  fixCommandGroup,
  healthCommandGroup,
  pushCommandGroup,
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

export type { CommandEntryDefinition, CommandGroupDefinition } from "./types";
