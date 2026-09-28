import { it, expect, vi } from "vitest";

// A small in-memory stand-in for the database, built from plain arrays —
// just enough to service the exact queries importPortableProjectData and
// importAllContributorFiles issue (see mergeImport.ts), without needing a
// real SQL engine.
const strings: { key: string; game_id: string; source_text: string }[] = [
  { key: "greeting", game_id: "eu5", source_text: "Hello" },
  { key: "farewell", game_id: "eu5", source_text: "Goodbye" },
  { key: "welcome", game_id: "eu5", source_text: "Welcome" },
];
type TranslationRow = {
  string_key: string;
  game_id: string;
  target_language: string;
  translated_text: string;
  status: string;
  translated_by: string | null;
  updated_at: string | null;
  source_text_at_translation: string | null;
  flagged: number;
};
const translations: TranslationRow[] = [];
const history: { string_key: string; new_text: string }[] = [];

const fakeDb = {
  select: async (q: string, p: any[] = []) => {
    if (q.includes("FROM strings WHERE key")) {
      return strings.filter((s) => s.key === p[0] && s.game_id === p[1]);
    }
    if (q.includes("FROM translations WHERE string_key")) {
      return translations.filter((t) => t.string_key === p[0] && t.game_id === p[1] && t.target_language === p[2]);
    }
    return [];
  },
  execute: async (q: string, p: any[] = []) => {
    if (q.includes("INSERT OR REPLACE INTO translations")) {
      const [key, gameId, lang, text, status, by, updatedAt, baseline] = p;
      const i = translations.findIndex((t) => t.string_key === key && t.game_id === gameId && t.target_language === lang);
      const row: TranslationRow = {
        string_key: key,
        game_id: gameId,
        target_language: lang,
        translated_text: text,
        status,
        translated_by: by,
        updated_at: updatedAt,
        source_text_at_translation: baseline,
        flagged: i >= 0 ? translations[i].flagged : 0,
      };
      if (i >= 0) translations[i] = row;
      else translations.push(row);
    } else if (q.includes("INSERT INTO translation_history")) {
      history.push({ string_key: p[0], new_text: p[4] });
    }
  },
};
vi.mock("./db", () => ({ getDb: async () => fakeDb }));

const files = new Map<string, string>();
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: async (p: string) => {
    if (!files.has(p)) throw new Error("no such file");
    return files.get(p)!;
  },
  readDir: async (dir: string) =>
    [...files.keys()].filter((k) => k.startsWith(`${dir}/`)).map((k) => ({ name: k.slice(dir.length + 1) })),
}));
vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("/") }));

import { importAllContributorFiles } from "./mergeImport";

const project = { game_id: "eu5", target_language: "afrikaans" } as any;

function exportFile(rows: Partial<TranslationRow>[]) {
  return JSON.stringify({
    format_version: 2,
    game_id: "eu5",
    target_language: "afrikaans",
    exported_at: "x",
    translations: rows.map((r) => ({
      key: r.string_key,
      source_text: strings.find((s) => s.key === r.string_key)!.source_text,
      translated_text: r.translated_text,
      status: r.status ?? "human-confirmed",
      translated_by: r.translated_by ?? null,
      updated_at: r.updated_at ?? null,
    })),
    glossary: [],
  });
}

files.set(
  "/repo/eu5-afrikaans-alice-vertaal-export.json",
  exportFile([{ string_key: "greeting", translated_text: "Hallo", translated_by: "Alice", updated_at: "2026-01-01T10:00:00.000Z" }])
);
files.set(
  "/repo/eu5-afrikaans-bob-vertaal-export.json",
  exportFile([{ string_key: "farewell", translated_text: "Totsiens", translated_by: "Bob", updated_at: "2026-01-01T11:00:00.000Z" }])
);
files.set(
  "/repo/eu5-afrikaans-vertaal-export.json", // legacy pre-Stage-6 shared file — must still be picked up
  exportFile([{ string_key: "welcome", translated_text: "Welkom", translated_by: "Legacy", updated_at: "2026-01-01T09:00:00.000Z" }])
);
files.set("/repo/README.md", "not a Vertaal file");
files.set(
  "/repo/eu5-french-alice-vertaal-export.json", // different language — must be ignored
  exportFile([{ string_key: "greeting", translated_text: "Bonjour", translated_by: "Alice", updated_at: "2026-01-01T12:00:00.000Z" }])
);

it("merges every contributor's file (and the legacy shared one), ignores unrelated files, and reports which files it processed", async () => {
  const result = await importAllContributorFiles(project, "/repo");
  expect(result.filesProcessed.sort()).toEqual([
    "eu5-afrikaans-alice-vertaal-export.json",
    "eu5-afrikaans-bob-vertaal-export.json",
    "eu5-afrikaans-vertaal-export.json",
  ]);
  expect(result.applied).toBe(3);

  const byKey = Object.fromEntries(translations.map((t) => [t.string_key, t.translated_text]));
  expect(byKey).toEqual({
    farewell: "Totsiens",
    greeting: "Hallo", // NOT "Bonjour" — the french file was correctly ignored
    welcome: "Welkom",
  });
  expect(history).toHaveLength(3);
});

it("re-running is safe: everything is now local-newer, so nothing is re-applied", async () => {
  const result = await importAllContributorFiles(project, "/repo");
  expect(result.applied).toBe(0);
  expect(result.skippedLocalNewer).toBe(3);
});


it("a local edit made late in the day (SQLite timestamp format) is not overwritten by an earlier-in-the-day change from a merged file (ISO format)", async () => {
  // The real-world bug this guards against: comparing these two formats as
  // plain text treats the SQLite one as OLDER, because " " sorts before "T",
  // even though 23:59:59 is later than 00:00:01 — silently letting an older
  // incoming translation overwrite a newer local one.
  strings.push({ key: "late_edit", game_id: "eu5", source_text: "Late" });
  translations.push({
    string_key: "late_edit",
    game_id: "eu5",
    target_language: "afrikaans",
    translated_text: "My newer local wording",
    status: "human-confirmed",
    translated_by: "Me",
    updated_at: "2026-02-01 23:59:59", // local: SQLite format, late in the day
    source_text_at_translation: "Late",
    flagged: 0,
  });
  files.set(
    "/repo/eu5-afrikaans-carol-vertaal-export.json",
    exportFile([{ string_key: "late_edit", translated_text: "Older incoming wording", translated_by: "Carol", updated_at: "2026-02-01T00:00:01.000Z" }])
  );

  const result = await importAllContributorFiles(project, "/repo");
  const row = translations.find((t) => t.string_key === "late_edit")!;
  expect(row.translated_text).toBe("My newer local wording"); // NOT overwritten
  expect(result.skippedLocalNewer).toBeGreaterThanOrEqual(1);
});