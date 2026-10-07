import { describe, it, expect, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }));
vi.mock("../ollama", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ollama")>()),
  detectInstalledModels: vi.fn(async () => []),
}));

import { ollamaProvider, buildTranslateGemmaPrompt } from "./ollama";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: "", json: async () => body };
}

describe("ollamaProvider.translate", () => {
  it("sends readable language names in the prompt, even for a raw internal code like simp_chinese", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ message: { content: "  译文  " } }));
    await ollamaProvider.translate(
      { text: "Hello", sourceLanguage: "english", targetLanguage: "simp_chinese" },
      { providerId: "test", apiKey: null, baseUrl: null, model: "translategemma-9b" }
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/api/chat");
    const prompt = JSON.parse(init.body).messages[0].content;
    expect(prompt).toContain("English (en) to Simplified Chinese (zh) translator");
    expect(prompt).not.toContain("simp_chinese");
  });

  it("returns the model's text as it came (the caller tidies the edges, keeping the source's own spacing)", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ message: { content: "  Hallo  " } }));
    const result = await ollamaProvider.translate(
      { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
      { providerId: "test", apiKey: null, baseUrl: null, model: "translategemma-9b" }
    );
    expect(result.translatedText).toBe("  Hallo  ");
  });

  it("talks to the Ollama address that was configured, not only this computer", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ message: { content: "Hallo" } }));
    await ollamaProvider.translate(
      { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
      { providerId: "test", apiKey: null, baseUrl: "http://192.168.1.20:11434/", model: "translategemma-9b" }
    );
    expect(fetchMock.mock.calls[0][0]).toBe("http://192.168.1.20:11434/api/chat");
  });

  it("a missing model is a permanent problem (retrying cannot fix it)", async () => {
    await expect(
      ollamaProvider.translate(
        { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
        { providerId: "test", apiKey: null, baseUrl: null, model: null }
      )
    ).rejects.toMatchObject({ kind: "permanent" });
  });

  it("throws a clear error without a model configured", async () => {
    fetchMock.mockReset();
    await expect(
      ollamaProvider.translate(
        { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
        { providerId: "test", apiKey: null, baseUrl: null, model: null }
      )
    ).rejects.toThrow(/model/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("buildTranslateGemmaPrompt", () => {
  it("names each language with its code, and puts two blank lines before the text", () => {
    const prompt = buildTranslateGemmaPrompt({ text: "Hello", sourceLanguage: "french", targetLanguage: "afrikaans" });
    expect(prompt.startsWith("You are a professional French (fr) to Afrikaans (af) translator.")).toBe(true);
    expect(prompt.endsWith("into Afrikaans:\n\n\nHello")).toBe(true);
  });

  it("uses a code typed for a custom language, and leaves the code out when none is known", () => {
    const withCode = buildTranslateGemmaPrompt({ text: "x", sourceLanguage: "english", targetLanguage: "sw" });
    expect(withCode).toContain("English (en) to Swahili (sw) translator");
    const noCode = buildTranslateGemmaPrompt({ text: "x", sourceLanguage: "english", targetLanguage: "klingon language" });
    expect(noCode).toContain("English (en) to Klingon Language translator");
  });

  it("includes the glossary rules when there are some", () => {
    const prompt = buildTranslateGemmaPrompt({ text: "x", sourceLanguage: "english", targetLanguage: "afrikaans", glossaryInstruction: "- war => oorlog" });
    expect(prompt).toContain("mandatory terminology rules:\n- war => oorlog");
  });
});