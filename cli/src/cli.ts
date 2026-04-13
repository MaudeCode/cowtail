#!/usr/bin/env node

import { runAlertCommand } from "./commands/alert";
import { runAuthCommand } from "./commands/auth";
import { runFixCommand } from "./commands/fix";
import { printHelp } from "./commands/help";
import { runPushCommand } from "./commands/push";
import { runSubsCommand } from "./commands/subs";

async function main(argv: string[]) {
  const [command, subcommand, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp(command === "help" ? argv.slice(1) : []);
    return;
  }

  switch (command) {
    case "alert":
      await runAlertCommand(subcommand, rest);
      return;
    case "fix":
      await runFixCommand(subcommand, rest);
      return;
    case "push":
      await runPushCommand(subcommand, rest);
      return;
    case "subs":
      await runSubsCommand(subcommand, rest);
      return;
    case "auth":
      await runAuthCommand(subcommand, rest);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
