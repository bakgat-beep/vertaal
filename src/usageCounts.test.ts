import { describe, it, expect, vi } from "vitest";
import { resolveUsageCounts, type UsageCache } from "./usageCounts";

const terms = [
  { id: 1, english_term: "army" },
  { id: 2, english_term: "war" },
];

describe("resolveUsageCounts", () => {
  it("counts each term and reports the results", async () => {
    const cache: UsageCache = new Map();
    const countFn = vi.fn(async (t: string) => (t === "army" ? 5 : 9));
    let last: Record<number, number> = {};
    await resolveUsageCounts("eu5", terms, cache, countFn, () => false, (c) => (last = c));
    expect(last).toEqual({ 1: 5, 2: 9 });
  });

  it("does not count a term again once it has been counted (e.g. after Save reloads the page)", async () => {
    const cache: UsageCache = new Map();
    const countFn = vi.fn(async () => 3);
    await resolveUsageCounts("eu5", terms, cache, countFn, () => false, () => {});
    await resolveUsageCounts("eu5", terms, cache, countFn, () => false, () => {});
    expect(countFn).toHaveBeenCalledTimes(2); // 2 terms, counted once each
  });

  it("shows remembered counts immediately and only counts the new terms", async () => {
    const cache: UsageCache = new Map();
    const countFn = vi.fn(async () => 4);
    await resolveUsageCounts("eu5", [terms[0]], cache, countFn, () => false, () => {});
    const seen: Record<number, number>[] = [];
    await resolveUsageCounts("eu5", terms, cache, countFn, () => false, (c) => seen.push(c));
    expect(seen[0]).toEqual({ 1: 4 }); // first update already has the remembered one
    expect(countFn).toHaveBeenCalledTimes(2); // army once, war once
  });

  it("keeps counts for different games separate", async () => {
    const cache: UsageCache = new Map();
    const countFn = vi.fn(async (_t: string) => 1);
    await resolveUsageCounts("eu5", terms, cache, countFn, () => false, () => {});
    await resolveUsageCounts("ck3", terms, cache, countFn, () => false, () => {});
    expect(countFn).toHaveBeenCalledTimes(4);
  });

  it("a replaced (stale) run never overwrites the screen, even if it finishes last", async () => {
    const cache: UsageCache = new Map();
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((r) => (releaseSlow = r));
    let shown: Record<number, number> = {};
    let current = 1;

    // Run 1 (old page) is slow; run 2 (new page) finishes first.
    const run1 = resolveUsageCounts(
      "eu5",
      [{ id: 1, english_term: "old" }],
      cache,
      async () => {
        await slowGate;
        return 111;
      },
      () => current !== 1,
      (c) => (shown = c)
    );
    current = 2;
    await resolveUsageCounts("eu5", [{ id: 2, english_term: "new" }], cache, async () => 222, () => current !== 2, (c) => (shown = c));
    releaseSlow();
    await run1;

    expect(shown).toEqual({ 2: 222 });
    // ...but the old answer is still remembered for later.
    expect(cache.get("eu5\u0000old")).toBe(111);
  });

  it("one term failing to count doesn't stop the others", async () => {
    const cache: UsageCache = new Map();
    let last: Record<number, number> = {};
    await resolveUsageCounts(
      "eu5",
      terms,
      cache,
      async (t) => {
        if (t === "army") throw new Error("boom");
        return 7;
      },
      () => false,
      (c) => (last = c)
    );
    expect(last).toEqual({ 2: 7 });
  });
});