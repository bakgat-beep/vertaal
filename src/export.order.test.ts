import { describe, it, expect, vi, beforeEach } from "vitest";

// Export used to delete the previous export's leftover files BEFORE writing the
// new ones, so a write that failed part-way left the mod with the old files
// already gone. Now the leftovers are removed only after the new files are
// written.

let ops: string[] = [];
let failWrites = false;
const OLD_MANIFEST = JSON.stringify(["localization\\old_file.yml", "localization\\a.yml"]);

const fakeDb = {
  select: async (q: string) => {
    if (q.includes("SELECT s.key as key"))
      return [{ key: "good", file_path: "a.yml", source_text: "Hello", translated_text: "Hallo", outdated: 0 }];
    return [];
  },
  execute: async () => ({ rowsAffected: 1 }),
};
vi.mock("./db", () => ({ getDb: async () => fakeDb }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => "/dest" }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async () => true,
  mkdir: async () => {},
  readTextFile: async (path: string) => {
    if (path.includes("vertaal-export-manifest.json")) return OLD_MANIFEST;
    throw new Error("not found");
  },
  remove: async (path: string) => {
    ops.push(`remove ${path.split("\\").pop()}`);
  },
  writeTextFile: async (path: string) => {
    if (path.includes("vertaal-export-manifest.json")) ops.push("write manifest");
  },
  writeFile: async (path: string) => {
    if (failWrites) throw new Error("disk full");
    ops.push(`write ${path.split("\\").pop()}`);
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

import { exportMod, exportModCompanion } from "./export";
import type { Project } from "./types";

const project = {
  id: 1,
  game_id: "eu5",
  parent_game_id: "eu5",
  target_language: "afrikaans",
  source_language: "english",
  mod_name: "My Mod",
  output_path: "/dest",
  source_mod_name: "Other Mod",
} as unknown as Project;

beforeEach(() => {
  ops = [];
  failWrites = false;
});

describe.each([
  ["a base game project", exportMod, "game"],
  ["a mod (companion) project", exportModCompanion, "mod"],
])("exporting %s", (_name, run, type) => {
  const proj = { ...project, project_type: type } as Project;

  it("writes the new files first, then removes the leftover one, then records the new list", async () => {
    const outcome = await run(proj, () => {});
    expect(outcome.status).toBe("ok");
    const wroteLoc = ops.indexOf("write a.yml");
    const removed = ops.indexOf("remove old_file.yml");
    const manifest = ops.indexOf("write manifest");
    expect(wroteLoc).toBeGreaterThanOrEqual(0);
    expect(removed).toBeGreaterThan(wroteLoc);
    expect(manifest).toBeGreaterThan(removed);
    expect(ops).not.toContain("remove a.yml"); // a file written again is never removed
  });

  it("if writing fails, nothing from the previous export is deleted and the old list is kept", async () => {
    failWrites = true;
    const outcome = await run(proj, () => {});
    expect(outcome.status).toBe("error");
    expect(ops.filter((o) => o.startsWith("remove"))).toEqual([]);
    expect(ops).not.toContain("write manifest");
  });
});