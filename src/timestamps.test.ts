import { describe, it, expect } from "vitest";
import { formatLocalTimestamp, isAtLeastAsNew } from "./timestamps";

describe("formatLocalTimestamp", () => {
  it("treats SQLite's bare datetime('now') format as UTC, not local time", () => {
    // Independent of the machine running the test's own timezone: a UTC
    // instant converted to local and back to UTC round-trips exactly.
    const result = formatLocalTimestamp("2026-01-15 12:00:00");
    const parsedBack = new Date(result);
    expect(parsedBack.getTime()).toBe(new Date("2026-01-15T12:00:00Z").getTime());
  });

  it("also handles an already-ISO timestamp (from a merged/imported file) the same way", () => {
    const result = formatLocalTimestamp("2026-01-15T12:00:00.000Z");
    const parsedBack = new Date(result);
    expect(parsedBack.getTime()).toBe(new Date("2026-01-15T12:00:00Z").getTime());
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