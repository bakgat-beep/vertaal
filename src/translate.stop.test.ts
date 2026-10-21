import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stop must end the "wait a bit" pauses at once — both the pause before each
// Google Translate request and the pause between retry attempts.
const h = vi.hoisted(() => ({
  translate: vi.fn(async () => ({ translatedText: "Hallo" })),
  executed: [] as string[],
}));

vi.mock("./db", () => ({
  getDb: async () => ({
    select: async () => [],
    execute: async (q: string) => {
      h.executed.push(q);
      return { rowsAffected: 1 };
    },
  }),
}));
vi.mock("./glossary", () => ({
  loadGlossaryTerms: async () => [],
  matchGlossaryTerms: () => [],
  buildGlossaryInstructions: () => [],
}));
vi.mock("./games", () => ({ GAME_ADAPTERS: {} }));
vi.mock("./providers/credentials.ts", () => ({ getProviderCredentials: async () => ({}) }));
vi.mock("./providers", () => ({
  getProjectProvider: () => ({
    id: "google-translate",
    displayName: "Google Translate",
    requiresModel: false,
    supportsGlossary: false,
    translate: h.translate,
  }),
}));

import { translateAndSave, translateWithRetry } from "./translate";
import type { Project } from "./types";

const project = (over: Partial<Project> = {}) =>
  ({
    game_id: "eu5",
    parent_game_id: "eu5",
    target_language: "afrikaans",
    source_language: "english",
    translation_provider_id: "google-translate",
    ai_model: null,
    google_translate_delay_ms: 60_000,
    retry_delay_ms: 60_000,
    ...over,
  }) as unknown as Project;

beforeEach(() => {
  vi.useFakeTimers();
  h.translate.mockClear();
  h.translate.mockImplementation(async () => ({ translatedText: "Hallo" }));
  h.executed.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("Stop during the Google Translate delay", () => {
  it("ends the wait at once, never sends the request, and leaves no timer behind", async () => {
    const stop = new AbortController();
    let result: Awaited<ReturnType<typeof translateAndSave>> | undefined;
    const run = translateAndSave(project(), "K", "eu5", "Hello", undefined, true, true, stop.signal).then((r) => (result = r));

    await vi.advanceTimersByTimeAsync(1_000); // one second into a one-minute delay
    expect(result).toBeUndefined(); // still waiting
    stop.abort();
    await vi.advanceTimersByTimeAsync(0); // no further time passes
    await run;

    expect(result).toEqual({ ok: false, error: "Stopped by user.", stopped: true });
    expect(h.translate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("if Stop was already pressed, does not wait at all", async () => {
    const stop = new AbortController();
    stop.abort();
    const result = await translateAndSave(project(), "K", "eu5", "Hello", undefined, true, true, stop.signal);
    expect(result.stopped).toBe(true);
    expect(h.translate).not.toHaveBeenCalled();
  });

  it("without Stop the full delay is still served and the string is translated", async () => {
    const stop = new AbortController();
    let done = false;
    const run = translateAndSave(project({ google_translate_delay_ms: 5_000 }), "K", "eu5", "Hello", undefined, true, true, stop.signal).then(
      (r) => ((done = true), r)
    );
    await vi.advanceTimersByTimeAsync(4_900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect((await run).ok).toBe(true);
    expect(h.translate).toHaveBeenCalledTimes(1);
  });

  it("a delay saved above the limit is capped at one minute", async () => {
    let done = false;
    const run = translateAndSave(project({ google_translate_delay_ms: 3_600_000 }), "K", "eu5", "Hello", undefined, true).then(
      (r) => ((done = true), r)
    );
    await vi.advanceTimersByTimeAsync(60_100);
    expect(done).toBe(true);
    expect((await run).ok).toBe(true);
  });
});

describe("Stop during the wait between retry attempts", () => {
  it("ends the wait at once, makes no further attempt, and does not flag the string", async () => {
    h.translate.mockImplementation(async () => {
      throw new Error("network down");
    });
    const stop = new AbortController();
    let result: Awaited<ReturnType<typeof translateWithRetry>> | undefined;
    const run = translateWithRetry(project(), "K", "eu5", "Hello", () => stop.signal.aborted, undefined, 3, undefined, false, true, stop.signal).then(
      (r) => (result = r)
    );

    await vi.advanceTimersByTimeAsync(1_000); // first attempt failed; now in the one-minute retry wait
    expect(result).toBeUndefined();
    expect(h.translate).toHaveBeenCalledTimes(1);
    stop.abort();
    await vi.advanceTimersByTimeAsync(0);
    await run;

    expect(result).toMatchObject({ ok: false, stopped: true, attempts: 1 });
    expect(h.translate).toHaveBeenCalledTimes(1); // the second attempt was never sent
    expect(h.executed.some((q) => q.includes("flagged"))).toBe(false); // not flagged for review
    expect(vi.getTimerCount()).toBe(0);
  });

  it("without Stop it still retries after the wait", async () => {
    h.translate.mockImplementationOnce(async () => {
      throw new Error("blip");
    });
    const run = translateWithRetry(project({ retry_delay_ms: 2_000 }), "K", "eu5", "Hello", () => false);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(await run).toMatchObject({ ok: true, attempts: 2 });
  });
});