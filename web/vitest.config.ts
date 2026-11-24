import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["convex/**/*.test.ts", "test/**/*.test.ts", "*.test.ts"],
  },
});
