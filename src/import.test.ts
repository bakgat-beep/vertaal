import { describe, it, expect, vi, beforeEach } from "vitest";

// A small in-memory file system: paths are backslash-joined, matching how
// the app itself builds them (see join() mock below).
const files = new Map<string, string>();
const dirs = new Map<string, string[]>(); // folder path -> child names (files and subfolders)

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: async (dirPath: string) => {
    const children = dirs.get(dirPath) ?? [];
    return children.map((name) => ({ name, isDirectory: dirs.has(`${dirPath}\\${name}`) }));
  },
  readTextFile: async (p: string) => {
    if (!files.has(p)) throw new Error(`no such file: ${p}`);
    return files.get(p)!;
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => "C:\\install") }));
vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("\\") }));

const strings: any[] = [];
vi.mock("./db", () => ({
  getDb: async () => ({
    select: async (q: string, p: any[] = []) => {
      if (q.includes("SELECT key, source_text, file_path, removed_at FROM strings")) {
        return strings.filter((s) => s.game_id === p[0]);
      }
      return [];
    },
    execute: async (q: string, p: any[] = []) => {
      if (q.includes("INSERT INTO strings")) {
        const [key, gameId, sourceText, hash, filePath, contextLabel, category, subcategory] = p;
        const i = strings.findIndex((s) => s.key === key && s.game_id === gameId);
        const row = {
          key, game_id: gameId, source_text: sourceText, source_text_hash: hash,
          file_path: filePath, context_label: contextLabel, category, subcategory, removed_at: null,
        };
        if (i >= 0) strings[i] = row; else strings.push(row);
      } else if (q.includes("UPDATE strings SET removed_at = datetime('now')")) {
        const s = strings.find((s) => s.key === p[0] && s.game_id === p[1]);
        if (s) s.removed_at = "2026-01-01 00:00:00";
      }
    },
  }),
}));

import { importProjectFolder } from "./import";

const gm = {
  displayName: "Test Game",
  extractCategory: () => "cat",
  extractSubcategory: () => "sub",
} as any;
const project = { id: 1, game_id: "g", target_language: "af", source_language: "english", project_type: "vanilla", install_path: null } as any;

function setupFolder(fileContents: Record<string, string>) {
  files.clear();
  dirs.clear();
  const dirChildren = new Set<string>();
  for (const [name, content] of Object.entries(fileContents)) {
    files.set(`C:\\install\\${name}`, content);
    dirChildren.add(name);
  }
  dirs.set("C:\\install", [...dirChildren]);
}

beforeEach(() => {
  strings.length = 0;
});

describe("importProjectFolder classification", () => {
  it("a first import counts every string as new", async () => {
    setupFolder({ "a_l_english.yml": `l_english:\n greeting:0 "Hello"\n farewell:0 "Bye"\n` });
    const outcome = await importProjectFolder(project, gm, () => {});
    expect(outcome).toMatchObject({ status: "ok", newStrings: 2, changedStrings: 0, unchangedStrings: 0, removedStrings: 0 });
  });

  it("re-importing the same unchanged file counts everything as unchanged", async () => {
    setupFolder({ "a_l_english.yml": `l_english:\n greeting:0 "Hello"\n` });
    await importProjectFolder(project, gm, () => {});
    const outcome = await importProjectFolder(project, gm, () => {});
    expect(outcome).toMatchObject({ newStrings: 0, changedStrings: 0, unchangedStrings: 1 });
  });

  it("a string whose text changed is counted as changed, not new", async () => {
    setupFolder({ "a_l_english.yml": `l_english:\n greeting:0 "Hello"\n` });
    await importProjectFolder(project, gm, () => {});
    setupFolder({ "a_l_english.yml": `l_english:\n greeting:0 "Hello there"\n` });
    const outcome = await importProjectFolder(project, gm, () => {});
    expect(outcome).toMatchObject({ newStrings: 0, changedStrings: 1, unchangedStrings: 0 });
  });

  it("a key missing from a file that WAS rescanned is marked removed", async () => {
    setupFolder({ "a_l_english.yml": `l_english:\n greeting:0 "Hello"\n farewell:0 "Bye"\n` });
    await importProjectFolder(project, gm, () => {});
    setupFolder({ "a_l_english.yml": `l_english:\n greeting:0 "Hello"\n` }); // "farewell" is gone
    const outcome = await importProjectFolder(project, gm, () => {});
    expect(outcome).toMatchObject({ removedStrings: 1 });
    expect(strings.find((s) => s.key === "farewell").removed_at).not.toBeNull();
    expect(strings.find((s) => s.key === "greeting").removed_at).toBeNull();
  });

  it("a previously-removed key that reappears is un-marked and counted as reappeared", async () => {
    setupFolder({ "a_l_english.yml": `l_english:\n greeting:0 "Hello"\n farewell:0 "Bye"\n` });
    await importProjectFolder(project, gm, () => {});
    setupFolder({ "a_l_english.yml": `l_english:\n greeting:0 "Hello"\n` });
    await importProjectFolder(project, gm, () => {}); // "farewell" removed
    setupFolder({ "a_l_english.yml": `l_english:\n greeting:0 "Hello"\n farewell:0 "Bye"\n` }); // back again, unchanged text
    const outcome = await importProjectFolder(project, gm, () => {});
    expect(outcome).toMatchObject({ reappearedStrings: 1, removedStrings: 0 });
    expect(strings.find((s) => s.key === "farewell").removed_at).toBeNull();
  });

  it("a key that simply isn't in the folder chosen THIS time (not the whole game) is left alone, not marked removed", async () => {
    setupFolder({
      "a_l_english.yml": `l_english:\n greeting:0 "Hello"\n`,
      "b_l_english.yml": `l_english:\n farewell:0 "Bye"\n`,
    });
    await importProjectFolder(project, gm, () => {}); // both files present

    // Re-import scans only file "a" this time (as if the user picked a
    // narrower folder, or file "b" simply wasn't part of this scan) — file
    // "b"'s own strings must not be judged at all.
    setupFolder({ "a_l_english.yml": `l_english:\n greeting:0 "Hello"\n` });
    const outcome = await importProjectFolder(project, gm, () => {});
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.removedStrings).toBe(0);
    expect(strings.find((s) => s.key === "farewell").removed_at).toBeNull();
  });
});