import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("./db", () => ({
  getDb: async () => ({ select: async () => [], execute: async () => undefined }),
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
    translate: async () => ({ translatedText: "Hallo" }),
  }),
}));

import { translateAndSave } from "./translate";
import type { Project } from "./types";

const project = {
  game_id: "eu5",
  parent_game_id: "eu5",
  target_language: "afrikaans",
  source_language: "english",
  translation_provider_id: "google-translate",
  ai_model: null,
  google_translate_delay_ms: 5000,
} as unknown as Project;

afterEach(() => vi.useRealTimers());

describe("Google Translate delay", () => {
  it("does NOT slow down a single manual translation", async () => {
    vi.useFakeTimers();
    const result = await translateAndSave(project, "K", "eu5", "Hello"); // no timers advanced
    expect(result.ok).toBe(true);
  });

  it("applies the delay in batch runs", async () => {
    vi.useFakeTimers();
    let done = false;
    const p = translateAndSave(project, "K", "eu5", "Hello", undefined, true).then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(4900);
    expect(done).toBe(false); // still waiting out the 5-second delay
    await vi.advanceTimersByTimeAsync(200);
    expect((await p).ok).toBe(true);
  });
});