import { Command, Option } from "clipanion";

import {
  maintenanceWindowListResponseSchema,
  maintenanceWindowResponseSchema,
  maintenanceWindowStartRequestSchema,
  type MaintenanceWindowRecord,
} from "@maudecode/cowtail-protocol";

import { formatIssueList, validationError } from "../../lib/errors.ts";
import { getJson, postJson } from "../../lib/http.ts";
import { JsonCommand } from "../../lib/output.ts";
import { parseDuration, parseKeyValuePairs, requireNonEmptyString } from "../../lib/parse.ts";
import { formatTimestamp } from "../../lib/render.ts";
import { defineCommandEntry, defineCommandGroup } from "../types.ts";

const PATH = "/api/me/maintenance-windows";

// What the window silences, then whether it is running, as one line.
function windowLine(window: MaintenanceWindowRecord): string {
  const scope = [
    ...(window.allAlerts ? ["all alerts"] : []),
    ...window.matchers.map(({ label, value }) => `${label}=${value}`),
    ...window.heldSources,
  ];
  return [
    window.id,
    window.title,
    window.active ? `until ${formatTimestamp(window.endsAt)}` : "over",
    scope.join(", "),
    ...(window.silenceError ? [`silence failed: ${window.silenceError}`] : []),
  ].join("  ");
}

export const MAINTENANCE_START_DESCRIPTION = `Start a maintenance window now.`;

export class MaintenanceStartCommand extends JsonCommand {
  static paths = [[`maintenance`, `start`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: MAINTENANCE_START_DESCRIPTION,
    details: `Alerts the window covers are silenced in Alertmanager, and items it covers do not push. With no --match or --source it covers all alerts. Cowtail's own watchdog items still push.`,
    examples: [
      [
        `Silence the media namespace for an hour`,
        `cowtail maintenance start --title "Cluster upgrade" --for 1h --match namespace=media`,
      ],
      [
        `Hold back Hermes items for 30 minutes`,
        `cowtail maintenance start --for 30m --source hermes`,
      ],
    ],
  });

  title = Option.String(`--title`, { description: `What the work is. Defaults to "Maintenance".` });

  for = Option.String(`--for`, { description: `Required. How long, like 30m, 2h or 1d.` });

  match = Option.Array(`--match`, {
    description: `An alert label=value to silence; repeat to require several.`,
  });

  source = Option.Array(`--source`, {
    description: `An item source to hold back, or * for all; repeatable.`,
  });

  async execute(): Promise<void> {
    const request = maintenanceWindowStartRequestSchema.safeParse({
      title: this.title ?? "Maintenance",
      durationMs: parseDuration(requireNonEmptyString(this.for, "for"), "for"),
      matchers: parseKeyValuePairs(this.match, "match").map(([label, value]) => ({
        label,
        value,
      })),
      sources: this.source ?? [],
    });
    if (!request.success) throw validationError(formatIssueList(request.error.issues));

    const response = maintenanceWindowResponseSchema.parse(
      await postJson(PATH, request.data, { requireServiceAuth: true }),
    );
    this.printSuccess(`Started ${windowLine(response.window)}`, response);
  }
}

export const MAINTENANCE_END_DESCRIPTION = `End a maintenance window now.`;

export class MaintenanceEndCommand extends JsonCommand {
  static paths = [[`maintenance`, `end`]];

  static usage = Command.Usage({ category: `Commands`, description: MAINTENANCE_END_DESCRIPTION });

  id = Option.String();

  async execute(): Promise<void> {
    const id = requireNonEmptyString(this.id, "id");
    const response = maintenanceWindowResponseSchema.parse(
      await postJson(`${PATH}/${encodeURIComponent(id)}/end`, {}, { requireServiceAuth: true }),
    );
    this.printSuccess(`Ended ${windowLine(response.window)}`, response);
  }
}

export const MAINTENANCE_LIST_DESCRIPTION = `List running and recent maintenance windows.`;

export class MaintenanceListCommand extends JsonCommand {
  static paths = [[`maintenance`, `list`]];

  static usage = Command.Usage({ category: `Commands`, description: MAINTENANCE_LIST_DESCRIPTION });

  async execute(): Promise<void> {
    const response = maintenanceWindowListResponseSchema.parse(
      await getJson(PATH, { requireServiceAuth: true }),
    );
    const windows = [...response.active, ...response.recent];
    this.printSuccess(
      windows.length > 0 ? windows.map(windowLine).join("\n") : "No maintenance windows",
      response,
    );
  }
}

export const maintenanceCommandGroup = defineCommandGroup(
  `maintenance`,
  `Maintenance window commands.`,
  [
    defineCommandEntry(`start`, MAINTENANCE_START_DESCRIPTION, MaintenanceStartCommand),
    defineCommandEntry(`end`, MAINTENANCE_END_DESCRIPTION, MaintenanceEndCommand),
    defineCommandEntry(`list`, MAINTENANCE_LIST_DESCRIPTION, MaintenanceListCommand),
  ],
);
