import { describe, it, expect, vi, beforeEach } from "vitest";

// Stage 1 of the code-review fixes: merging a collaborator's file must never
// (a) replace your own confirmed or typed translation with their AI draft, or
// (b) let a confirmed string through whose game codes ($VARIABLES$, [functions],
// icons ...) don't match the source text.
//
// Uses a small in-memory stand-in for the database (like mergeImport.multi.test.ts),
// extended to answer for the status column and to apply the "flagged" value the
// merge now passes in.

const SOURCE = "You gain $GOLD$ and [GetName]";

type Row = {
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

const strings = [
  { key: "plain", game_id: "eu5", source_text: "Hello" },
  { key: "coded", game_id: "eu5", source_text: SOURCE },
];
let translations: Row[] = [];
let history: { string_key: string; new_text: string }[] = [];

const fakeDb = {
  select: async (q: string, p: any[] = []) => {
    if (q.includes("FROM strings WHERE key")) return strings.filter((s) => s.key === p[0] && s.game_id === p[1]);
    if (q.includes("FROM translations WHERE string_key")) {
      return translations.filter((t) => t.string_key === p[0] && t.game_id === p[1] && t.target_language === p[2]);
    }
    return [];
  },
  execute: async (q: string, p: any[] = []) => {
    if (q.includes("INSERT OR REPLACE INTO translations")) {
      const [key, gameId, lang, text, status, by, updatedAt, baseline, flaggedNow] = p;
      const i = translations.findIndex((t) => t.string_key === key && t.game_id === gameId && t.target_language === lang);
      const row: Row = {
        string_key: key,
        game_id: gameId,
        target_language: lang,
        translated_text: text,
        status,
        translated_by: by,
        updated_at: updatedAt,
        source_text_at_translation: baseline,
        // The real statement keeps an existing flag and adds a new one on top.
        flagged: Math.max(i >= 0 ? translations[i].flagged : 0, Number(flaggedNow ?? 0)),
      };
      if (i >= 0) translations[i] = row;
      else translations.push(row);
    } else if (q.includes("INSERT INTO translation_history")) {
      history.push({ string_key: p[0], new_text: p[4] });
    }
  },
};
vi.mock("./db", () => ({ getDb: async () => fakeDb }));

let fileContent = "";
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: async () => fileContent, readDir: async () => [] }));
vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("/") }));

import { importPortableProjectData } from "./mergeImport";

const project = { game_id: "eu5", target_language: "afrikaans" } as any;

function incoming(key: string, text: string, status: string, updatedAt = "2026-10-05T10:00:00.000Z") {
  const src = strings.find((s) => s.key === key)!.source_text;
  fileContent = JSON.stringify({
    format_version: 2,
    game_id: "eu5",
    target_language: "afrikaans",
    exported_at: "x",
    translations: [
      { key, source_text: src, translated_text: text, status, translated_by: "Collaborator", updated_at: updatedAt },
    ],
    glossary: [],
  });
}

function local(key: string, text: string, status: string, flagged = 0): Row {
  const row: Row = {
    string_key: key,
    game_id: "eu5",
    target_language: "afrikaans",
    translated_text: text,
    status,
    translated_by: "Me",
    updated_at: "2026-10-01 10:00:00", // older than the incoming file's 5 October
    source_text_at_translation: null,
    flagged,
  };
  translations.push(row);
  return row;
}

const rowFor = (key: string) => translations.find((t) => t.string_key === key)!;

beforeEach(() => {
  translations = [];
  history = [];
});

