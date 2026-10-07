import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({ join: async (...p: string[]) => p.join("/"), documentDir: async () => "/docs" }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readDir: async () => [], readTextFile: async () => "", exists: async () => false }));

import { GAME_ADAPTERS } from "../games";

// A project can read its text from any of the game's languages, not just
// English. Converting a French source file to a German export must give
// exactly the same result as converting the English one - same folders, same
// file name - and must not leave any trace of "french" behind.
const FOLDERS = ["localization", "localisation"];

function pathFor(folder: string, language: string, nested: boolean) {
  return `C:\\S\\X\\game\\${folder}\\${language}\\${nested ? "ui\\" : ""}foo_l_${language}.yml`;
}

describe("path conversion works for any source language", () => {
  for (const [id, gm] of Object.entries(GAME_ADAPTERS)) {
    for (const folder of FOLDERS) {
      for (const nested of [true, false]) {
        const english = pathFor(folder, "english", nested);
        const french = pathFor(folder, "french", nested);

        it(`${id} (${folder}${nested ? ", subfolder" : ""}): toModRelativePath gives the same result for a French source as an English one`, () => {
          const fromEnglish = gm.toModRelativePath(english, "german", "english");
          const fromFrench = gm.toModRelativePath(french, "german", "french");
          expect(fromFrench).toEqual(fromEnglish);
          if (fromFrench) expect(fromFrench.toLowerCase()).not.toContain("french");
        });

        it(`${id} (${folder}${nested ? ", subfolder" : ""}): toModExportRelativePath gives the same result for a French source as an English one`, () => {
          if (!gm.toModExportRelativePath) return;
          const fromEnglish = gm.toModExportRelativePath(english, "german", "english");
          const fromFrench = gm.toModExportRelativePath(french, "german", "french");
          expect(fromFrench).toEqual(fromEnglish);
          if (fromFrench) expect(fromFrench.toLowerCase()).not.toContain("french");
        });
      }
    }

    it(`${id}: the category read from a file name does not depend on the source language`, () => {
      expect(gm.extractCategory(pathFor("localization", "french", false))).toEqual(
        gm.extractCategory(pathFor("localization", "english", false))
      );
    });
  }

  it("a call that does not name a source language still assumes English, as before", () => {
    const gm = GAME_ADAPTERS["eu5"];
    expect(gm.toModRelativePath(pathFor("localization", "english", true), "german")).toBe(
      gm.toModRelativePath(pathFor("localization", "english", true), "german", "english")
    );
  });
});