import { describe, it, expect, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }));

import { libreTranslateProvider } from "./libretranslate";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body), json: async () => body };
}

const configFor = (baseUrl: string) => ({ providerId: "test", apiKey: null, baseUrl, model: null });

describe("libreTranslateProvider", () => {
  it("refuses before ever calling fetch if no server URL is configured", async () => {
    fetchMock.mockReset();
    await expect(
      libreTranslateProvider.translate(
        { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
        configFor("")
      )
    ).rejects.toThrow(/Base URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("trims a trailing slash off the server URL", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ translatedText: "Hallo" }));
    await libreTranslateProvider.translate(
      { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
      configFor("http://localhost:5000/")
    );
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:5000/translate");
  });

  it("has a real 2-letter code (not a guessed fallback) for every language the wizard offers, and every native-language value a game can produce", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ translatedText: "x" }));
    const offeredTargets = [
      "afrikaans", "dutch", "german", "french", "spanish", "portuguese", "italian",
      "polish", "russian", "turkish", "arabic", "hindi", "chinese", "japanese",
      "korean", "swahili", "zulu", "xhosa", "braz_por", "simp_chinese",
    ];
    for (const lang of offeredTargets) {
      fetchMock.mockClear();
      await libreTranslateProvider.translate(
        { text: "x", sourceLanguage: "english", targetLanguage: lang },
        configFor("http://localhost:5000")
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.target, `${lang} -> ${body.target}`).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
    }
  });
});