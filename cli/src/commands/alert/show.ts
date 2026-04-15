import { Command, Option } from "clipanion";

import { alertGetResponseSchema } from "@maudecode/cowtail-protocol";

import { getJson } from "../../lib/http";
import { JsonCommand } from "../../lib/output";
import { requireNonEmptyString } from "../../lib/parse";
import { formatOptionalText, formatTimestamp } from "../../lib/render";

export const ALERT_SHOW_DESCRIPTION = `Show a single alert.`;

export class AlertShowCommand extends JsonCommand {
  static paths = [[`alert`, `show`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: ALERT_SHOW_DESCRIPTION,
  });

  id = Option.String(`--id`, {
    description: `Required. Alert ID.`,
  });

  async execute(): Promise<void> {
    const id = requireNonEmptyString(this.id, "id");
    const response = alertGetResponseSchema.parse(
      await getJson(`/api/alerts/${encodeURIComponent(id)}`),
    );

    if (this.json) {
      this.printJson(response);
      return;
    }

    const alert = response.alert;
    this.printLine(
      [
        `ID: ${alert.id}`,
        `Timestamp: ${formatTimestamp(alert.timestamp)}`,
        `Alert: ${alert.alertname}`,
        `Severity: ${alert.severity}`,
        `Namespace: ${alert.namespace}`,
        `Node: ${formatOptionalText(alert.node)}`,
        `Status: ${alert.status}`,
        `Outcome: ${alert.outcome}`,
        `Summary: ${alert.summary}`,
        `Action: ${alert.action}`,
        `Root cause: ${formatOptionalText(alert.rootCause)}`,
        `Messaged: ${alert.messaged ? "yes" : "no"}`,
        `Resolved at: ${formatTimestamp(alert.resolvedAt)}`,
      ].join("\n"),
    );
  }
}
