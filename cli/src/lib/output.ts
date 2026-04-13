import { toCliError } from "./errors";

type CommandRunner = (json: boolean) => Promise<void>;

export async function runCommand(rawArgs: string[], runner: CommandRunner): Promise<void> {
  const json = rawArgs.includes("--json");

  try {
    await runner(json);
  } catch (error) {
    handleCommandError(error, json);
  }
}

export function printSuccess(json: boolean, humanMessage: string, payload: unknown): void {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(humanMessage);
}

export function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

export function handleCommandError(error: unknown, json: boolean): void {
  const cliError = toCliError(error);

  if (json) {
    console.error(JSON.stringify({
      ok: false,
      error: cliError.message,
    }, null, 2));
  } else {
    console.error(cliError.message);
  }

  process.exitCode = cliError.exitCode;
}

export function formatBoolean(value: boolean): string {
  return value ? "yes" : "no";
}
