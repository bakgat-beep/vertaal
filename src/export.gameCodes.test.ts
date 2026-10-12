import { describe, it, expect, vi, beforeEach } from "vitest";

// Stage 6: Export must never write a confirmed string whose game codes
// ($VARIABLES$, [functions], icons ...) don't match its source text, and the
// "Ready to export?" numbers must agree with what Export really does.

type ExportableRow = { key: string; file_path: string; source_text: string; translated_text: string; outdated: number };
let exportable: ExportableRow[] = [];
let aggregate = { total: 10, flagged: 0, drafts: 0 };
let written: Record<string, string> = {};

const fakeDb = {
  select: async (q: string) => {
    if (q.includes("AS total")) return [aggregate];
    if (q.includes("SELECT s.key as key")) return exportable.map((r) => ({ ...r }));
    return [];
  },
  execute: async () => ({ rowsAffected: 1 }),
};
vi.mock("./db", () => ({ getDb: async () => fakeDb }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => "/dest" }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async () => true,
  mkdir: async () => {},
  readTextFile: async () => {
    throw new Error("no manifest yet");
  },
  remove: async () => {},
  writeTextFile: async () => {},
  writeFile: async (path: string, bytes: Uint8Array) => {
    written[path] = new TextDecoder().decode(bytes);
  },
}));
vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("\\") }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: async () => {} }));
vi.mock("./games", () => {
  const adapter = {
    displayName: "EU5",
    nativeLanguages: { afrikaans: "afrikaans" },
    toModRelativePath: (fp: string) => `localization\\${fp}`,
    toModExportRelativePath: (fp: string) => `localization\\${fp}`,
    buildMetadata: () => ({}),
    buildDescriptor: () => "",
    detectModPath: async () => "/x",
  };
  return { GAME_ADAPTERS: { eu5: adapter } };
});

import { exportMod, exportModCompanion, getExportPreflight } from "./export";
import type { Project } from "./types";

const project = {
  id: 1,
  game_id: "eu5",
  parent_game_id: "eu5",
  target_language: "afrikaans",
  source_language: "english",
  mod_name: "My Mod",
  project_type: "game",
  output_path: "/dest",
  source_mod_name: "Other Mod",
} as unknown as Project;

const GOOD = { key: "good", file_path: "a.yml", source_text: "You gain $GOLD$", translated_text: "Jy kry $GOLD$", outdated: 0 };
const GOOD_OUTDATED = { key: "goodold", file_path: "a.yml", source_text: "Hello", translated_text: "Hallo", outdated: 1 };
const BROKEN = { key: "broken", file_path: "a.yml", source_text: "You gain $GOLD$ and [GetName]", translated_text: "Jy kry goud", outdated: 0 };
const BROKEN_OUTDATED = { key: "brokenold", file_path: "b.yml", source_text: "Click $BTN$", translated_text: "Klik", outdated: 1 };

const allWritten = () => Object.values(written).join("\n");

beforeEach(() => {
  exportable = [];
  aggregate = { total: 10, flagged: 0, drafts: 0 };
  written = {};
});

describe("Ready to export? numbers", () => {
  it("count only what will really be written, and say how many were held back for game codes", async () => {
    exportable = [GOOD, GOOD_OUTDATED, BROKEN, BROKEN_OUTDATED];
    aggregate = { total: 10, flagged: 1, drafts: 2 };
    const p = await getExportPreflight(project);
    expect(p.confirmed).toBe(2);
    expect(p.outdated).toBe(1); // the held-back outdated one is not counted as exported
    expect(p.heldBackForGameCodes).toBe(2);
    expect(p.heldBackKeys).toEqual(["broken", "brokenold"]);
    expect(p.total).toBe(10);
    expect(p.flagged).toBe(1);
    expect(p.drafts).toBe(2);
  });

  it("show only a short sample of the held-back keys", async () => {
    exportable = Array.from({ length: 25 }, (_v, i) => ({ ...BROKEN, key: `k${i}` }));
    const p = await getExportPreflight(project);
    expect(p.heldBackForGameCodes).toBe(25);
    expect(p.heldBackKeys).toHaveLength(10);
  });
});

describe.each([
  ["a base game project", exportMod, "game"],
  ["a mod (companion) project", exportModCompanion, "mod"],
])("exporting %s", (_name, run, type) => {
  const proj = { ...project, project_type: type } as Project;

  it("never writes a string whose game codes don't match, and reports it", async () => {
    exportable = [GOOD, BROKEN, GOOD_OUTDATED];
    const outcome = await run(proj, () => {});
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    const text = allWritten();
    expect(text).toContain("Jy kry $GOLD$");
    expect(text).toContain("Hallo");
    expect(text).not.toContain("Jy kry goud");
    expect(outcome.stringsWritten).toBe(2);
    expect(outcome.heldBackForGameCodes).toBe(1);
    expect(outcome.heldBackKeys).toEqual(["broken"]);
    expect(outcome.unmapped).toBe(0);
  });

  it("with nothing but broken strings, writes nothing and says why", async () => {
    exportable = [BROKEN, BROKEN_OUTDATED];
    const outcome = await run(proj, () => {});
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.error).toMatch(/game codes/i);
    expect(outcome.error).toMatch(/2/);
    expect(allWritten()).toBe("");
  });

  it("with no problems, reports zero held back", async () => {
    exportable = [GOOD];
    const outcome = await run(proj, () => {});
    expect(outcome.status === "ok" && outcome.heldBackForGameCodes).toBe(0);
  });
});