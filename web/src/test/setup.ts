import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// One shared ceiling for findBy and waitFor; their 1 s default fails on a loaded runner.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
