import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({ join: async (...p: string[]) => p.join("/"), documentDir: async () => "/docs" }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readDir: async () => [], readTextFile: async () => "", exists: async () => false }));

import { escapeDescriptorString, buildCompanionDescriptor } from "./modExport";
import { GAME_ADAPTERS } from "./games";

const NASTY = 'My "Best"\nMod \\ v2';

describe("escapeDescriptorString", () => {
  it("escapes quotes and backslashes and flattens line breaks", () => {
    expect(escapeDescriptorString(NASTY)).toBe('My \\"Best\\" Mod \\\\ v2');
  });
  it("leaves an ordinary name unchanged", () => {
    expect(escapeDescriptorString("Afrikaans for EU5")).toBe("Afrikaans for EU5");
  });
});

describe("every game's descriptor files stay valid for an awkward mod name", () => {
  for (const [id, gm] of Object.entries(GAME_ADAPTERS)) {
    it(`${id}: descriptor.mod has exactly one name line and no raw quote inside it`, () => {
      const text = gm.buildDescriptor(NASTY);
      const nameLines = text.split("\n").filter((l) => l.startsWith("name="));
      expect(nameLines).toEqual(['name="My \\"Best\\" Mod \\\\ v2"']);
    });
    if (gm.buildOuterModPointer) {
      it(`${id}: the outer .mod pointer has exactly one name line too`, () => {
        const text = gm.buildOuterModPointer!(NASTY, "C:\\mods\\x").content;
        const nameLines = text.split("\n").filter((l) => l.startsWith("name="));
        expect(nameLines).toEqual(['name="My \\"Best\\" Mod \\\\ v2"']);
      });
    }
  }
  it("the companion descriptor escapes both names", () => {
    const text = buildCompanionDescriptor(NASTY, 'Source "Mod"');
    expect(text).toContain('name="My \\"Best\\" Mod \\\\ v2"');
    expect(text).toContain('"Source \\"Mod\\""');
  });
});