import { describe, expect, test } from "bun:test";

const dockerfile = await Bun.file(new URL("../Dockerfile", import.meta.url)).text();
const cowtailApi = await Bun.file(new URL("./cowtailApi.ts", import.meta.url)).text();

describe("realtime Dockerfile", () => {
  test("copies package manifests for every root Bun workspace before install", () => {
    for (const manifest of [
      "COPY web/package.json web/package.json",
      "COPY protocol/package.json protocol/package.json",
      "COPY realtime/package.json realtime/package.json",
    ]) {
      expect(dockerfile.match(new RegExp(manifest, "g"))?.length).toBe(2);
    }
  });

  test("packages generated Convex API imports used by the runtime", () => {
    expect(cowtailApi).toContain("../../web/convex/_generated/api.js");
    expect(dockerfile).toContain("COPY web/convex/_generated web/convex/_generated");
  });
});
