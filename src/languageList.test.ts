import { describe, it, expect, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }));
vi.mock("@tauri-apps/api/path", () => ({ join: async (...p: string[]) => p.join("/"), documentDir: async () => "/docs" }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readDir: async () => [], readTextFile: async () => "", exists: async () => false }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: async () => ({}) } }));

import { TARGET_LANGUAGE_OPTIONS } from "./NewProjectWizard";
import { GAME_ADAPTERS } from "./games";
import { deeplProvider } from "./providers/deepl";
import { libreTranslateProvider } from "./providers/libretranslate";

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}
const cfg = { providerId: "t", apiKey: "k", baseUrl: "http://x", model: null };

describe("the target language list matches the games' own language names", () => {
  it("offers Simplified Chinese and Brazilian Portuguese under the exact names the games use", () => {
    const values = TARGET_LANGUAGE_OPTIONS.map((o) => o.value);
    expect(values).toContain("simplified chinese");
    expect(values).toContain("brazilian portuguese");
    for (const [id, gm] of Object.entries(GAME_ADAPTERS)) {
      if (!gm.nativeLanguages["simplified chinese"]) continue;
      expect(gm.nativeLanguages["simplified chinese"], id).toBe("simp_chinese");
    }
    expect(GAME_ADAPTERS["eu5"].nativeLanguages["brazilian portuguese"]).toBe("braz_por");
  });
});

describe("translation services understand every language the list offers", () => {
  it("DeepL gets proper codes for the two game-named languages", async () => {
    for (const [lang, code] of [["simplified chinese", "ZH-HANS"], ["brazilian portuguese", "PT-BR"]]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(ok({ translations: [{ text: "x" }] }));
      await deeplProvider.translate({ text: "Hi", sourceLanguage: "english", targetLanguage: lang }, cfg);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).target_lang).toBe(code);
    }
  });

  it("LibreTranslate gets proper codes for the two game-named languages", async () => {
    for (const [lang, code] of [["simplified chinese", "zh"], ["brazilian portuguese", "pt"]]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(ok({ translatedText: "x" }));
      await libreTranslateProvider.translate({ text: "Hi", sourceLanguage: "english", targetLanguage: lang }, cfg);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).target).toBe(code);
    }
  });

  it("every language code any game uses as a source is recognised by DeepL (not guessed from its folder name)", async () => {
    const codes = new Set<string>();
    for (const gm of Object.values(GAME_ADAPTERS)) for (const c of Object.values(gm.nativeLanguages)) codes.add(c);
    for (const code of codes) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(ok({ translations: [{ text: "x" }] }));
      await deeplProvider.translate({ text: "Hi", sourceLanguage: code, targetLanguage: "afrikaans" }, cfg);
      const sent = JSON.parse(fetchMock.mock.calls[0][1].body).source_lang;
      expect(sent, code).not.toBe(code.toUpperCase());
    }
  });
});