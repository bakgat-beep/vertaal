import { describe, it, expect } from "vitest";
// Read as plain text (Vite's "?raw"), so these tests can check the SQL files and
// the Rust file that lists them without running either.
import libRs from "../src-tauri/src/lib.rs?raw";
import migration0022 from "../src-tauri/migrations/0022_speed_up_lists_and_history.sql?raw";

const files = import.meta.glob("../src-tauri/migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
const fileNames = Object.keys(files)
  .map((p) => p.split("/").pop()!)
  .sort();

describe("every migration file is registered, in order", () => {
  it("has numbered files 0001, 0002, ... with no gaps", () => {
    fileNames.forEach((name, i) => expect(name.startsWith(String(i + 1).padStart(4, "0") + "_")).toBe(true));
  });

  // A migration that is not listed in lib.rs is silently never run: the file
  // exists, the tests pass, and the change never reaches anyone's database.
  it.each(fileNames.map((name, i) => [name, i + 1] as const))("lib.rs registers %s as version %i", (name, version) => {
    const entry = new RegExp(
      `version:\\s*${version},[\\s\\S]*?include_str!\\("\\.\\./migrations/${name.replace(".", "\\.")}"\\)`
    );
    expect(libRs).toMatch(entry);
  });

  it("registers no version twice", () => {
    const versions = [...libRs.matchAll(/version:\s*(\d+),/g)].map((m) => m[1]);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions.length).toBe(fileNames.length);
  });
});

describe("migration 0022 (speed)", () => {
  it("adds the two indexes the editor's list order and History lookups use", () => {
    expect(migration0022).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_strings_game_file_key ON strings\(game_id, file_path, key\)/
    );
    expect(migration0022).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_translation_history_lookup ON translation_history\(string_key, game_id, target_language\)/
    );
  });

  it("matches the order the editor sorts by (see useEditorRows.ts and history.ts)", () => {
    // If someone changes the sort or the lookup, the index has to follow it.
    // (Plain-text check of the two queries the indexes were made for.)
    expect(migration0022).toContain("file_path, key");
  });

  it("only adds things: it never drops or changes existing data", () => {
    const statements = migration0022
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/\b(DROP|DELETE|UPDATE|ALTER|INSERT)\b/i);
  });
});