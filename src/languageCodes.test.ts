import { describe, it, expect } from "vitest";
import { languageDisplayName } from "./languageCodes";

describe("languageDisplayName", () => {
  it("capitalises an ordinary language value as-is", () => {
    expect(languageDisplayName("english")).toBe("English");
    expect(languageDisplayName("afrikaans")).toBe("Afrikaans");
    expect(languageDisplayName("turkish")).toBe("Turkish");
  });

  it("spells out Paradox's internal codes for languages it abbreviates", () => {
    // These are real values a game's own nativeLanguages can produce (see
    // games/eu5.ts, games/ck3.ts, etc.) — sent as-is to request.sourceLanguage,
    // so an AI prompt built from them needs a readable name, not "braz_por".
    expect(languageDisplayName("braz_por")).toBe("Brazilian Portuguese");
    expect(languageDisplayName("simp_chinese")).toBe("Simplified Chinese");
  });

  it("is case-insensitive", () => {
    expect(languageDisplayName("BRAZ_POR")).toBe("Brazilian Portuguese");
  });

  it("handles a multi-word value with no override sensibly", () => {
    expect(languageDisplayName("chinese_traditional")).toBe("Chinese Traditional");
  });
});