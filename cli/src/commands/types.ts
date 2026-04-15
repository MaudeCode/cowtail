import type { CommandClass } from "clipanion";

export type CommandEntryDefinition = {
  path: string;
  description: string;
  commandClass: CommandClass;
};

export type CommandGroupDefinition = {
  name: string;
  description: string;
  usage: string;
  commands: CommandEntryDefinition[];
};

export function defineCommandEntry(
  path: string,
  description: string,
  commandClass: CommandClass,
): CommandEntryDefinition {
  return {
    path,
    description,
    commandClass,
  };
}

export function defineCommandGroup(
  name: string,
  description: string,
  commands: CommandEntryDefinition[],
): CommandGroupDefinition {
  return {
    name,
    description,
    usage: `cowtail ${name} <command>`,
    commands,
  };
}
