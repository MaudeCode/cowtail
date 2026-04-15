import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  buildCliBinary,
  makeTempDir,
  removeTempDir,
  runCliBinary,
  writeTempConfig,
} from "./helpers";

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
    expect(result.stdout).toContain("health");
    expect(result.stdout).toContain("push");
    expect(result.stdout).toContain("users");
    expect(result.stdout).toContain("update");
    expect(result.stderr).toBe("");
  });

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
    const usersResult = runCliBinary(binaryPath, ["users", "-h"]);
    const pushResult = runCliBinary(binaryPath, ["push", "-h"]);

    expect(configResult.status).toBe(0);
    expect(configResult.stdout).toContain("validate");
    expect(configResult.stdout).toContain("doctor");

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
