import { describe, it, expect } from "vitest";
import { MAX_DELAY_MS, parseDelayMs, effectiveDelayMs } from "./delaySettings";

describe("parseDelayMs (what may be typed into a delay box)", () => {
  it.each([
    ["500", 500],
    ["0", 0],
    ["  2000  ", 2000],
    [String(MAX_DELAY_MS), MAX_DELAY_MS],
  ])("accepts %j", (text, value) => {
    expect(parseDelayMs(text, "X")).toEqual({ ok: true, value });
  });

  it.each(["", "  ", "abc", "-1", "1.5", "12abc", "1e3", "0x10", "٣", String(MAX_DELAY_MS + 1), "99999999999999999999"])(
    "rejects %j, with a message naming the box and the limit",
    (text) => {
      const r = parseDelayMs(text, "Google Translate delay");
      expect(r.ok).toBe(false);
      expect(!r.ok && r.message).toContain("Google Translate delay");
      expect(!r.ok && r.message).toContain(String(MAX_DELAY_MS));
    }
  );
});

describe("effectiveDelayMs (reading a saved value)", () => {
  it("uses a sensible saved value as it is", () => expect(effectiveDelayMs(750, 500)).toBe(750));
  it("allows 0", () => expect(effectiveDelayMs(0, 500)).toBe(0));
  it("caps a value saved before the limit existed", () => expect(effectiveDelayMs(10 * 60_000, 500)).toBe(MAX_DELAY_MS));
  it.each([null, undefined, -5, NaN, Infinity])("falls back for %s", (saved) => {
    expect(effectiveDelayMs(saved as number | null | undefined, 500)).toBe(500);
  });
});