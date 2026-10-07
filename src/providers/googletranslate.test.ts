import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Deliberately different from every other provider's test: this one mocks
// the global fetch (vi.stubGlobal), not "@tauri-apps/plugin-http" — because
// googletranslate.ts deliberately uses the page's own fetch, not the
// plugin. See the comment at the top of googletranslate.ts for why.
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

import { googleTranslateProvider } from "./googletranslate";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: "", json: async () => body, text: async () => JSON.stringify(body) };
}

const config = { providerId: "test", apiKey: null, baseUrl: null, model: null };

describe("googleTranslateProvider", () => {
  it("uses the page's own fetch (not Tauri's HTTP plugin)", async () => {
    fetchMock.mockResolvedValue(jsonResponse([[["Hallo", "Hello", null, null, 1]]]));
    await googleTranslateProvider.translate(
      { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
      config
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("translate.googleapis.com");
    // No custom headers are needed or sent — the browser supplies its own.
    expect(fetchMock.mock.calls[0][1]?.headers).toBeUndefined();
  });

  it("parses a real-shaped response into plain translated text", async () => {
    // Google splits longer text into several segments; a real response looks like this.
    fetchMock.mockResolvedValue(
      jsonResponse([[["Hallo ", "Hello ", null, null, 1], ["wêreld", "world", null, null, 1]]])
    );
    const result = await googleTranslateProvider.translate(
      { text: "Hello world", sourceLanguage: "english", targetLanguage: "afrikaans" },
      config
    );
    expect(result.translatedText).toBe("Hallo wêreld");
  });

  it("throws a clear error on a 429 rather than a confusing parse failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 429));
    await expect(
      googleTranslateProvider.translate({ text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" }, config)
    ).rejects.toThrow(/429/);
  });

  it("has a code for every language the New Project wizard offers as a target", () => {
    // Mirrors NewProjectWizard.tsx's TARGET_LANGUAGE_OPTIONS list, so a
    // language offered there never silently falls through to a guessed,
    // likely-wrong code.
    const offeredTargets = [
      "afrikaans", "dutch", "german", "french", "spanish", "portuguese", "italian",
      "polish", "russian", "turkish", "arabic", "hindi", "chinese", "japanese",
      "korean", "swahili", "zulu", "xhosa",
    ];
    const guessLooksLikeALanguageName = (raw: string) => /[a-z]{3,}/.test(raw); // a real code is short (2-7 chars, no long English word)
    for (const lang of offeredTargets) {
      fetchMock.mockClear();
      fetchMock.mockResolvedValue(jsonResponse([[["x", "y", null, null, 1]]]));
      void googleTranslateProvider.translate({ text: "x", sourceLanguage: "english", targetLanguage: lang }, config);
      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      const tl = new URL(calledUrl).searchParams.get("tl")!;
      expect(guessLooksLikeALanguageName(tl), `${lang} -> tl=${tl} looks like an unmapped fallback`).toBe(false);
    }
  });

  it("also has codes for the two Paradox-internal source values (braz_por, simp_chinese) a game's own native-language list can produce", async () => {
    fetchMock.mockResolvedValue(jsonResponse([[["x", "y", null, null, 1]]]));
    await googleTranslateProvider.translate({ text: "x", sourceLanguage: "braz_por", targetLanguage: "afrikaans" }, config);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("sl")).toBe("pt");

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(jsonResponse([[["x", "y", null, null, 1]]]));
    await googleTranslateProvider.translate({ text: "x", sourceLanguage: "simp_chinese", targetLanguage: "afrikaans" }, config);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("sl")).toBe("zh-CN");
  });
});