describe("an incoming AI draft never replaces your own work", () => {
  it("keeps your CONFIRMED translation even though the incoming AI draft is newer", async () => {
    local("plain", "My careful translation", "human-confirmed");
    incoming("plain", "Machine draft", "ai-suggested");
    const summary = await importPortableProjectData(project, "f.json");
    expect(rowFor("plain").translated_text).toBe("My careful translation");
    expect(rowFor("plain").status).toBe("human-confirmed");
    expect(summary.applied).toBe(0);
    expect(summary.skippedKeptYourWork).toBe(1);
    expect(history).toHaveLength(0); // nothing changed, so nothing is logged as changed
  });

  it("keeps a draft you typed yourself", async () => {
    local("plain", "My own draft", "human-draft");
    incoming("plain", "Machine draft", "ai-suggested");
    const summary = await importPortableProjectData(project, "f.json");
    expect(rowFor("plain").translated_text).toBe("My own draft");
    expect(rowFor("plain").status).toBe("human-draft");
    expect(summary.skippedKeptYourWork).toBe(1);
  });

  it("still lets a newer AI draft replace an older AI draft", async () => {
    local("plain", "Old machine draft", "ai-suggested");
    incoming("plain", "New machine draft", "ai-suggested");
    const summary = await importPortableProjectData(project, "f.json");
    expect(rowFor("plain").translated_text).toBe("New machine draft");
    expect(summary.applied).toBe(1);
    expect(summary.skippedKeptYourWork).toBe(0);
  });

  it("still accepts an AI draft for a string you have no translation for", async () => {
    incoming("plain", "Machine draft", "ai-suggested");
    const summary = await importPortableProjectData(project, "f.json");
    expect(rowFor("plain").status).toBe("ai-suggested");
    expect(summary.applied).toBe(1);
  });

  it("still lets a collaborator's newer HUMAN edit replace yours (a person made that change)", async () => {
    local("plain", "My wording", "human-confirmed");
    incoming("plain", "Their wording", "human-confirmed");
    const summary = await importPortableProjectData(project, "f.json");
    expect(rowFor("plain").translated_text).toBe("Their wording");
    expect(summary.applied).toBe(1);
  });
});

describe("a confirmed string whose game codes don't match is held back", () => {
  it("saves it as a FLAGGED DRAFT, never as confirmed, so it cannot be exported", async () => {
    incoming("coded", "Jy kry goud", "human-confirmed"); // $GOLD$ and [GetName] both missing
    const summary = await importPortableProjectData(project, "f.json");
    const row = rowFor("coded");
    expect(row.translated_text).toBe("Jy kry goud"); // their work is kept, not thrown away
    expect(row.status).toBe("human-draft");
    expect(row.flagged).toBe(1);
    expect(summary.applied).toBe(1);
    expect(summary.flaggedForGameCodes).toBe(1);
  });

  it("leaves a confirmed string alone when every game code is present", async () => {
    incoming("coded", "Jy kry $GOLD$ en [GetName]", "human-confirmed");
    const summary = await importPortableProjectData(project, "f.json");
    expect(rowFor("coded").status).toBe("human-confirmed");
    expect(rowFor("coded").flagged).toBe(0);
    expect(summary.flaggedForGameCodes).toBe(0);
  });

  it("also catches a game code that appears the wrong number of times", async () => {
    incoming("coded", "Jy kry $GOLD$ $GOLD$ en [GetName]", "human-confirmed");
    await importPortableProjectData(project, "f.json");
    expect(rowFor("coded").status).toBe("human-draft");
    expect(rowFor("coded").flagged).toBe(1);
  });

  it("keeps a flag you had already set, when the incoming string is fine", async () => {
    local("coded", "Ou vertaling", "human-confirmed", 1);
    incoming("coded", "Jy kry $GOLD$ en [GetName]", "human-confirmed");
    await importPortableProjectData(project, "f.json");
    expect(rowFor("coded").flagged).toBe(1);
  });

  it("does not touch strings without game codes", async () => {
    incoming("plain", "Hallo", "human-confirmed");
    const summary = await importPortableProjectData(project, "f.json");
    expect(rowFor("plain").status).toBe("human-confirmed");
    expect(summary.flaggedForGameCodes).toBe(0);
  });
});