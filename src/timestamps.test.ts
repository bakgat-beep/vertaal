import { describe, it, expect } from "vitest";
import { formatLocalTimestamp, isAtLeastAsNew } from "./timestamps";

describe("formatLocalTimestamp", () => {
  it("treats SQLite's bare datetime('now') format as UTC, not local time", () => {
    // toLocaleString()'s exact output (date order, 12/24-hour, separators)
    // depends on the machine's own locale, and isn't reliably re-parseable
    // by `new Date()` — for example en-NZ renders it as "16/01/2026, 1:00:00
    // am", which `new Date()` cannot read back. So rather than round-trip
    // through the display string, compare two spellings of the SAME UTC
    // instant: if the bare format were wrongly parsed as LOCAL time instead
    // of UTC, these would render differently (off by the local UTC offset).
    // Locale-independent either way.
    expect(formatLocalTimestamp("2026-01-15 12:00:00")).toBe(formatLocalTimestamp("2026-01-15T12:00:00.000Z"));
  });

  it("actually parses and formats the timestamp, rather than just returning it unchanged", () => {
    // Guards against the comparison above passing "by accident" — e.g. if
    // both sides hit the invalid-date fallback and returned their (still
    // different) raw inputs, they'd correctly NOT be equal, but for the
    // wrong reason. This confirms the bare-format input really did get
    // parsed and reformatted, not passed through as-is.
    expect(formatLocalTimestamp("2026-01-15 12:00:00")).not.toBe("2026-01-15 12:00:00");
  });

  it("falls back to the raw text for something unparseable, rather than showing 'Invalid Date'", () => {
    expect(formatLocalTimestamp("not a date")).toBe("not a date");
  });
});

describe("isAtLeastAsNew", () => {
  it("compares two SQLite-format timestamps correctly (the ordinary case)", () => {
    expect(isAtLeastAsNew("2026-01-15 23:59:59", "2026-01-15 00:00:01")).toBe(true);
    expect(isAtLeastAsNew("2026-01-15 00:00:01", "2026-01-15 23:59:59")).toBe(false);
  });

  it("compares correctly across formats — SQLite vs ISO — by actual time, not text", () => {
    // A real-world case this fixes: a local edit made late in the day
    // (SQLite format) being wrongly treated as OLDER than an earlier-in-the-
    // day change from a merged file (ISO format), because " " sorts before
    // "T" as plain text even though 23:59:59 is later than 00:00:01.
    expect(isAtLeastAsNew("2026-01-15 23:59:59", "2026-01-15T00:00:01.000Z")).toBe(true);
    expect(isAtLeastAsNew("2026-01-15T00:00:01.000Z", "2026-01-15 23:59:59")).toBe(false);
  });

  it("returns false, not a throw, when either side is missing", () => {
    expect(isAtLeastAsNew(null, "2026-01-15 00:00:00")).toBe(false);
    expect(isAtLeastAsNew("2026-01-15 00:00:00", undefined)).toBe(false);
    expect(isAtLeastAsNew(null, null)).toBe(false);
  });
});