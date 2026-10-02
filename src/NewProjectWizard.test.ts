import { describe, it, expect } from "vitest";
import { describeDuplicateProject } from "./NewProjectWizard";

describe("describeDuplicateProject", () => {
  it("a vanilla project that already exists: straightforward re-open message", () => {
    const msg = describeDuplicateProject(
      { source_mod_name: null, hidden_from_recent: 0 },
      false,
      "",
      "afrikaans",
      "Europa Universalis V"
    );
    expect(msg).toContain("Europa Universalis V");
    expect(msg).toContain("already exists");
    expect(msg).not.toContain("hidden");
  });

  it("the SAME mod recreated under the same name: straightforward re-open message, names match", () => {
    const msg = describeDuplicateProject(
      { source_mod_name: "Grim Dawn's Legacy", hidden_from_recent: 0 },
      true,
      "Grim Dawn's Legacy",
      "afrikaans",
      "Stellaris"
    );
    expect(msg).toContain("Grim Dawn's Legacy");
    expect(msg).toContain("already exists");
    // Should NOT use the collision wording — the names genuinely match.
    expect(msg).not.toContain("produce the same internal identifier");
  });

  it("matching is case/whitespace-insensitive (not a false collision warning for trivial differences)", () => {
    const msg = describeDuplicateProject(
      { source_mod_name: "  Grim Dawn's Legacy  ", hidden_from_recent: 0 },
      true,
      "grim dawn's legacy",
      "afrikaans",
      "Stellaris"
    );
    expect(msg).not.toContain("produce the same internal identifier");
  });

  it("TWO DIFFERENTLY NAMED mods that slug to the same identifier: the collision warning, naming both", () => {
    const msg = describeDuplicateProject(
      { source_mod_name: "My: Mod?", hidden_from_recent: 0 },
      true,
      "My? Mod:",
      "afrikaans",
      "Stellaris"
    );
    expect(msg).toContain('"My? Mod:"');
    expect(msg).toContain('"My: Mod?"');
    expect(msg).toContain("produce the same internal identifier");
    expect(msg).toContain("rename one of the mods");
  });

  it("mentions when the existing project was hidden from the project list", () => {
    const msg = describeDuplicateProject(
      { source_mod_name: null, hidden_from_recent: 1 },
      false,
      "",
      "afrikaans",
      "Europa Universalis V"
    );
    expect(msg).toContain("hidden from the project list");
  });

  it("mentions the hidden note on a mod-collision message too", () => {
    const msg = describeDuplicateProject(
      { source_mod_name: "Other Mod", hidden_from_recent: 1 },
      true,
      "My Mod",
      "afrikaans",
      "Stellaris"
    );
    expect(msg).toContain("hidden from the project list");
    expect(msg).toContain("produce the same internal identifier");
  });
});