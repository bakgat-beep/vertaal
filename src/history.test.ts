import { describe, it, expect, vi } from "vitest";

const calls: { sql: string; params: unknown[] }[] = [];
vi.mock("./db", () => ({
  getDb: async () => ({
    select: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return [];
    },
  }),
}));

import { loadHistory } from "./history";

describe("loadHistory", () => {
  it("orders newest first, and breaks ties within the same second by the later row", async () => {
    await loadHistory("k", "eu5", "afrikaans");
    expect(calls[0].sql).toContain("ORDER BY changed_at DESC, id DESC");
    expect(calls[0].params).toEqual(["k", "eu5", "afrikaans"]);
  });
});
