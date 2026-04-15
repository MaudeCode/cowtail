import { Command, Option, type CommandClass } from "clipanion";

import {
  commandGroupMap,
  commandGroups,
  leafCommandTargets,
  standaloneCommands,
  type CommandGroupDefinition,
} from "..";
import { usageError } from "../../lib/errors";
import { BaseCommand } from "../../lib/output";

export const HELP_DESCRIPTION = `Show help for the CLI or a specific command.`;
const helpTargets = new Map<string, CommandClass>([
  ...leafCommandTargets,
  ...standaloneCommands.map((entry) => [entry.path, entry.commandClass] as const),
]);

const rootHelpCommands = [
  ...commandGroups.map((group) => ({
    path: group.name,
    description: group.description,
  })),
  { path: `help`, description: HELP_DESCRIPTION },
  ...standaloneCommands.map((entry) => ({
    path: entry.path,
    description: entry.description,
  })),
];

export class HelpCompatCommand extends BaseCommand {
  static paths = [[`help`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: HELP_DESCRIPTION,
  });

  commandPath = Option.Rest({
    name: `command`,
  });

  async execute(): Promise<void> {
    if (this.commandPath.length === 0) {
      this.printLine(renderRootHelp(this.cli.binaryLabel, this.cli.binaryVersion));
      return;
    }

    const key = this.commandPath.join(" ");
    const group = commandGroupMap.get(key);
    if (group) {
      this.printLine(renderGroupHelp(key, group));
      return;
    }

    const target = helpTargets.get(key);
    if (!target) {
      throw usageError(`Unknown help topic: ${key}`);
    }

    this.context.stdout.write(this.cli.usage(target, { detailed: true }));
  }
}

export function getGroupHelpTopic(argv: string[]): string | null {
  const [first, second] = argv;

  if (!first) {
    return null;
  }

  if (commandGroupMap.has(first)) {
    if (argv.length === 1) {
      return first;
    }

    if (argv.length === 2 && (second === "help" || second === "-h" || second === "--help")) {
      return first;
    }
  }

  if (first === "help" && argv.length === 2 && second && commandGroupMap.has(second)) {
    return second;
  }

  return null;
}

export function lookupHelpGroup(topic: string): CommandGroupDefinition | undefined {
  return commandGroupMap.get(topic);
}

export function renderRootHelp(
  binaryLabel: string | undefined,
  binaryVersion: string | undefined,
): string {
  const heading = [binaryLabel ?? `Cowtail CLI`, binaryVersion].filter(Boolean).join(` - `);
  const longestPath = Math.max(...rootHelpCommands.map((entry) => entry.path.length));
  const commandLines = rootHelpCommands
    .map((entry) => `  ${entry.path.padEnd(longestPath)}  ${entry.description}`)
    .join(`\n`);

  return [
    heading,
    ``,
    `Usage:`,
    `  cowtail <command>`,
    ``,
    `Commands:`,
    commandLines,
    ``,
    `Use \`cowtail help <command>\` or \`cowtail <command> -h\` to drill into subcommands.`,
  ].join(`\n`);
}

export function renderGroupHelp(groupName: string, group: CommandGroupDefinition): string {
  const longestPath = Math.max(...group.commands.map((entry) => entry.path.length));
  const commandLines = group.commands
    .map((entry) => `  ${entry.path.padEnd(longestPath)}  ${entry.description}`)
    .join(`\n`);

  return [
    group.description,
    ``,
    `Usage:`,
    `  ${group.usage}`,
    ``,
    `Commands:`,
    commandLines,
    ``,
    `Use \`cowtail ${groupName} <command> -h\` for detailed usage.`,
  ].join(`\n`);
}
