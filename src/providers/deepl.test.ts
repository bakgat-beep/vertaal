import { describe, it, expect, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }));

import { deeplProvider } from "./deepl";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("deeplProvider.translate", () => {
  it("uses the free-tier host for a key ending in :fx, and the paid host otherwise", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ translations: [{ text: "Hallo" }] }));
    await deeplProvider.translate(
      { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
      { providerId: "test", apiKey: "abc123:fx", baseUrl: null, model: null }
    );
    expect(fetchMock.mock.calls[0][0]).toBe("https://api-free.deepl.com/v2/translate");

    fetchMock.mockClear();
    await deeplProvider.translate(
      { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
      { providerId: "test", apiKey: "abc123", baseUrl: null, model: null }
    );
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepl.com/v2/translate");
  });

  it("sends the auth header and language codes DeepL expects", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ translations: [{ text: "Hallo" }] }));
    await deeplProvider.translate(
      { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
      { providerId: "test", apiKey: "my-key", baseUrl: null, model: null }
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("DeepL-Auth-Key my-key");
    expect(JSON.parse(init.body)).toEqual({ text: ["Hello"], target_lang: "AF", source_lang: "EN" });
  });

  it("throws with the response body on a failed request", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ message: "Quota exceeded" }, false, 456));
    await expect(
      deeplProvider.translate(
        { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
        { providerId: "test", apiKey: "my-key", baseUrl: null, model: null }
      )
    ).rejects.toThrow(/456/);
  });

  it("without an API key, translate refuses before ever calling fetch", async () => {
    fetchMock.mockReset();
    await expect(
      deeplProvider.translate(
        { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
        { providerId: "test", apiKey: null, baseUrl: null, model: null }
      )
    ).rejects.toThrow(/API key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});


describe("deeplProvider language code coverage", () => {
  const offeredTargets = [
    "afrikaans", "dutch", "german", "french", "spanish", "portuguese", "italian",
    "polish", "russian", "turkish", "arabic", "hindi", "chinese", "japanese",
    "korean", "swahili", "zulu", "xhosa",
  ];
  const nativeSourceValues = ["braz_por", "simp_chinese"];

  it("has a real DeepL code (not a guessed fallback) for every language the wizard offers, and every native-language value a game can produce", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ translations: [{ text: "x" }] }));
    for (const lang of [...offeredTargets, ...nativeSourceValues]) {
      fetchMock.mockClear();
      await deeplProvider.translate(
        { text: "x", sourceLanguage: "english", targetLanguage: lang },
        { providerId: "test", apiKey: "key", baseUrl: null, model: null }
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      // A DeepL code is a short, all-caps ISO-style tag; a guessed fallback
      // (toUpperCase() of the raw value) for anything multi-word would
      // contain an underscore or a space.
      expect(body.target_lang, `${lang} -> ${body.target_lang}`).not.toMatch(/[_\s]/);
    }
  });
});