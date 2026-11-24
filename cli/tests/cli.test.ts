import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import {
  buildCliBinary,
  makeTempDir,
  removeTempDir,
  runCliBinaryAsync,
  runCliBinary,
  writeTempConfig,
} from "./helpers.ts";

let tempDir = "";
let binaryPath = "";

beforeAll(() => {
  tempDir = makeTempDir("cowtail-cli-test-");
  binaryPath = buildCliBinary(tempDir);
});

afterAll(() => {
  removeTempDir(tempDir);
});

describe("built binary help and structure", () => {
  test("root help shows top-level command groups", () => {
    const result = runCliBinary(binaryPath, ["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Commands:");
    expect(result.stdout).toContain("alert");
    expect(result.stdout).toContain("config");
    expect(result.stdout).toContain("roundup");
    expect(result.stdout).toContain("health");
    expect(result.stdout).toContain("push");
    expect(result.stdout).toContain("users");
    expect(result.stdout).toContain("update");
    expect(result.stderr).toBe("");
  }, 30_000);

  test("alert group help shows current subcommands", () => {
    const result = runCliBinary(binaryPath, ["alert", "-h"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("create");
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("show");
    expect(result.stdout).toContain("delete");
  });

  test("fix group help shows current subcommands", () => {
    const result = runCliBinary(binaryPath, ["fix", "-h"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("create");
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("show");
    expect(result.stdout).toContain("delete");
  });

  test("config and users help show newly added subcommands", () => {
    const configResult = runCliBinary(binaryPath, ["config", "-h"]);
    const roundupResult = runCliBinary(binaryPath, ["roundup", "-h"]);
    const usersResult = runCliBinary(binaryPath, ["users", "-h"]);
    const pushResult = runCliBinary(binaryPath, ["push", "-h"]);

    expect(configResult.status).toBe(0);
    expect(configResult.stdout).toContain("validate");
    expect(configResult.stdout).toContain("doctor");

    expect(roundupResult.status).toBe(0);
    expect(roundupResult.stdout).toContain("test");

    expect(usersResult.status).toBe(0);
    expect(usersResult.stdout).toContain("devices");

    expect(pushResult.status).toBe(0);
    expect(pushResult.stdout).toContain("send");
    expect(pushResult.stdout).toContain("test");
    expect(pushResult.stdout).not.toContain("register-device");
  });
});

describe("built binary config and version commands", () => {
  test("config show reads an explicit config path", () => {
    const configPath = writeTempConfig(tempDir, {
      baseUrl: "https://example.invalid/actions",
      pushBearerToken: "secret-token",
      timeoutMs: 3210,
    });

    const result = runCliBinary(binaryPath, ["config", "show", "--json"], {
      env: {
        COWTAIL_CONFIG_PATH: configPath,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const payload = JSON.parse(result.stdout);
    expect(payload.configPath).toBe(configPath);
    expect(payload.baseUrl).toBe("https://example.invalid/actions");
    expect(payload.hasPushBearerToken).toBe(true);
    expect(payload.timeoutMs).toBe(3210);
  });

  test("config show still works when the config file is missing", () => {
    const missingConfigPath = join(tempDir, "missing-show-config.json");
    const result = runCliBinary(binaryPath, ["config", "show", "--json"], {
      env: {
        COWTAIL_CONFIG_PATH: missingConfigPath,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const payload = JSON.parse(result.stdout);
    expect(payload.configPath).toBe(missingConfigPath);
    expect(payload.configFound).toBe(false);
    expect(payload.hasPushBearerToken).toBe(false);
  });

  test("version prints the dev label for local builds", () => {
    const result = runCliBinary(binaryPath, ["version"]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("dev");
    expect(result.stderr).toBe("");
  });

  test("config validate reports a missing config file without network access", () => {
    const missingConfigPath = join(tempDir, "missing-config.json");
    const result = runCliBinary(binaryPath, ["config", "validate", "--json"], {
      env: {
        COWTAIL_CONFIG_PATH: missingConfigPath,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");

    const payload = JSON.parse(result.stdout);
    expect(payload.valid).toBe(false);
    expect(payload.configPath).toBe(missingConfigPath);
    expect(payload.errors).toContain(`Config file not found at ${missingConfigPath}`);
    expect(payload.pushBearerToken).toBeUndefined();
  });

  test("config doctor skips remote checks when config is invalid", () => {
    const missingConfigPath = join(tempDir, "missing-doctor-config.json");
    const result = runCliBinary(binaryPath, ["config", "doctor", "--json"], {
      env: {
        COWTAIL_CONFIG_PATH: missingConfigPath,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");

    const payload = JSON.parse(result.stdout);
    expect(payload.valid).toBe(false);
    expect(payload.checks.health).toBeNull();
    expect(payload.checks.pushAuth).toBeNull();
    expect(payload.pushBearerToken).toBeUndefined();
  });
});

describe("built binary roundup commands", () => {
  test("roundup test validates required args", () => {
    const result = runCliBinary(binaryPath, ["roundup", "test", "--json"]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      ok: false,
      error: "user ID is required",
    });
  });

  test("roundup test validates date-only input", () => {
    const result = runCliBinary(binaryPath, [
      "roundup",
      "test",
      "--user-id",
      "user-123",
      "--from",
      "2026-02-31",
      "--json",
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      ok: false,
      error: "from must be a valid calendar date",
    });
  });

  test("roundup test returns machine-readable success output", async () => {
    const server = createServer((request, response) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/actions/api/roundup/test");
      expect(request.headers.authorization).toBe("Bearer secret-token");

      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        expect(JSON.parse(body)).toEqual({
          userId: "user-123",
          from: "2026-04-14",
          to: "2026-04-14",
        });

        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            ok: true,
            userId: "user-123",
            roundupFrom: "2026-04-14",
            roundupTo: "2026-04-14",
            title: "Cowtail Daily Roundup",
            body: "Apr 14: No alerts fired. Quiet day.",
            sent: 1,
            failed: 0,
            results: [],
          }),
        );
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const port = (server.address() as AddressInfo).port;
      const configPath = writeTempConfig(tempDir, {
        baseUrl: `http://127.0.0.1:${port}/actions`,
        pushBearerToken: "secret-token",
        timeoutMs: 5000,
      });

      const result = await runCliBinaryAsync(
        binaryPath,
        [
          "roundup",
          "test",
          "--user-id",
          "user-123",
          "--from",
          "2026-04-14",
          "--to",
          "2026-04-14",
          "--json",
        ],
        {
          env: {
            COWTAIL_CONFIG_PATH: configPath,
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        ok: true,
        userId: "user-123",
        roundupFrom: "2026-04-14",
        roundupTo: "2026-04-14",
        title: "Cowtail Daily Roundup",
        body: "Apr 14: No alerts fired. Quiet day.",
        sent: 1,
        failed: 0,
        results: [],
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test("roundup test returns machine-readable error output", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "Roundup range is invalid" }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const port = (server.address() as AddressInfo).port;
      const configPath = writeTempConfig(tempDir, {
        baseUrl: `http://127.0.0.1:${port}/actions`,
        pushBearerToken: "secret-token",
        timeoutMs: 5000,
      });

      const result = await runCliBinaryAsync(
        binaryPath,
        ["roundup", "test", "--user-id", "user-123", "--json"],
        {
          env: {
            COWTAIL_CONFIG_PATH: configPath,
          },
        },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toEqual({
        ok: false,
        error: "Request failed (400): Roundup range is invalid",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

describe("built binary authenticated write commands", () => {
  test("alert create sends service authorization", async () => {
    const server = createServer((request, response) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/actions/api/alerts");
      expect(request.headers.authorization).toBe("Bearer secret-token");

      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        expect(JSON.parse(body)).toEqual({
          alertname: "DiskFull",
          severity: "warning",
          namespace: "storage",
          status: "firing",
          outcome: "escalated",
          summary: "Disk is almost full",
          action: "Page storage owner",
        });

        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, id: "alert-123" }));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const port = (server.address() as AddressInfo).port;
      const configPath = writeTempConfig(tempDir, {
        baseUrl: `http://127.0.0.1:${port}/actions`,
        pushBearerToken: "secret-token",
        timeoutMs: 5000,
      });

      const result = await runCliBinaryAsync(
        binaryPath,
        [
          "alert",
          "create",
          "--alertname",
          "DiskFull",
          "--severity",
          "warning",
          "--namespace",
          "storage",
          "--status",
          "firing",
          "--outcome",
          "escalated",
          "--summary",
          "Disk is almost full",
          "--action",
          "Page storage owner",
          "--json",
        ],
        {
          env: {
            COWTAIL_CONFIG_PATH: configPath,
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({ ok: true, id: "alert-123" });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test("alert delete sends service authorization", async () => {
    const server = createServer((request, response) => {
      expect(request.method).toBe("DELETE");
      expect(request.url).toBe("/actions/api/alerts/alert-123");
      expect(request.headers.authorization).toBe("Bearer secret-token");

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const port = (server.address() as AddressInfo).port;
      const configPath = writeTempConfig(tempDir, {
        baseUrl: `http://127.0.0.1:${port}/actions`,
        pushBearerToken: "secret-token",
        timeoutMs: 5000,
      });

      const result = await runCliBinaryAsync(
        binaryPath,
        ["alert", "delete", "--id", "alert-123", "--json"],
        {
          env: {
            COWTAIL_CONFIG_PATH: configPath,
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test("fix create sends service authorization", async () => {
    const server = createServer((request, response) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/actions/api/fixes");
      expect(request.headers.authorization).toBe("Bearer secret-token");

      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        expect(JSON.parse(body)).toEqual({
          alertIds: ["alert-123"],
          description: "Expanded disk",
          rootCause: "Volume was full",
          scope: "reactive",
        });

        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, id: "fix-123" }));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const port = (server.address() as AddressInfo).port;
      const configPath = writeTempConfig(tempDir, {
        baseUrl: `http://127.0.0.1:${port}/actions`,
        pushBearerToken: "secret-token",
        timeoutMs: 5000,
      });

      const result = await runCliBinaryAsync(
        binaryPath,
        [
          "fix",
          "create",
          "--alert-id",
          "alert-123",
          "--description",
          "Expanded disk",
          "--root-cause",
          "Volume was full",
          "--scope",
          "reactive",
          "--json",
        ],
        {
          env: {
            COWTAIL_CONFIG_PATH: configPath,
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({ ok: true, id: "fix-123" });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test("fix delete sends service authorization", async () => {
    const server = createServer((request, response) => {
      expect(request.method).toBe("DELETE");
      expect(request.url).toBe("/actions/api/fixes/fix-123");
      expect(request.headers.authorization).toBe("Bearer secret-token");

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const port = (server.address() as AddressInfo).port;
      const configPath = writeTempConfig(tempDir, {
        baseUrl: `http://127.0.0.1:${port}/actions`,
        pushBearerToken: "secret-token",
        timeoutMs: 5000,
      });

      const result = await runCliBinaryAsync(
        binaryPath,
        ["fix", "delete", "--id", "fix-123", "--json"],
        {
          env: {
            COWTAIL_CONFIG_PATH: configPath,
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

describe("built binary user device commands", () => {
  test("users devices prints token previews instead of raw tokens", async () => {
    const rawToken = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const server = createServer((request, response) => {
      expect(request.method).toBe("GET");
      expect(request.url).toBe("/actions/api/users/user-123/devices");
      expect(request.headers.authorization).toBe("Bearer secret-token");

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          userId: "user-123",
          count: 1,
          devices: [
            {
              id: "device-123",
              deviceTokenPreview: "abcdef...456789",
              platform: "ios",
              environment: "development",
              enabled: true,
              deviceName: "iPhone",
              lastSeenAt: 1,
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        }),
      );
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const port = (server.address() as AddressInfo).port;
      const configPath = writeTempConfig(tempDir, {
        baseUrl: `http://127.0.0.1:${port}/actions`,
        pushBearerToken: "secret-token",
        timeoutMs: 5000,
      });

      const result = await runCliBinaryAsync(
        binaryPath,
        ["users", "devices", "--user-id", "user-123"],
        {
          env: {
            COWTAIL_CONFIG_PATH: configPath,
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("device-123");
      expect(result.stdout).toContain("abcdef...456789");
      expect(result.stdout).not.toContain(rawToken);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

describe("built binary item commands", () => {
  test("notify creates an item that items list then shows", async () => {
    // A stand-in for the Cowtail API: POST /api/items stores, GET /api/items lists.
    const items: Record<string, unknown>[] = [];
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      const reply = (status: number, body: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (request.headers.authorization !== "Bearer secret-token") {
        reply(401, { ok: false, error: "Unauthorized" });
        return;
      }
      if (request.method === "GET" && request.url === "/actions/api/items?needsOwner=false") {
        reply(200, { ok: true, count: items.length, items });
        return;
      }
      if (request.method !== "POST" || request.url !== "/actions/api/items") {
        reply(404, { ok: false, error: "Not found" });
        return;
      }
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const created = JSON.parse(body);
        items.push({
          ...created,
          id: "item-1",
          state: "open",
          needsOwner: false,
          body: created.body ?? "",
          links: created.links ?? [],
          context: created.context ?? {},
          occurrenceCount: 1,
          actions: [],
          createdAt: 1_780_000_000_000,
          updatedAt: 1_780_000_000_000,
        });
        reply(200, { ok: true, id: "item-1", created: true, occurrenceCount: 1 });
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const port = (server.address() as AddressInfo).port;
      const configPath = writeTempConfig(tempDir, {
        baseUrl: `http://127.0.0.1:${port}/actions`,
        pushBearerToken: "secret-token",
        timeoutMs: 5000,
      });
      const env = { env: { COWTAIL_CONFIG_PATH: configPath } };

      const notify = await runCliBinaryAsync(
        binaryPath,
        [
          "notify",
          "--title",
          "Weekly report ready",
          "--kind",
          "fyi",
          "--urgency",
          "whenever",
          "--link",
          "Report=https://reports.example.test/weekly",
          "--context",
          "week=47",
        ],
        env,
      );
      const list = await runCliBinaryAsync(binaryPath, ["items", "list", "--no-needs-owner"], env);

      expect(notify).toMatchObject({ status: 0, stderr: "", stdout: "Created item item-1\n" });
      expect(items).toMatchObject([
        {
          source: "manual",
          kind: "fyi",
          urgency: "whenever",
          title: "Weekly report ready",
          links: [{ label: "Report", url: "https://reports.example.test/weekly" }],
          context: { week: "47" },
        },
      ]);
      expect(list.status).toBe(0);
      expect(list.stderr).toBe("");
      expect(list.stdout).toBe(
        "item-1  2026-05-28T20:26:40.000Z  manual/fyi/whenever  open  Weekly report ready\n",
      );
      expect(requests).toEqual([
        "POST /actions/api/items",
        "GET /actions/api/items?needsOwner=false",
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

describe("built binary validation and updater behavior", () => {
  test("missing required args produce JSON errors on stderr", () => {
    const result = runCliBinary(binaryPath, ["alert", "show", "--json"]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      ok: false,
      error: "id is required",
    });
  });

  test("update --check blocks dev binaries unless forced", () => {
    const result = runCliBinary(binaryPath, ["update", "--check", "--version", "v9.9.9"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Development build detected; use --force");
    expect(result.stderr).toBe("");
  });

  test("update refuses to replace a dev binary without --force", () => {
    const result = runCliBinary(binaryPath, ["update", "--version", "v9.9.9"]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe(
      "Current binary is a development build; rerun with --force to replace it with a release binary",
    );
  });

  test("update --check --force returns machine-readable output", () => {
    const result = runCliBinary(binaryPath, [
      "update",
      "--check",
      "--version",
      "v9.9.9",
      "--force",
      "--json",
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const payload = JSON.parse(result.stdout);
    expect(payload.currentVersion).toBe("dev");
    expect(payload.targetVersion).toBe("v9.9.9");
    expect(payload.updateAvailable).toBe(true);
    expect(payload.updateAllowed).toBe(true);
  });
});
