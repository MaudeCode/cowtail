import { Command, Option } from "clipanion";

import { alertListResponseSchema } from "@maudecode/cowtail-protocol";

import { getJson } from "../../lib/http";
import { JsonCommand } from "../../lib/output";
import { parseTimestamp } from "../../lib/parse";
import { formatTimestamp } from "../../lib/render";

export const ALERT_LIST_DESCRIPTION = `List alerts.`;

export class AlertListCommand extends JsonCommand {
  static paths = [[`alert`, `list`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: ALERT_LIST_DESCRIPTION,
  });

  from = Option.String(`--from`, {
    description: `Start time as milliseconds since epoch or ISO timestamp.`,
  });

  to = Option.String(`--to`, {
    description: `End time as milliseconds since epoch or ISO timestamp.`,
  });

  alertname = Option.String(`--alertname`, {
    description: `Filter by alert name.`,
  });

  severity = Option.String(`--severity`, {
    description: `Filter by severity.`,
  });

  namespace = Option.String(`--namespace`, {
    description: `Filter by namespace.`,
  });

  status = Option.String(`--status`, {
    description: `Filter by status.`,
  });

  outcome = Option.String(`--outcome`, {
    description: `Filter by outcome.`,
  });

  async execute(): Promise<void> {
    const searchParams = new URLSearchParams();
    addQueryParam(searchParams, "from", parseTimestamp(this.from, "from"));
    addQueryParam(searchParams, "to", parseTimestamp(this.to, "to"));
    addQueryParam(searchParams, "alertname", this.alertname?.trim());
    addQueryParam(searchParams, "severity", this.severity?.trim());
    addQueryParam(searchParams, "namespace", this.namespace?.trim());
    addQueryParam(searchParams, "status", this.status?.trim());
    addQueryParam(searchParams, "outcome", this.outcome?.trim());

    const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
    const response = alertListResponseSchema.parse(await getJson(`/api/alerts${suffix}`));

    if (this.json) {
      this.printJson(response);
      return;
    }

    if (response.alerts.length === 0) {
      this.printLine("No alerts");
      return;
    }

    this.printLine(
      response.alerts
        .map(
          (alert) =>
            `${alert.id}  ${formatTimestamp(alert.timestamp)}  ${alert.alertname}  ${alert.severity}/${alert.outcome}  ${alert.namespace}`,
        )
        .join("\n"),
    );
  }
}

function addQueryParam(
  searchParams: URLSearchParams,
  key: string,
  value: string | number | undefined,
): void {
  if (value !== undefined && value !== "") {
    searchParams.set(key, String(value));
  }
}
