import { messageAcceptedSchema, messageSendRequestSchema } from "@maudecode/cowtail-protocol";
import { Option } from "clipanion";

import { formatIssueList, validationError } from "../../lib/errors.ts";
import { postJson } from "../../lib/http.ts";
import { JsonCommand } from "../../lib/output.ts";
import { parseLinks } from "../../lib/parse.ts";

export class SendCommand extends JsonCommand {
  static paths = [["send"]];
  message = Option.String({ name: "message" });
  title = Option.String("--title", { description: "Optional heading." });
  priority = Option.String("--priority", { description: "normal, urgent or silent." });
  links = Option.Array("--link", { description: "A labeled link as label=url. Repeatable." });
  idempotencyKey = Option.String("--idempotency-key", {
    description: "Reuse this key when retrying the same message.",
  });

  async execute() {
    const parsed = messageSendRequestSchema.safeParse({
      message: this.message,
      title: this.title,
      priority: this.priority,
      idempotencyKey: this.idempotencyKey,
      links: parseLinks(this.links),
    });
    if (!parsed.success) throw validationError(formatIssueList(parsed.error.issues));
    const result = messageAcceptedSchema.parse(
      await postJson("/api/messages", parsed.data, { requireServiceAuth: true }),
    );
    this.printSuccess(`Accepted message ${result.id}`, result);
  }
}
