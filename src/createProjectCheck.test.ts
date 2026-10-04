import { describe, it, expect } from "vitest";
import { createProjectBlocker, type CreateProjectInputs } from "./createProjectCheck";

const ready: CreateProjectInputs = {
  selectedGameId: "eu5",
  effectiveTargetLanguage: "afrikaans",
  installPathValid: true,
  checkingPath: false,
  projectType: "vanilla",
  sourceModName: "",
};

describe("createProjectBlocker", () => {
  it("returns null when a vanilla project has everything it needs", () => {
    expect(createProjectBlocker(ready)).toBeNull();
  });

  it("asks for a game first", () => {
    expect(createProjectBlocker({ ...ready, selectedGameId: null, installPathValid: null })).toMatch(/Choose a game/);
  });

  it("asks for a custom language name when it's blank", () => {
    expect(createProjectBlocker({ ...ready, effectiveTargetLanguage: "" })).toMatch(/language/);
  });

  it("says to wait while the folder is being checked (even if an older folder had passed)", () => {
    expect(createProjectBlocker({ ...ready, checkingPath: true })).toMatch(/Still checking/);
  });

  it("asks for the folder when none has been chosen, wording it for vanilla vs mod", () => {
    expect(createProjectBlocker({ ...ready, installPathValid: null })).toMatch(/install folder/);
    expect(createProjectBlocker({ ...ready, installPathValid: null, projectType: "mod" })).toMatch(/mod you're translating/);
  });

  it("explains a folder with no localisation files", () => {
    expect(createProjectBlocker({ ...ready, installPathValid: false })).toMatch(/no localisation files/);
  });

  it("a mod project also needs the mod's name, and spaces alone don't count", () => {
    expect(createProjectBlocker({ ...ready, projectType: "mod", sourceModName: "   " })).toMatch(/name of the mod/);
    expect(createProjectBlocker({ ...ready, projectType: "mod", sourceModName: "Grim" })).toBeNull();
  });

  it("reports only the first problem, in form order", () => {
    const r = createProjectBlocker({ ...ready, selectedGameId: null, effectiveTargetLanguage: "", installPathValid: false });
    expect(r).toMatch(/Choose a game/);
  });
});