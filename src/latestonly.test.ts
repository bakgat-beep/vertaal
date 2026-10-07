import { describe, it, expect } from "vitest";
import { makeLatestGuard } from "./latestOnly";

describe("makeLatestGuard", () => {
  it("only the most recent run counts as current", () => {
    const g = makeLatestGuard();
    const first = g.next();
    const second = g.next();
    expect(g.isCurrent(first)).toBe(false);
    expect(g.isCurrent(second)).toBe(true);
  });
  it("calling next() to cancel (e.g. the person picked a folder by hand) makes an in-flight run out of date", () => {
    const g = makeLatestGuard();
    const detect = g.next();
    g.next();
    expect(g.isCurrent(detect)).toBe(false);
  });
});