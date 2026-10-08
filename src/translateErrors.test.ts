import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProviderError } from "./providers/errors";

let saved: { text: string }[] = [];
let flagged = 0;
const fakeDb = {
  select: async () => [],
  execute: async (q: string, p: any[] = []) => {
    if (q.includes("INSERT OR REPLACE INTO translations")) saved.push({ text: p[3] });
    if (q.includes("SET flagged = 1")) flagged++;
  },
};
vi.mock("./db", () => ({ getDb: async () => fakeDb }));
vi.mock("./glossary", () => ({ loadGlossaryTerms: async () => [], matchGlossaryTerms: () => [], buildGlossaryInstructions: () => [] }));
vi.mock("./games", () => ({ GAME_ADAPTERS: {} }));
vi.mock("./providers/credentials.ts", () => ({ getProviderCredentials: async () => ({}) }));

const state = vi.hoisted(() => ({ provider: null as any }));
vi.mock("./providers", () => ({ getProjectProvider: () => state.provider }));

import { translateAndSave, translateWithRetry } from "./translate";
import type { Project } from "./types";

const project = {
  game_id: "eu5", parent_game_id: "eu5", target_language: "afrikaans", source_language: "english",
  translation_provider_id: "x", ai_model: "m", retry_delay_ms: 0,
} as unknown as Project;

function provider(translate: (req: any, cfg: any) => Promise<{ translatedText: string }>, extra: object = {}) {
  state.provider = { id: "x", displayName: "X", requiresModel: false, isLlm: false, translate: vi.fn(translate), ...extra };
  return state.provider;
}

beforeEach(() => {
  saved = [];
  flagged = 0;
});

describe("retrying", () => {
  it("does not retry or flag a string when the problem is permanent (e.g. a rejected key)", async () => {
    const p = provider(async () => { throw new ProviderError("bad key", "permanent", 401); });
    const r = await translateWithRetry(project, "K", "eu5", "Hello", () => false, undefined, 3, 0);
    expect(r).toMatchObject({ ok: false, permanent: true, attempts: 1 });
    expect(p.translate).toHaveBeenCalledTimes(1);
    expect(flagged).toBe(0);
  });

  it("retries a temporary failure, then flags the string after the last attempt", async () => {
    const p = provider(async () => { throw new ProviderError("busy", "transient", 503); });
    const r = await translateWithRetry(project, "K", "eu5", "Hello", () => false, undefined, 3, 0);
    expect(r.ok).toBe(false);
    expect(r.permanent).toBeUndefined();
    expect(p.translate).toHaveBeenCalledTimes(3);
    expect(flagged).toBe(1);
  });
});

describe("Stop and timeouts", () => {
  it("Stop cancels a request that is still waiting, at once, without flagging the string", async () => {
    let seenSignal: AbortSignal | undefined;
    provider((_req, cfg) => {
      seenSignal = cfg.signal;
      return new Promise(() => {}); // never answers
    });
    const stop = new AbortController();
    const pending = translateWithRetry(project, "K", "eu5", "Hello", () => false, undefined, 3, 0, false, false, stop.signal);
    await new Promise((r) => setTimeout(r, 10));
    stop.abort();
    const r = await pending;
    expect(r).toMatchObject({ ok: false, stopped: true });
    expect(seenSignal?.aborted).toBe(true); // the provider's own request was told to give up too
    expect(flagged).toBe(0);
  });

  it("gives up on a request that takes too long and counts it as a temporary failure", async () => {
    provider(() => new Promise(() => {}), { requestTimeoutMs: 20 });
    const r = await translateAndSave(project, "K", "eu5", "Hello");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No answer within/);
    expect(r.permanent).toBeUndefined();
  });
});

describe("what comes back from the provider", () => {
  it("rejects a chat model's introduction instead of saving it as game text", async () => {
    provider(async () => ({ translatedText: "Here is the translation: Hallo" }), { isLlm: true });
    const r = await translateAndSave(project, "K", "eu5", "Hello");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/introduction/);
    expect(saved).toHaveLength(0);
  });

  it("does not apply that check to a dedicated translation service", async () => {
    provider(async () => ({ translatedText: "Here is the translation: Hallo" }), { isLlm: false });
    expect((await translateAndSave(project, "K", "eu5", "Hello")).ok).toBe(true);
  });

  it("keeps the spaces a string started and ended with", async () => {
    provider(async () => ({ translatedText: "Goud:" }));
    await translateAndSave(project, "K", "eu5", "Gold: ");
    expect(saved[0].text).toBe("Goud: ");
  });
});