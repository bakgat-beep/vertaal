import { describe, it, expect, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }));
vi.mock("../ollama", () => ({ detectInstalledModels: vi.fn(async () => []) }));

import { ollamaProvider } from "./ollama";

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
    expect(prompt).toContain("English to Simplified Chinese translator");
    expect(prompt).not.toContain("simp_chinese");
  });

  it("trims the model's response", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ message: { content: "  Hallo  " } }));
    const result = await ollamaProvider.translate(
      { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
      { providerId: "test", apiKey: null, baseUrl: null, model: "translategemma-9b" }
    );
    expect(result.translatedText).toBe("Hallo");
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