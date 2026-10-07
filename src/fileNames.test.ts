import { describe, it, expect } from "vitest";
import { safeFileName, modFolderName, portableExportFileName, matchesProjectExportFile, contributorSlug } from "./fileNames";

describe("safeFileName", () => {
  it("leaves an ordinary name unchanged", () => {
    expect(safeFileName("eu5")).toBe("eu5");
  });

  it("replaces Windows-forbidden characters with an underscore", () => {
    expect(safeFileName('a<b>c:d"e/f\\g|h?i*j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  it("strips a trailing dot or space", () => {
    expect(safeFileName("My Mod. ")).toBe("My Mod");
  });

  it("falls back to a default name if nothing is left", () => {
    expect(safeFileName("...")).toBe("export"); // only dots, all stripped as trailing dots
  });
});

describe("modFolderName", () => {
  it("lower-cases and hyphenates spaces, as before", () => {
    expect(modFolderName("My Cool Mod")).toBe("my-cool-mod");
  });

  it("also strips characters Windows can't have in a folder name", () => {
    // A real case this fixes: a colon or question mark in a mod's display
    // name used to be written straight into the export folder name.
    expect(modFolderName("Grim: Dawn's Legacy?")).toBe("grim_-dawn's-legacy_");
  });

  it("never produces an empty folder name", () => {
    expect(modFolderName("...")).toBe("export");
  });
});

describe("portableExportFileName", () => {
  it("keeps the existing name for a normal project (so old export files still match)", () => {
    expect(portableExportFileName({ game_id: "eu5", target_language: "afrikaans" })).toBe(
      "eu5-afrikaans-vertaal-export.json"
    );
  });

  it("produces a valid name for a mod project", () => {
    const name = portableExportFileName({ game_id: "eu5:mod:my-mod", target_language: "afrikaans" });
    expect(name).toBe("eu5_mod_my-mod-afrikaans-vertaal-export.json");
    expect(name).not.toContain(":");
  });
});


describe("portableExportFileName with a contributor", () => {
  it("appends a slug of the contributor's name (a name that needs tidying gets a short fingerprint)", () => {
    expect(portableExportFileName({ game_id: "eu5", target_language: "afrikaans" }, "Michi van Wyk")).toMatch(
      /^eu5-afrikaans-michi-van-wyk-[0-9a-f]{6}-vertaal-export\.json$/
    );
  });

  it("leaves an already-tidy name exactly as before", () => {
    expect(portableExportFileName({ game_id: "eu5", target_language: "afrikaans" }, "michi")).toBe(
      "eu5-afrikaans-michi-vertaal-export.json"
    );
  });

  it("falls back to the plain shared name when no contributor is given, or it's blank", () => {
    expect(portableExportFileName({ game_id: "eu5", target_language: "afrikaans" })).toBe(
      "eu5-afrikaans-vertaal-export.json"
    );
    expect(portableExportFileName({ game_id: "eu5", target_language: "afrikaans" }, "   ")).toBe(
      "eu5-afrikaans-vertaal-export.json"
    );
  });

  it("two different contributors on the same project get two different file names", () => {
    const alice = portableExportFileName({ game_id: "eu5", target_language: "afrikaans" }, "Alice");
    const bob = portableExportFileName({ game_id: "eu5", target_language: "afrikaans" }, "Bob");
    expect(alice).not.toBe(bob);
  });
});

describe("matchesProjectExportFile", () => {
  const project = { game_id: "eu5", target_language: "afrikaans" };

  it("matches any contributor's file for this project", () => {
    expect(matchesProjectExportFile("eu5-afrikaans-alice-vertaal-export.json", project)).toBe(true);
    expect(matchesProjectExportFile("eu5-afrikaans-bob-vertaal-export.json", project)).toBe(true);
  });

  it("matches the old, pre-Stage-6 shared file name too (so upgrading loses nothing)", () => {
    expect(matchesProjectExportFile("eu5-afrikaans-vertaal-export.json", project)).toBe(true);
  });

  it("does not match a different project, or an unrelated file", () => {
    expect(matchesProjectExportFile("eu5-french-alice-vertaal-export.json", project)).toBe(false);
    expect(matchesProjectExportFile("ck3-afrikaans-alice-vertaal-export.json", project)).toBe(false);
    expect(matchesProjectExportFile("README.md", project)).toBe(false);
    expect(matchesProjectExportFile(".git", project)).toBe(false);
  });
});
describe("contributorSlug - different names never share a file", () => {
  it("keeps an already-tidy name exactly as it was (so existing files keep their names)", () => {
    expect(contributorSlug("michi")).toBe("michi");
    expect(contributorSlug("jane-doe")).toBe("jane-doe");
  });
  it("gives 'Jane Doe', 'Jane-Doe', 'jane  doe' and 'JANE DOE' four different files", () => {
    const slugs = ["Jane Doe", "Jane-Doe", "jane  doe", "JANE DOE"].map(contributorSlug);
    expect(new Set(slugs).size).toBe(4);
  });
  it("gives the same name the same file every time, ignoring spaces at the ends", () => {
    expect(contributorSlug("Jane Doe")).toBe(contributorSlug("  Jane Doe "));
  });
  it("never produces characters Windows rejects in a file name", () => {
    expect(contributorSlug('A:B/C?"D"')).toMatch(/^[^<>:"/\\|?*]+$/);
  });
  it("the file name still ends with the expected pattern and is found by the folder scan", () => {
    const project = { game_id: "eu5", target_language: "afrikaans" };
    const f = portableExportFileName(project, "Jane Doe");
    expect(f).toMatch(/^eu5-afrikaans-jane-doe-[0-9a-f]{6}-vertaal-export\.json$/);
    expect(matchesProjectExportFile(f, project)).toBe(true);
  });
});