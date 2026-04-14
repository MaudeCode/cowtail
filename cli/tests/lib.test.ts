import { describe, expect, test } from "bun:test";

import { CliError } from "../src/lib/errors";
import {
  optionalTrimmedString,
  parseCommaSeparatedStrings,
  parseJsonObject,
  parseTimestamp,
  requireNonEmptyString,
} from "../src/lib/parse";
import { formatOptionalText, formatTimestamp } from "../src/lib/render";

describe("parse helpers", () => {
  test("requireNonEmptyString trims valid input", () => {
    expect(requireNonEmptyString("  value  ", "field")).toBe("value");
  });

  test("requireNonEmptyString throws CliError for empty input", () => {
    expect(() => requireNonEmptyString("   ", "field")).toThrow(CliError);
  });

  test("optionalTrimmedString returns undefined for blank input", () => {
    expect(optionalTrimmedString("   ")).toBeUndefined();
  });

  test("parseTimestamp accepts integer milliseconds", () => {
    expect(parseTimestamp("1712966400000", "timestamp")).toBe(1712966400000);
  });

  test("parseTimestamp accepts ISO timestamps", () => {
    expect(parseTimestamp("2024-04-13T00:00:00Z", "timestamp")).toBe(1712966400000);
  });

  test("parseTimestamp rejects invalid values", () => {
    expect(() => parseTimestamp("definitely-not-a-date", "timestamp")).toThrow(CliError);
  });

  test("parseJsonObject parses object values", () => {
    expect(parseJsonObject('{"hello":"world"}', "data")).toEqual({ hello: "world" });
  });

  test("parseJsonObject rejects non-object JSON", () => {
    expect(() => parseJsonObject('["nope"]', "data")).toThrow(CliError);
  });

  test("parseCommaSeparatedStrings trims and drops empty items", () => {
    expect(parseCommaSeparatedStrings("a, b, ,c")).toEqual(["a", "b", "c"]);
  });
});

describe("render helpers", () => {
  test("formatTimestamp renders ISO strings", () => {
    expect(formatTimestamp(1712966400000)).toBe("2024-04-13T00:00:00.000Z");
  });

  test("formatTimestamp handles missing values", () => {
    expect(formatTimestamp(undefined)).toBe("(not set)");
  });

  test("formatOptionalText handles missing values", () => {
    expect(formatOptionalText(undefined)).toBe("(not set)");
  });
});
