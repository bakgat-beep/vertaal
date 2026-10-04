import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: { sql: string; params: unknown[] }[] = [];
vi.mock("./db", () => ({
  getDb: async () => ({
    select: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      // The usage-count query expects rows of text; everything else expects a count.
      if (sql.includes("SELECT source_text FROM strings")) return [];
      return [{ count: 0 }];
    },
  }),
}));

import { listGlossaryTerms, countGlossaryTerms, countGlossaryTermUsage } from "./glossary";

beforeEach(() => {
  calls.length = 0;
});

describe("Glossary search", () => {
  it("takes a typed % or _ literally, in both the list and the count", async () => {
    await listGlossaryTerms("eu5", "afrikaans", { search: "100%_", limit: 50, offset: 0 });
    await countGlossaryTerms("eu5", "afrikaans", "100%_");
    for (const c of calls) {
      expect(c.sql).toContain("english_term LIKE $3 ESCAPE '\\'");
      expect(c.params.slice(2, 5)).toEqual(["%100\\%\\_%", "%100\\%\\_%", "%100\\%\\_%"]);
    }
  });

  it("numbers LIMIT and OFFSET after the search parameters", async () => {
    await listGlossaryTerms("eu5", "afrikaans", { search: "war", limit: 50, offset: 100 });
    expect(calls[0].sql).toContain("LIMIT $6 OFFSET $7");
    expect(calls[0].params).toEqual(["afrikaans", "eu5", "%war%", "%war%", "%war%", 50, 100]);
  });

  it("without a search there are no extra parameters", async () => {
    await listGlossaryTerms("eu5", "afrikaans", { limit: 50, offset: 0 });
    expect(calls[0].sql).toContain("LIMIT $3 OFFSET $4");
    expect(calls[0].params).toEqual(["afrikaans", "eu5", 50, 0]);
  });

  it("a non-ASCII term ignores capitals via GLOB", async () => {
    await countGlossaryTerms("eu5", "afrikaans", "östergötland");
    expect(calls[0].sql).toContain("english_term GLOB $3");
    expect(calls[0].sql).not.toContain("ESCAPE");
  });
});

describe("Glossary usage count narrowing", () => {
  it("plain terms use the same LIKE search as before", async () => {
    await countGlossaryTermUsage("eu5", "army");
    expect(calls[0].sql).toContain("source_text LIKE $2 ESCAPE '\\'");
    expect(calls[0].params).toEqual(["eu5", "%army%"]);
  });

  it("a non-ASCII term no longer misses text that differs only in capitals", async () => {
    await countGlossaryTermUsage("eu5", "östergötland");
    expect(calls[0].sql).toContain("source_text GLOB $2");
  });
});
