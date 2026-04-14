#!/usr/bin/env node

import { Builtins, Cli, type Command as ClipanionCommand } from "clipanion";

import { groupedCommandClasses, standaloneCommands } from "./commands";
import { HelpCompatCommand, getGroupHelpTopic, lookupHelpGroup, renderGroupHelp, renderRootHelp } from "./commands/help";
import { handleCommandError } from "./lib/output";
import { cowtailVersionLabel } from "./lib/version";

const cli = new Cli({
  binaryLabel: `Cowtail CLI`,
  binaryName: `cowtail`,
  binaryVersion: cowtailVersionLabel,
  enableColors: false,
});

for (const commandClass of [
  Builtins.HelpCommand,
  Builtins.VersionCommand,
  ...groupedCommandClasses,
  HelpCompatCommand,
  ...standaloneCommands.map((entry) => entry.commandClass),
]) {
  cli.register(commandClass);
}

async function main(argv: string[]) {
  const json = argv.includes("--json");

  if (shouldRenderRootHelp(argv)) {
    process.stdout.write(`${renderRootHelp(cli.binaryLabel, cli.binaryVersion)}\n`);
    return;
  }

  const groupHelpTopic = getGroupHelpTopic(argv);
  if (groupHelpTopic) {
    const group = lookupHelpGroup(groupHelpTopic);
    if (!group) {
      throw new Error(`Unknown help topic: ${groupHelpTopic}`);
    }

    const groupHelp = renderGroupHelp(groupHelpTopic, group);
    process.stdout.write(`${groupHelp}\n`);
    return;
  }

  let command: ClipanionCommand;
  try {
    command = cli.process(argv, {});
  } catch (error) {
    handleCommandError(error, json);
    return;
  }

  if (command.help) {
    process.stdout.write(cli.usage(command, { colored: false, detailed: true }));
    return;
  }

  attachMiniCli(command);

  try {
    process.exitCode = await command.validateAndExecute();
  } catch (error) {
    try {
      await command.catch(error);
    } catch (nestedError) {
      handleCommandError(nestedError, json);
    }
  }
}

function attachMiniCli(command: ClipanionCommand): void {
  const context = command.context;

  command.cli = {
    binaryLabel: cli.binaryLabel,
    binaryName: cli.binaryName,
    binaryVersion: cli.binaryVersion,
    enableCapture: cli.enableCapture,
    enableColors: cli.enableColors,
    definitions: () => cli.definitions(),
    definition: (commandClass) => cli.definition(commandClass),
    error: (error, opts) => cli.error(error, opts),
    format: (colored) => cli.format(colored),
    process: (input, subContext) => cli.process(input, { ...context, ...subContext }),
    run: (input, subContext) => cli.run(input, { ...context, ...subContext }),
    usage: (commandClass, opts) => cli.usage(commandClass, opts),
  };
}

main(process.argv.slice(2)).catch((error) => {
  handleCommandError(error, process.argv.slice(2).includes("--json"));
});

function shouldRenderRootHelp(argv: string[]): boolean {
  return (
    argv.length === 0
    || (argv.length === 1 && (argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h"))
  );
}
