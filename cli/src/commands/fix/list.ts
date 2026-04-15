import { Command, Option } from "clipanion";

import { fixListResponseSchema } from "@maudecode/cowtail-protocol";

import { getJson } from "../../lib/http";
import { JsonCommand } from "../../lib/output";
import { parseTimestamp } from "../../lib/parse";
import { formatTimestamp } from "../../lib/render";

export const FIX_LIST_DESCRIPTION = `List fixes.`;

export class FixListCommand extends JsonCommand {
  static paths = [[`fix`, `list`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: FIX_LIST_DESCRIPTION,
  });

  from = Option.String(`--from`, {
    description: `Start time as milliseconds since epoch or ISO timestamp.`,
  });

  to = Option.String(`--to`, {
    description: `End time as milliseconds since epoch or ISO timestamp.`,
  });

  scope = Option.String(`--scope`, {
    description: `Filter by scope.`,
  });

  alertId = Option.String(`--alert-id`, {
    description: `Filter by linked alert ID.`,
  });

  async execute(): Promise<void> {
    const searchParams = new URLSearchParams();
    addQueryParam(searchParams, "from", parseTimestamp(this.from, "from"));
    addQueryParam(searchParams, "to", parseTimestamp(this.to, "to"));
    addQueryParam(searchParams, "scope", this.scope?.trim());
    addQueryParam(searchParams, "alertId", this.alertId?.trim());

    const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
    const response = fixListResponseSchema.parse(await getJson(`/api/fixes${suffix}`));

    if (this.json) {
      this.printJson(response);
      return;
    }

    if (response.fixes.length === 0) {
      this.printLine("No fixes");
      return;
    }

    this.printLine(
      response.fixes
        .map(
          (fix) => `${fix.id}  ${formatTimestamp(fix.timestamp)}  ${fix.scope}  ${fix.description}`,
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
