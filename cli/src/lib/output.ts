import { Command, Option } from "clipanion";

import { toCliError } from "./errors";

type OutputStream = {
  write(chunk: string): unknown;
};

export abstract class BaseCommand extends Command {
  async catch(error: unknown): Promise<void> {
    handleCommandError(error, this.getJsonOutput(), this.context.stderr);
  }

  protected getJsonOutput(): boolean {
    return false;
  }

  protected printSuccess(humanMessage: string, payload: unknown): void {
    if (this.getJsonOutput()) {
      printJson(this.context.stdout, payload);
      return;
    }

    printLine(this.context.stdout, humanMessage);
  }

  protected printJson(payload: unknown): void {
    printJson(this.context.stdout, payload);
  }

  protected printLine(message: string): void {
    printLine(this.context.stdout, message);
  }
}

export abstract class JsonCommand extends BaseCommand {
  json = Option.Boolean(`--json`, {
    description: `Print machine-readable JSON output.`,
  });

  protected override getJsonOutput(): boolean {
    return this.json === true;
  }
}

export function printJson(stream: OutputStream, payload: unknown): void {
  stream.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function printLine(stream: OutputStream, message: string): void {
  stream.write(`${message}\n`);
}

export function handleCommandError(
  error: unknown,
  json: boolean,
  stream: OutputStream = process.stderr,
): void {
  const cliError = toCliError(error);

  if (json) {
    printJson(stream, {
      ok: false,
      error: cliError.message,
    });
  } else {
    printLine(stream, cliError.message);
  }

  process.exitCode = cliError.exitCode;
}

export function formatBoolean(value: boolean): string {
  return value ? "yes" : "no";
}
