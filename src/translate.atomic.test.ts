import { describe, it, expect, vi, beforeEach } from "vitest";

// Stage 4 of the code-review fixes: saving an AI translation is ONE step in the
// database that refuses to replace a person's work (so a string you confirm
// while a batch is running can never be overwritten, even in the split second
// between "looking" and "saving"), the history is only written when something
// was really saved, and an empty reply from the provider is a failed attempt.
//
// The stand-in database understands both the OLD save statement
// (INSERT OR REPLACE: always replaces) and the NEW one (ON CONFLICT ... DO UPDATE
// ... WHERE: replaces only when allowed, and reports rowsAffected: 0 when it
// didn't), so the same tests can show the old code failing.

type Row = {
  string_key: string;
  game_id: string;
  target_language: string;
  translated_text: string;
  status: string;
  flagged: number;
};
let rows: Row[] = [];
let history: { old_text: string; new_text: string }[] = [];
let flagCalls = 0;
// Runs right AFTER translateAndSave has read the current row, to play the part
// of a person confirming the string at that very moment.
let afterRead: (() => void) | null = null;

const find = (k: string, g: string, l: string) =>
  rows.find((r) => r.string_key === k && r.game_id === g && r.target_language === l);

const fakeDb = {
  select: async (q: string, p: any[] = []) => {
    if (q.includes("FROM translations WHERE string_key")) {
      const copy = rows
        .filter((r) => r.string_key === p[0] && r.game_id === p[1] && r.target_language === p[2])
        .map((r) => ({ ...r }));
      if (afterRead) {
        const f = afterRead;
        afterRead = null;
        f();
      }
      return copy;
    }
    return [];
  },
  execute: async (q: string, p: any[] = []) => {
    if (q.includes("INSERT OR REPLACE INTO translations")) {
      // OLD statement: unconditional.
      const [key, gameId, lang, text] = p;
      const existing = find(key, gameId, lang);
      const flagged = existing?.flagged ?? 0;
      rows = rows.filter((r) => r !== existing);
      rows.push({ string_key: key, game_id: gameId, target_language: lang, translated_text: text, status: "ai-suggested", flagged });
      return { rowsAffected: 1 };
    }
    if (/DO UPDATE SET\s+translated_text/.test(q)) {
      // NEW statement: params are [key, game, language, text, who, sourceText, skipHumanWork (0/1)].
      const [key, gameId, lang, text, , , skipHumanWork] = p;
      const existing = find(key, gameId, lang);
      if (!existing) {
        rows.push({ string_key: key, game_id: gameId, target_language: lang, translated_text: text, status: "ai-suggested", flagged: 0 });
        return { rowsAffected: 1 };
      }
      if (skipHumanWork === 1 && (existing.status === "human-confirmed" || existing.status === "human-draft")) {
        return { rowsAffected: 0 };
      }
      existing.translated_text = text;
      existing.status = "ai-suggested"; // flagged is deliberately left as it was
      return { rowsAffected: 1 };
    }
    if (q.includes("SET flagged = 1")) {
      flagCalls++;
      return { rowsAffected: 1 };
    }
    if (q.includes("INSERT INTO translation_history")) {
      history.push({ old_text: p[3], new_text: p[4] });
      return { rowsAffected: 1 };
    }
    return { rowsAffected: 0 };
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

const reply = vi.hoisted(() => ({ text: "AI-teks" }));
vi.mock("./providers", () => ({
  getProjectProvider: () => ({
    id: "deepl",
    displayName: "DeepL",
    requiresModel: false,
    isLlm: false,
    translate: async () => ({ translatedText: reply.text }),
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
  retry_delay_ms: 0,
} as unknown as Project;

function seed(status: string, text: string, flagged = 0) {
  rows = [{ string_key: "K", game_id: "eu5", target_language: "afrikaans", translated_text: text, status, flagged }];
}

beforeEach(() => {
  rows = [];
  history = [];
  flagCalls = 0;
  afterRead = null;
  reply.text = "AI-teks";
});

describe("the save itself cannot replace a person's work (no gap to slip through)", () => {
  it("a string confirmed while a batch is saving is kept, reported as skipped, and not logged as changed", async () => {
    seed("ai-suggested", "ou AI");
    afterRead = () => {
      rows[0].status = "human-confirmed";
      rows[0].translated_text = "Mens-teks";
    };
    const r = await translateAndSave(project, "K", "eu5", "Hello", undefined, false, true);
    expect(r).toEqual({ ok: true, skipped: true });
    expect(rows[0].translated_text).toBe("Mens-teks");
    expect(rows[0].status).toBe("human-confirmed");
    expect(history).toHaveLength(0);
  });

  it("the same for a draft someone starts typing at that moment", async () => {
    seed("ai-suggested", "ou AI");
    afterRead = () => {
      rows[0].status = "human-draft";
      rows[0].translated_text = "My eie konsep";
    };
    const r = await translateAndSave(project, "K", "eu5", "Hello", undefined, false, true);
    expect(r.skipped).toBe(true);
    expect(rows[0].translated_text).toBe("My eie konsep");
  });
});

describe("history is written only when something was saved", () => {
  it("a normal save logs the true before and after", async () => {
    seed("ai-suggested", "ou AI");
    const r = await translateAndSave(project, "K", "eu5", "Hello", undefined, false, true);
    expect(r.ok).toBe(true);
    expect(history).toEqual([{ old_text: "ou AI", new_text: "AI-teks" }]);
  });

  it("the single-row AI button still replaces a confirmed row on purpose, and History shows what was there", async () => {
    seed("human-confirmed", "Mens-teks");
    const r = await translateAndSave(project, "K", "eu5", "Hello");
    expect(r.ok).toBe(true);
    expect(rows[0].translated_text).toBe("AI-teks");
    expect(history).toEqual([{ old_text: "Mens-teks", new_text: "AI-teks" }]);
  });

  it("a flag already on the string survives an AI save", async () => {
    seed("ai-suggested", "ou AI", 1);
    await translateAndSave(project, "K", "eu5", "Hello", undefined, false, true);
    expect(rows[0].flagged).toBe(1);
  });
});

describe("an empty reply is a failed attempt, never saved", () => {
  it.each([["empty", ""], ["only spaces and line breaks", "  \n "]])("%s: nothing is saved or logged", async (_name, text) => {
    seed("human-confirmed", "Mens-teks");
    reply.text = text;
    const r = await translateAndSave(project, "K", "eu5", "Hello"); // even the deliberate single-row button
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/i);
    expect(rows[0].translated_text).toBe("Mens-teks");
    expect(rows[0].status).toBe("human-confirmed");
    expect(history).toHaveLength(0);
  });

  it("a brand new string gets no blank 'AI draft' row", async () => {
    reply.text = "";
    const r = await translateAndSave(project, "K", "eu5", "Hello", undefined, false, true);
    expect(r.ok).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it("is retried and, if it keeps happening, flagged for a person to look at", async () => {
    reply.text = "";
    const r = await translateWithRetry(project, "K", "eu5", "Hello", () => false, undefined, 3, 0, false, true);
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(3);
    expect(flagCalls).toBe(1);
  });
});