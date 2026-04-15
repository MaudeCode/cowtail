import { Command, Option } from "clipanion";

import { alertCreateRequestSchema, createResponseSchema } from "@maudecode/cowtail-protocol";

import { formatIssueList, validationError } from "../../lib/errors";
import { postJson } from "../../lib/http";
import { JsonCommand } from "../../lib/output";
import { optionalTrimmedString, parseTimestamp, requireNonEmptyString } from "../../lib/parse";

export const ALERT_CREATE_DESCRIPTION = `Create an alert record in Cowtail.`;

export class AlertCreateCommand extends JsonCommand {
  static paths = [[`alert`, `create`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: ALERT_CREATE_DESCRIPTION,
  });

  alertname = Option.String(`--alertname`, {
    description: `Required. Alert name.`,
  });

  severity = Option.String(`--severity`, {
    description: `Required. Alert severity.`,
  });

  namespace = Option.String(`--namespace`, {
    description: `Required. Kubernetes namespace.`,
  });

  status = Option.String(`--status`, {
    description: `Required. Alert status.`,
  });

  outcome = Option.String(`--outcome`, {
    description: `Required. Alert outcome.`,
  });

  summary = Option.String(`--summary`, {
    description: `Required. Alert summary.`,
  });

  action = Option.String(`--action`, {
    description: `Required. Action that was taken.`,
  });

  rootCause = Option.String(`--root-cause`, {
    description: `Root cause text.`,
  });

  node = Option.String(`--node`, {
    description: `Node name.`,
  });

  messaged = Option.Boolean(`--messaged`, {
    description: `Mark the alert as already messaged.`,
  });

  timestamp = Option.String(`--timestamp`, {
    description: `Milliseconds since epoch or ISO timestamp.`,
  });

  resolvedAt = Option.String(`--resolved-at`, {
    description: `Milliseconds since epoch or ISO timestamp.`,
  });

  async execute(): Promise<void> {
    const payloadResult = alertCreateRequestSchema.safeParse({
      alertname: requireNonEmptyString(this.alertname, "alertname"),
      severity: requireNonEmptyString(this.severity, "severity"),
      namespace: requireNonEmptyString(this.namespace, "namespace"),
      status: requireNonEmptyString(this.status, "status"),
      outcome: requireNonEmptyString(this.outcome, "outcome"),
      summary: requireNonEmptyString(this.summary, "summary"),
      action: requireNonEmptyString(this.action, "action"),
      rootCause: optionalTrimmedString(this.rootCause),
      node: optionalTrimmedString(this.node),
      messaged: this.messaged === true ? true : undefined,
      timestamp: parseTimestamp(this.timestamp, "timestamp"),
      resolvedAt: parseTimestamp(this.resolvedAt, "resolved-at"),
    });

    if (!payloadResult.success) {
      throw validationError(formatIssueList(payloadResult.error.issues));
    }

    const response = createResponseSchema.parse(await postJson("/api/alerts", payloadResult.data));

    this.printSuccess(`Created alert ${response.id}`, response);
  }
}
