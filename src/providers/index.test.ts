import { describe, it, expect } from "vitest";
import { TRANSLATION_PROVIDERS, NO_AI_PROVIDER_ID, getProjectProvider, providerOptionLabel } from "./index";

describe("getProjectProvider", () => {
  it("treats a project with no stored provider as TranslateGemma (older projects)", () => {
    expect(getProjectProvider({ translation_provider_id: null })?.id).toBe("ollama");
  });

  it("returns null for manual-only projects", () => {
    expect(getProjectProvider({ translation_provider_id: NO_AI_PROVIDER_ID })).toBeNull();
    expect(NO_AI_PROVIDER_ID).toBe("none");
  });

  it("returns the chosen provider, and null for an unknown id", () => {
    expect(getProjectProvider({ translation_provider_id: "deepl" })?.id).toBe("deepl");
    expect(getProjectProvider({ translation_provider_id: "no-such-provider" })).toBeNull();
  });

  it("'none' is not one of the real providers", () => {
    expect(TRANSLATION_PROVIDERS[NO_AI_PROVIDER_ID]).toBeUndefined();
  });
});

describe("providerOptionLabel", () => {
  it("never contradicts itself (e.g. 'self-hosted' followed by 'cloud')", () => {
    for (const p of Object.values(TRANSLATION_PROVIDERS)) {
      const label = providerOptionLabel(p);
      expect(label.startsWith(p.displayName)).toBe(true);
      expect(label.match(/\(/g)?.length).toBe(1);
    }
  });

  it("adds where it runs only when the name doesn't already say", () => {
    expect(providerOptionLabel(TRANSLATION_PROVIDERS["deepl"])).toBe("DeepL (online)");
    expect(providerOptionLabel(TRANSLATION_PROVIDERS["libretranslate"])).toBe(
      TRANSLATION_PROVIDERS["libretranslate"].displayName
    );
  });
});