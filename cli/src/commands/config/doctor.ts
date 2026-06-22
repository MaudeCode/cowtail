import { Command } from "clipanion";

import { getJson } from "../../lib/http";
import { JsonCommand } from "../../lib/output";
import { inspectConfig } from "../../lib/config";
import { healthResponseSchema, usersListResponseSchema } from "@maudecode/cowtail-protocol";

export const CONFIG_DOCTOR_DESCRIPTION = `Run basic local and remote CLI diagnostics.`;

type DoctorReport = ReturnType<typeof inspectConfig> & {
  checks: {
    health: { ok: boolean; message: string } | null;
    pushAuth: { ok: boolean; message: string } | null;
  };
};

export class ConfigDoctorCommand extends JsonCommand {
  static paths = [[`config`, `doctor`]];

  static usage = Command.Usage({
    category: `Commands`,
    description: CONFIG_DOCTOR_DESCRIPTION,
  });

  async execute(): Promise<number> {
    const report = inspectConfig();
    const doctorReport: DoctorReport = {
      ...report,
      checks: {
        health: null,
        pushAuth: null,
      },
    };

    if (report.valid) {
      try {
        const health = healthResponseSchema.parse(await getJson("/api/health"));
        doctorReport.checks.health = {
          ok: true,
          message: `Health endpoint reachable (${health.cephStatus})`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        doctorReport.checks.health = {
          ok: false,
          message,
        };
      }

      if (report.hasPushBearerToken) {
        try {
          const users = usersListResponseSchema.parse(
            await getJson("/api/users", { requireServiceAuth: true }),
          );
          doctorReport.checks.pushAuth = {
            ok: true,
            message: `Authenticated user listing reachable (${users.count} users)`,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          doctorReport.checks.pushAuth = {
            ok: false,
            message,
          };
        }
      } else {
        doctorReport.checks.pushAuth = {
          ok: false,
          message: "pushBearerToken not configured; skipping authenticated check",
        };
      }
    }

    const ok =
      report.valid &&
      doctorReport.checks.health?.ok === true &&
      (doctorReport.checks.pushAuth?.ok === true || !report.hasPushBearerToken);

    if (this.json) {
      this.printJson(doctorReport);
    } else {
      this.printLine(
        [
          `Config: ${report.valid ? "ok" : "invalid"} (${report.configPath})`,
          ...report.errors.map((error) => `- ${error}`),
          `Health: ${doctorReport.checks.health?.message ?? "skipped"}`,
          `Push auth: ${doctorReport.checks.pushAuth?.message ?? "skipped"}`,
        ].join("\n"),
      );
    }

    return ok ? 0 : 1;
  }
}
