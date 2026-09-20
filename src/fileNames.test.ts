import { describe, it, expect } from "vitest";
import { safeFileName, portableExportFileName } from "./fileNames";

describe("safeFileName", () => {
  it("leaves ordinary names untouched", () => {
    expect(safeFileName("eu5")).toBe("eu5");
    expect(safeFileName("afrikaans")).toBe("afrikaans");
    expect(safeFileName("my-mod_v2.1")).toBe("my-mod_v2.1");
  });

  it("replaces characters Windows forbids in file names", () => {
    expect(safeFileName("eu5:mod:my-mod")).toBe("eu5_mod_my-mod");
    expect(safeFileName('a<b>c"d/e\\f|g?h*i')).toBe("a_b_c_d_e_f_g_h_i");
  });

  it("strips trailing dots and spaces, and never returns an empty name", () => {
    expect(safeFileName("name. ")).toBe("name");
    expect(safeFileName("")).toBe("export");
    expect(safeFileName("...")).toBe("export");
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