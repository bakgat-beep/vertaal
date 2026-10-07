import { describe, it, expect, vi, beforeEach } from "vitest";

// An in-memory stand-in for the database: one translations table as a plain
// array, handling just the queries translateAndSave issues.
type Row = { string_key: string; game_id: string; target_language: string; translated_text: string; status: string };
let rows: Row[] = [];
let history: { new_text: string }[] = [];

const fakeDb = {
  select: async (q: string, p: any[] = []) => {
    if (q.includes("FROM translations WHERE string_key")) {
      return rows.filter((r) => r.string_key === p[0] && r.game_id === p[1] && r.target_language === p[2]);
    }
    return [];
  },
  execute: async (q: string, p: any[] = []) => {
    if (q.includes("INSERT OR REPLACE INTO translations")) {
      const [key, gameId, lang, text] = p;
      const i = rows.findIndex((r) => r.string_key === key && r.game_id === gameId && r.target_language === lang);
      const row = { string_key: key, game_id: gameId, target_language: lang, translated_text: text, status: "ai-suggested" };
      if (i >= 0) rows[i] = row;
      else rows.push(row);
    } else if (q.includes("INSERT INTO translation_history")) {
      history.push({ new_text: p[4] });
    }
  },
};
vi.mock("./db", () => ({ getDb: async () => fakeDb }));
vi.mock("./glossary", () => ({
  loadGlossaryTerms: async () => [],
  matchGlossaryTerms: () => [],
  buildGlossaryInstructions: () => [],
}));
vi.mock("./games", () => ({ GAME_ADAPTERS: {} }));
vi.mock("./providers/credentials.ts", () => ({ getProviderCredentials: async () => ({}) }));
vi.mock("./providers", () => ({
  getProjectProvider: () => ({
    id: "deepl",
    displayName: "DeepL",
    requiresModel: false,
    supportsGlossary: false,
    translate: async () => ({ translatedText: "AI-teks" }),
  }),
}));

import { translateAndSave, translateWithRetry } from "./translate";
import type { Project } from "./types";

const project = {
  game_id: "eu5",
  parent_game_id: "eu5",
  target_language: "afrikaans",
  source_language: "english",
  translation_provider_id: "deepl",
  ai_model: null,
} as unknown as Project;

function seed(status: string, text: string) {
  rows = [{ string_key: "K", game_id: "eu5", target_language: "afrikaans", translated_text: text, status }];
}

beforeEach(() => {
  rows = [];
  history = [];
});

describe("batch runs must not replace human work", () => {
  it("leaves a confirmed translation alone when skipHumanWork is on", async () => {
    seed("human-confirmed", "Mens-teks");
    const r = await translateAndSave(project, "K", "eu5", "Hello", undefined, false, true);
    expect(r).toEqual({ ok: true, skipped: true });
    expect(rows[0].translated_text).toBe("Mens-teks");
    expect(rows[0].status).toBe("human-confirmed");
    expect(history).toHaveLength(0);
  });

  it("leaves a hand-typed draft alone when skipHumanWork is on", async () => {
    seed("human-draft", "My eie konsep");
    const r = await translateAndSave(project, "K", "eu5", "Hello", undefined, false, true);
    expect(r.skipped).toBe(true);
    expect(rows[0].translated_text).toBe("My eie konsep");
  });

  it("still replaces an older AI draft in a batch", async () => {
    seed("ai-suggested", "ou AI");
    const r = await translateAndSave(project, "K", "eu5", "Hello", undefined, false, true);
    expect(r.ok).toBe(true);
    expect(r.skipped).toBeUndefined();
    expect(rows[0].translated_text).toBe("AI-teks");
  });

  it("still translates a brand new string in a batch", async () => {
    const r = await translateAndSave(project, "K", "eu5", "Hello", undefined, false, true);
    expect(r.ok).toBe(true);
    expect(rows[0].translated_text).toBe("AI-teks");
  });

  it("the single-row AI button (skipHumanWork off) still redoes a confirmed row on purpose", async () => {
    seed("human-confirmed", "Mens-teks");
    const r = await translateAndSave(project, "K", "eu5", "Hello");
    expect(r.ok).toBe(true);
    expect(rows[0].translated_text).toBe("AI-teks");
  });

  it("translateWithRetry passes the protection through and reports the skip", async () => {
    seed("human-confirmed", "Mens-teks");
    const r = await translateWithRetry(project, "K", "eu5", "Hello", () => false, undefined, 3, 0, false, true);
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
    expect(r.attempts).toBe(1);
    expect(rows[0].translated_text).toBe("Mens-teks");
  });
});