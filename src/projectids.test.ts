import { describe, it, expect } from "vitest";
import { buildProjectGameId } from "./projectIds";

describe("buildProjectGameId", () => {
  it("keeps the plain id for the game's default source language (existing projects are unchanged)", () => {
    expect(buildProjectGameId({ gameId: "eu5", sourceLanguage: "english", defaultSourceLanguage: "english" })).toBe("eu5");
  });
  it("keeps the mod id for a mod read in the default source language", () => {
    expect(
      buildProjectGameId({ gameId: "eu5", modSlug: "my-mod", sourceLanguage: "english", defaultSourceLanguage: "english" })
    ).toBe("eu5:mod:my-mod");
  });
  it("gives another source language its own id, so its strings never mix with the English ones", () => {
    expect(buildProjectGameId({ gameId: "eu5", sourceLanguage: "french", defaultSourceLanguage: "english" })).toBe("eu5:src:french");
    expect(
      buildProjectGameId({ gameId: "eu5", modSlug: "my-mod", sourceLanguage: "french", defaultSourceLanguage: "english" })
    ).toBe("eu5:mod:my-mod:src:french");
  });
  it("two different source languages never share an id", () => {
    const a = buildProjectGameId({ gameId: "ck3", sourceLanguage: "french", defaultSourceLanguage: "english" });
    const b = buildProjectGameId({ gameId: "ck3", sourceLanguage: "german", defaultSourceLanguage: "english" });
    expect(a).not.toBe(b);
  });
  it("ignores capitals and stray spaces in the language", () => {
    expect(buildProjectGameId({ gameId: "eu5", sourceLanguage: " English ", defaultSourceLanguage: "english" })).toBe("eu5");
  });
});