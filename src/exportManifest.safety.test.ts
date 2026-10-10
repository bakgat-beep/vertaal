import { describe, it, expect, vi, beforeEach } from "vitest";

// Stage 3 of the code-review fixes: the export manifest is a plain text file
// inside the mod folder. If someone edited it (or a downloaded mod folder came
// with a booby-trapped one), the next export would delete every file it listed,
// including files OUTSIDE the mod folder. Entries must be plain paths that stay
// inside the mod folder; everything else is ignored, never deleted.

const removed: string[] = [];
let manifestText = "";
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: async () => manifestText,
  writeTextFile: async () => {},
  mkdir: async () => {},
  remove: async (p: string) => {
    removed.push(p);
  },
}));
// Like Tauri's join: glues the parts together AND resolves ".." segments, which
// is exactly what makes "../x" escape the folder.
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => {
    const out: string[] = [];
    for (const seg of parts.join("/").split("/")) {
      if (seg === "..") out.pop();
      else if (seg !== "." && seg !== "") out.push(seg);
    }
    return "/" + out.join("/");
  },
}));

import { isSafeRelativePath, readExportManifest, removeStaleFiles } from "./exportManifest";

const GOOD = [
  "localization/english/eu5_l_english.yml",
  "main_menu/localization/afrikaans/x_l_afrikaans.yml",
  "file.yml",
  "localisation\\replace\\events_l_afrikaans.yml", // the form real manifests use on Windows
  "dir/sub.dir/file name with spaces.yml",
];
const BAD = [
  "../outside.txt",
  "localization/../../outside.txt",
  "..\\outside.txt",
  "localization\\..\\..\\outside.txt",
  "/etc/passwd",
  "\\Windows\\System32\\x.dll",
  "C:\\Users\\me\\Documents\\thesis.docx",
  "c:/Users/me/x",
  "C:relative-to-drive-c.txt",
  "\\\\server\\share\\x.txt",
  "//server/share/x.txt",
  "",
  "   ",
  "..",
  "a/../b",
  "bad\0name.yml",
];

describe("isSafeRelativePath", () => {
  it.each(GOOD)("accepts %s", (p) => expect(isSafeRelativePath(p)).toBe(true));
  it.each(BAD)("refuses %j", (p) => expect(isSafeRelativePath(p)).toBe(false));
});

describe("readExportManifest", () => {
  it("keeps the safe entries and silently drops the unsafe ones", async () => {
    manifestText = JSON.stringify([...GOOD, ...BAD]);
    expect(await readExportManifest("/mods/mymod")).toEqual(GOOD);
  });
});

describe("removeStaleFiles", () => {
  beforeEach(() => {
    removed.length = 0;
  });

  it("never deletes anything for an unsafe entry, even if one is handed to it directly", async () => {
    await removeStaleFiles("/mods/mymod", BAD);
    expect(removed).toEqual([]);
  });

  it("still deletes safe stale files, inside the mod folder", async () => {
    await removeStaleFiles("/mods/mymod", [GOOD[0], "../outside.txt", GOOD[1]]);
    expect(removed).toEqual([`/mods/mymod/${GOOD[0]}`, `/mods/mymod/${GOOD[1]}`]);
  });
});