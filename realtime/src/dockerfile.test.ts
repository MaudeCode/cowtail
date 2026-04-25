import { describe, expect, test } from "bun:test";

const dockerfile = await Bun.file(new URL("../Dockerfile", import.meta.url)).text();
const cowtailApi = await Bun.file(new URL("./cowtailApi.ts", import.meta.url)).text();

describe("realtime Dockerfile", () => {
  test("packages generated Convex API imports used by the runtime", () => {
    expect(cowtailApi).toContain("../../web/convex/_generated/api.js");
    expect(dockerfile).toContain("COPY web/convex/_generated web/convex/_generated");
  });
});
