import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import { NOW } from "./fixtures";

// One shared ceiling for findBy and waitFor; their 1 s default fails on a loaded runner.
configure({ asyncUtilTimeout: 5_000 });

// Every fixture time sits relative to NOW: hold the clock there so the wall clock never decides
// what a page shows. Only Date is faked; timers stay real.
beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
