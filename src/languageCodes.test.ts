import { describe, it, expect } from "vitest";
import { languageDisplayName, languageIsoCode } from "./languagecodes";

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
describe("languageIsoCode", () => {
  it("knows the codes for the languages and Paradox folder names Vertaal uses", () => {
    expect(languageIsoCode("afrikaans")).toBe("af");
    expect(languageIsoCode("simp_chinese")).toBe("zh");
    expect(languageIsoCode("braz_por")).toBe("pt");
    expect(languageIsoCode("French")).toBe("fr");
  });
  it("passes a code that was typed in straight through, and says null for an unknown name", () => {
    expect(languageIsoCode("sw")).toBe("sw");
    expect(languageIsoCode("klingon language")).toBeNull();
  });
  it("shows a bare code as the language it stands for", () => {
    expect(languageDisplayName("sw")).toBe("Swahili");
    expect(languageDisplayName("af")).toBe("Afrikaans");
  });
});