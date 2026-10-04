import { describe, it, expect, vi } from "vitest";
import { testProviderConnection, explainProviderError } from "./providerTest";
import type { TranslationProvider, ProviderConfig } from "./providers/types";

const config: ProviderConfig = { providerId: "x", model: "m", apiKey: "k", baseUrl: null };

function fakeProvider(
  translate: TranslationProvider["translate"],
  over: Partial<TranslationProvider> = {}
): TranslationProvider {
  return {
    id: "deepl",
    displayName: "DeepL",
    isLocal: false,
    supportsGlossary: false,
    supportsBatch: false,
    requiresModel: false,
    translate,
    ...over,
  };
}

describe("testProviderConnection", () => {
  it("succeeds and shows what came back, using the project's own languages", async () => {
    const translate = vi.fn(async () => ({ translatedText: " Hallo " }));
    const r = await testProviderConnection(fakeProvider(translate), config, "english", "afrikaans");
    expect(r.ok).toBe(true);
    expect(r.message).toContain('"Hallo"');
    expect(translate).toHaveBeenCalledWith({ text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" }, config);
  });

  it("fails with a plain reason and keeps the raw message as detail", async () => {
    const p = fakeProvider(async () => {
      throw new Error("DeepL request failed: 403 Forbidden");
    });
    const r = await testProviderConnection(p, config, "english", "afrikaans");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/rejected the API key/);
    expect(r.detail).toContain("403");
  });

  it("does not even try when a model is required but missing", async () => {
    const translate = vi.fn(async () => ({ translatedText: "x" }));
    const p = fakeProvider(translate, { requiresModel: true, displayName: "TranslateGemma" });
    const r = await testProviderConnection(p, { ...config, model: "  " }, "english", "afrikaans");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/needs a model name/);
    expect(translate).not.toHaveBeenCalled();
  });

  it("gives up with a clear message when the provider never answers", async () => {
    const p = fakeProvider(() => new Promise(() => {}));
    const r = await testProviderConnection(p, config, "english", "afrikaans", { timeoutMs: 20 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/No answer from DeepL/);
  });
});

describe("explainProviderError", () => {
  it("passes through the provider's own 'not configured' wording", () => {
    expect(explainProviderError("deepl", "No DeepL API key configured.")).toBe("No DeepL API key configured.");
  });

  it("explains 401, 403, 404 differently per provider where it matters", () => {
    expect(explainProviderError("openai-compatible", "OpenAI-compatible request failed: 401 {}")).toMatch(/API key/);
    expect(explainProviderError("deepl", "DeepL request failed: 403 x")).toMatch(/:fx/);
    expect(explainProviderError("ollama", "Ollama request failed: 404 Not Found")).toMatch(/model/);
    expect(explainProviderError("openai-compatible", "OpenAI-compatible request failed: 404 x")).toMatch(/Base URL/);
    expect(explainProviderError("libretranslate", "LibreTranslate request failed: 404 x")).toMatch(/server address/);
  });

  it("explains rate limits, DeepL quota and server errors", () => {
    expect(explainProviderError("google-translate", "Google Translate request failed: 429 x")).toMatch(/limiting requests/);
    expect(explainProviderError("deepl", "DeepL request failed: 456 x")).toMatch(/quota/);
    expect(explainProviderError("deepl", "DeepL request failed: 503 x")).toMatch(/their side|its side/);
  });

  it("recognises network failures, with an Ollama-specific hint", () => {
    expect(explainProviderError("ollama", "error sending request for url (http://localhost:11434)")).toMatch(/Ollama app is running/);
    expect(explainProviderError("deepl", "Failed to fetch")).toMatch(/internet connection/);
  });

  it("falls back to a generic message for anything unrecognised", () => {
    expect(explainProviderError("deepl", "something odd")).toMatch(/test failed/);
  });
});