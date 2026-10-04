import { describe, it, expect, vi, beforeEach } from "vitest";

// Records the SQL and values the functions send to the database, and lets each
// test decide what a SELECT returns.
const calls: { sql: string; params: unknown[] }[] = [];
const executes: { sql: string; params: unknown[] }[] = [];
let selectResult: unknown[] = [{ count: 0 }];
vi.mock("./db", () => ({
  getDb: async () => ({
    select: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return selectResult;
    },
    execute: async (sql: string, params: unknown[]) => {
      executes.push({ sql, params });
    },
  }),
}));

import {
  splitKeyPatterns,
  escapeLikePattern,
  countNameConfirmMatches,
  countAiDraftMatches,
  listSourceFileOptions,
  confirmNameMatches,
  eligibleStatusSql,
} from "./nameConfirm";

beforeEach(() => {
  calls.length = 0;
  executes.length = 0;
  selectResult = [{ count: 0 }];
});

describe("splitKeyPatterns", () => {
  it("splits on commas, trims, and drops empties", () => {
    expect(splitKeyPatterns("character_name_, location_name_ ,, ")).toEqual(["character_name_", "location_name_"]);
    expect(splitKeyPatterns("")).toEqual([]);
    expect(splitKeyPatterns("  ,  ")).toEqual([]);
  });
});

describe("escapeLikePattern", () => {
  it("makes underscores, percent signs and backslashes literal", () => {
    expect(escapeLikePattern("character_name_")).toBe("character\\_name\\_");
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
    expect(escapeLikePattern("plain")).toBe("plain");
  });
});

describe("countNameConfirmMatches", () => {
  it("sends escaped patterns and declares the escape character", async () => {
    await countNameConfirmMatches("eu5", "afrikaans", ["character_name_"], []);
    expect(calls[0].sql).toContain("s.key LIKE $3 ESCAPE '\\'");
    expect(calls[0].params).toEqual(["eu5", "afrikaans", "%character\\_name\\_%"]);
  });

  it("never matches everything when nothing is selected", async () => {
    expect(await countNameConfirmMatches("eu5", "afrikaans", [], [])).toBe(0);
    expect(calls).toHaveLength(0); // no query is even sent
  });

  it("combines key patterns and files with OR", async () => {
    await countNameConfirmMatches("eu5", "afrikaans", ["a_"], ["C:\\loc\\x.yml"]);
    expect(calls[0].sql).toContain(") OR (s.file_path = $4)");
    expect(calls[0].params).toEqual(["eu5", "afrikaans", "%a\\_%", "C:\\loc\\x.yml"]);
  });
});

describe("which strings are eligible", () => {
  it("by default leaves AI drafts alone", () => {
    expect(eligibleStatusSql("untouched")).not.toContain("ai-suggested");
  });

  it("includes unconfirmed AI drafts only when asked — and never human drafts or confirmed strings", () => {
    const sql = eligibleStatusSql("untouched-and-ai-drafts");
    expect(sql).toContain("ai-suggested");
    expect(sql).not.toContain("human-draft");
    expect(sql).not.toContain("human-confirmed");
  });

  it("the count, the file list and the confirm all follow the same switch", async () => {
    await countNameConfirmMatches("eu5", "afrikaans", ["x"], [], true);
    await listSourceFileOptions("eu5", "afrikaans", true);
    await confirmNameMatches("eu5", "afrikaans", ["x"], [], "Michi", true);
    for (const c of calls) expect(c.sql).toContain("ai-suggested");

    calls.length = 0;
    await countNameConfirmMatches("eu5", "afrikaans", ["x"], []);
    await listSourceFileOptions("eu5", "afrikaans");
    await confirmNameMatches("eu5", "afrikaans", ["x"], [], "Michi");
    for (const c of calls) expect(c.sql).not.toContain("ai-suggested");
  });

  it("countAiDraftMatches looks only at AI drafts, and not at all with an empty selection", async () => {
    await countAiDraftMatches("eu5", "afrikaans", ["x"], []);
    expect(calls[0].sql).toContain("t.status = 'ai-suggested'");
    calls.length = 0;
    expect(await countAiDraftMatches("eu5", "afrikaans", [], [])).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("confirmNameMatches", () => {
  it("writes nothing when nothing is selected", async () => {
    const r = await confirmNameMatches("eu5", "afrikaans", [], [], "Michi", true);
    expect(r).toEqual({ confirmed: 0, aiDraftsReplaced: 0 });
    expect(calls).toHaveLength(0);
    expect(executes).toHaveLength(0);
  });

  it("confirms untouched strings as-is without writing any history", async () => {
    selectResult = [{ key: "k1", source_text: "John", previous_status: null, previous_text: null }];
    const r = await confirmNameMatches("eu5", "afrikaans", ["k"], [], "Michi");
    expect(r).toEqual({ confirmed: 1, aiDraftsReplaced: 0 });
    expect(executes).toHaveLength(1);
    expect(executes[0].params).toEqual(["k1", "eu5", "afrikaans", "John", "Michi", "John"]);
  });

  it("replacing an AI draft records what the AI had written in History", async () => {
    selectResult = [{ key: "k1", source_text: "John", previous_status: "ai-suggested", previous_text: "Johannes" }];
    const r = await confirmNameMatches("eu5", "afrikaans", ["k"], [], "Michi", true);
    expect(r).toEqual({ confirmed: 1, aiDraftsReplaced: 1 });
    const history = executes.find((e) => e.sql.includes("translation_history"));
    expect(history?.params).toEqual(["k1", "eu5", "afrikaans", "Johannes", "John", "Michi"]);
  });

  it("an AI draft that already equals the source is replaced without a pointless History row", async () => {
    selectResult = [{ key: "k1", source_text: "John", previous_status: "ai-suggested", previous_text: "John" }];
    const r = await confirmNameMatches("eu5", "afrikaans", ["k"], [], "Michi", true);
    expect(r.aiDraftsReplaced).toBe(1);
    expect(executes.some((e) => e.sql.includes("translation_history"))).toBe(false);
  });
});