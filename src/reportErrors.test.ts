import { describe, it, expect } from "vitest";
import { describeError, reportErrors } from "./reportErrors";

// Stage 7: a button that fails must say so in the status bar instead of
// silently doing nothing (an uncaught error in a click handler only shows up
// in a developer console that nobody is looking at).

describe("describeError", () => {
  it("uses the message of a normal error, without the 'Error:' prefix", () => {
    expect(describeError(new Error("disk is full"))).toBe("disk is full");
  });
  it("copes with plain text and other things that get thrown", () => {
    expect(describeError("access denied")).toBe("access denied");
    expect(describeError({ toString: () => "odd thing" })).toBe("odd thing");
    expect(describeError(undefined)).toBe("unknown error");
  });
});

describe("reportErrors", () => {
  it("says nothing extra when the action works", async () => {
    const seen: string[] = [];
    let ran = false;
    await reportErrors((m) => seen.push(m), "Import", async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(seen).toEqual([]);
  });

  it("turns a failure into a status message and does not throw", async () => {
    const seen: string[] = [];
    await expect(
      reportErrors((m) => seen.push(m), "Revert", async () => {
        throw new Error("database is locked");
      })
    ).resolves.toBeUndefined();
    expect(seen).toEqual(["Revert failed: database is locked"]);
  });

  it("also catches a failure that happens after an earlier await", async () => {
    const seen: string[] = [];
    await reportErrors((m) => seen.push(m), "Verify", async () => {
      await Promise.resolve();
      throw "access denied";
    });
    expect(seen).toEqual(["Verify failed: access denied"]);
  });
});