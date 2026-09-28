import { describe, it, expect, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }));

import { openaiCompatibleProvider } from "./openai-compatible";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("openaiCompatibleProvider", () => {
  it("defaults to the OpenAI API when no Base URL is set, and trims a trailing slash otherwise", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "Hallo" } }] }));
    await openaiCompatibleProvider.translate(
      { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
      { providerId: "test", apiKey: null, baseUrl: null, model: "gpt-4o-mini" }
    );
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");

    fetchMock.mockClear();
    await openaiCompatibleProvider.translate(
      { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
      { providerId: "test", apiKey: null, baseUrl: "http://myserver:8080/v1/", model: "local-model" }
    );
    expect(fetchMock.mock.calls[0][0]).toBe("http://myserver:8080/v1/chat/completions");
  });

  it("only sends an Authorization header when a key is configured (self-hosted servers often need none)", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "Hallo" } }] }));
    await openaiCompatibleProvider.translate(
      { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
      { providerId: "test", apiKey: null, baseUrl: "http://myserver:8080/v1", model: "local-model" }
    );
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();

    fetchMock.mockClear();
    await openaiCompatibleProvider.translate(
      { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
      { providerId: "test", apiKey: "sk-secret", baseUrl: null, model: "gpt-4o-mini" }
    );
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-secret");
  });

  it("listModels returns model ids, and an empty list on failure rather than throwing", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] }));
    expect(
      await openaiCompatibleProvider.listModels!({ providerId: "test", apiKey: null, baseUrl: null, model: null })
    ).toEqual(["gpt-4o", "gpt-4o-mini"]);

    fetchMock.mockResolvedValue(jsonResponse({}, false, 401));
    expect(
      await openaiCompatibleProvider.listModels!({ providerId: "test", apiKey: null, baseUrl: null, model: null })
    ).toEqual([]);

    fetchMock.mockImplementation(async () => {
      throw new Error("network down");
    });
    expect(
      await openaiCompatibleProvider.listModels!({ providerId: "test", apiKey: null, baseUrl: null, model: null })
    ).toEqual([]);
  });
});

describe("openaiCompatibleProvider prompt language names", () => {
  it("sends readable language names in the prompt, even for a raw internal code like braz_por", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "x" } }] }));
    await openaiCompatibleProvider.translate(
      { text: "Ola", sourceLanguage: "braz_por", targetLanguage: "simp_chinese" },
      { providerId: "test", apiKey: null, baseUrl: null, model: "gpt-4o-mini" }
    );
    const [, init] = fetchMock.mock.calls[0];
    const prompt = JSON.parse(init.body).messages[0].content;
    expect(prompt).toContain("Brazilian Portuguese to Simplified Chinese translator");
    expect(prompt).not.toContain("braz_por");
    expect(prompt).not.toContain("simp_chinese");
  });
});