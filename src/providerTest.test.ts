import { describe, it, expect, vi } from "vitest";
import { testProviderConnection, explainProviderError, makeProviderTestRunner } from "./providerTest";
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
    requiresApiKey: false,
    supportsCustomBaseUrl: false,
    isLlm: false,
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
    // The request always gets its own abort signal (see the cancellation tests below).
    expect(translate).toHaveBeenCalledWith(
      { text: "Hello", sourceLanguage: "english", targetLanguage: "afrikaans" },
      { ...config, signal: expect.any(AbortSignal) }
    );
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

// A provider whose request never finishes by itself, and that records the
// abort signal it was given — like a real request that is still on the network.
function hangingProvider() {
  const seen: { signal?: AbortSignal } = {};
  const provider = fakeProvider((_request, cfg) => {
    seen.signal = cfg.signal;
    return new Promise(() => {});
  });
  return { provider, seen };
}

describe("testProviderConnection: cancelling the request itself", () => {
  it("when it times out, ABORTS the provider's request (not just stops waiting for it)", async () => {
    const { provider, seen } = hangingProvider();
    const r = await testProviderConnection(provider, config, "english", "afrikaans", { timeoutMs: 20 });
    expect(r.message).toMatch(/No answer from DeepL/); // the reason shown is the timeout...
    expect(seen.signal?.aborted).toBe(true); // ...and the request really was told to stop
  });

  it("when the caller's signal fires (settings changed), aborts the request and reports a cancellation", async () => {
    const { provider, seen } = hangingProvider();
    const outside = new AbortController();
    const pending = testProviderConnection(provider, config, "english", "afrikaans", { signal: outside.signal, timeoutMs: 60_000 });
    await Promise.resolve();
    expect(seen.signal?.aborted).toBe(false); // still running
    outside.abort();
    const r = await pending;
    expect(seen.signal?.aborted).toBe(true);
    expect(r).toEqual({ ok: false, message: "The test was cancelled." });
  });

  it("if the caller's signal has already fired, never sends the request at all", async () => {
    const translate = vi.fn(async () => ({ translatedText: "x" }));
    const outside = new AbortController();
    outside.abort();
    const r = await testProviderConnection(fakeProvider(translate), config, "english", "afrikaans", { signal: outside.signal });
    expect(translate).not.toHaveBeenCalled();
    expect(r.message).toBe("The test was cancelled.");
  });

  it("a test that succeeds does not abort its own request, and leaves no timer running", async () => {
    vi.useFakeTimers();
    try {
      let seen: AbortSignal | undefined;
      const p = fakeProvider(async (_r, cfg) => {
        seen = cfg.signal;
        return { translatedText: "Hallo" };
      });
      const r = await testProviderConnection(p, config, "english", "afrikaans");
      expect(r.ok).toBe(true);
      expect(seen?.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops listening to the caller's signal once the test is over (no leftover listener)", async () => {
    const outside = new AbortController();
    const remove = vi.spyOn(outside.signal, "removeEventListener");
    await testProviderConnection(fakeProvider(async () => ({ translatedText: "Hallo" })), config, "english", "afrikaans", {
      signal: outside.signal,
    });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

describe("makeProviderTestRunner (one test at a time; a stale test is stopped, not just hidden)", () => {
  const start = (p: TranslationProvider) => (signal: AbortSignal) =>
    testProviderConnection(p, config, "english", "afrikaans", { signal, timeoutMs: 60_000 });

  it("cancel() (the settings changed) aborts the running test's request and gives no answer", async () => {
    const runner = makeProviderTestRunner();
    const { provider, seen } = hangingProvider();
    const pending = runner.run(start(provider));
    await Promise.resolve();
    expect(seen.signal?.aborted).toBe(false);
    runner.cancel();
    expect(seen.signal?.aborted).toBe(true);
    expect(await pending).toBeNull();
  });

  it("starting a new test aborts the earlier one's request, and only the new test gives an answer", async () => {
    const runner = makeProviderTestRunner();
    const first = hangingProvider();
    const firstRun = runner.run(start(first.provider));
    await Promise.resolve();

    const second = fakeProvider(async () => ({ translatedText: "Hallo" }));
    const secondResult = await runner.run(start(second));

    expect(first.seen.signal?.aborted).toBe(true);
    expect(await firstRun).toBeNull();
    expect(secondResult?.ok).toBe(true);
  });

  it("a test nobody interrupted gives its answer, and the runner can be used again", async () => {
    const runner = makeProviderTestRunner();
    const p = fakeProvider(async () => ({ translatedText: "Hallo" }));
    expect((await runner.run(start(p)))?.ok).toBe(true);
    expect((await runner.run(start(p)))?.ok).toBe(true);
  });

  it("cancel() with nothing running does nothing", () => {
    expect(() => makeProviderTestRunner().cancel()).not.toThrow();
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