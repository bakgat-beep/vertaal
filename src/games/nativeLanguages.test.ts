import { describe, it, expect } from "vitest";
import { GAME_ADAPTERS } from "./index";

// A game's "native languages" are the language slots the game itself ships with.
// When a project's target language is one of them, the export writes that
// language's own files (for example "..._l_german.yml"), which the game loads
// as that language. For any other language the export replaces the source
// language's files instead. So a language wrongly listed here would make the
// export write files the game never loads, and a language wrongly missing would
// replace English when it didn't need to.
//
// The expected lists below are the "supported languages" on each game's Steam
// store page (store.steampowered.com/api/appdetails, checked 2026-10-16), minus
// English (the source language), written as the game's own codes:
//   Spanish - Spain -> spanish, Portuguese - Brazil -> braz_por,
//   Simplified Chinese -> simp_chinese.
// The Paradox wikis agree for every game except Crusader Kings III, whose wiki
// page lists none. If a game adds a language, change its list here AND in the
// game's adapter file (src/games/<game>.ts).
const EXPECTED: Record<string, Record<string, string>> = {
  eu5: {
    "brazilian portuguese": "braz_por", french: "french", german: "german", japanese: "japanese", korean: "korean",
    polish: "polish", russian: "russian", "simplified chinese": "simp_chinese", spanish: "spanish", turkish: "turkish",
  },
  ck3: {
    french: "french", german: "german", japanese: "japanese", korean: "korean", polish: "polish",
    russian: "russian", "simplified chinese": "simp_chinese", spanish: "spanish",
  },
  stellaris: {
    "brazilian portuguese": "braz_por", french: "french", german: "german", japanese: "japanese", korean: "korean",
    polish: "polish", russian: "russian", "simplified chinese": "simp_chinese", spanish: "spanish",
  },
  victoria3: {
    "brazilian portuguese": "braz_por", french: "french", german: "german", japanese: "japanese", korean: "korean",
    polish: "polish", russian: "russian", "simplified chinese": "simp_chinese", spanish: "spanish", turkish: "turkish",
  },
  hoi4: {
    "brazilian portuguese": "braz_por", french: "french", german: "german", japanese: "japanese", korean: "korean",
    polish: "polish", russian: "russian", "simplified chinese": "simp_chinese", spanish: "spanish",
  },
  imperator: {
    french: "french", german: "german", russian: "russian", "simplified chinese": "simp_chinese", spanish: "spanish",
  },
};

describe("each game's native-language list matches the languages the game ships with", () => {
  it("covers every game", () => {
    expect(Object.keys(GAME_ADAPTERS).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.keys(EXPECTED))("%s", (gameId) => {
    expect(GAME_ADAPTERS[gameId].nativeLanguages).toEqual(EXPECTED[gameId]);
  });

  it("never lists the source language itself (it is the one being read, not a slot to replace)", () => {
    for (const adapter of Object.values(GAME_ADAPTERS)) {
      expect(Object.values(adapter.nativeLanguages)).not.toContain(adapter.sourceLanguage);
    }
  });

  it("Crusader Kings III has no Italian or Brazilian Portuguese slot (community translations only)", () => {
    expect(GAME_ADAPTERS.ck3.nativeLanguages["italian"]).toBeUndefined();
    expect(GAME_ADAPTERS.ck3.nativeLanguages["brazilian portuguese"]).toBeUndefined();
  });
});