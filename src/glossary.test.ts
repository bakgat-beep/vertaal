import { describe, it, expect, vi } from "vitest";

// The matching functions are pure text logic; the database module is only
// needed by the loaders, so it's replaced with an empty stand-in here.
vi.mock("./db", () => ({ getDb: vi.fn() }));

import { matchGlossaryTerms, buildGlossaryInstructions, type GlossaryTerm } from "./glossary";

let nextId = 1;
const term = (
  english_term: string,
  translated_term: string,
  extra: Partial<GlossaryTerm> = {}
): GlossaryTerm => ({
  id: nextId++,
  english_term,
  translated_term,
  game_id: "eu5",
  target_language: "afrikaans",
  ...extra,
});
const names = (src: string, terms: GlossaryTerm[]) => matchGlossaryTerms(src, terms).map((t) => t.english_term);

describe("matchGlossaryTerms — whole words only", () => {
  it("matches a term as a whole word", () => {
    expect(names("The war ended.", [term("war", "oorlog")])).toEqual(["war"]);
  });

  it("does NOT match inside longer words", () => {
    expect(names("Issue a warrant to the party.", [term("war", "oorlog"), term("art", "kuns")])).toEqual([]);
    expect(names("A swarm approaches.", [term("war", "oorlog")])).toEqual([]);
  });

  it("allows simple English plurals and possessives, in any letter case", () => {
    expect(names("Two Wars were fought.", [term("war", "oorlog")])).toEqual(["war"]);
    expect(names("The duchies and duchy's lords.", [term("duchy", "hertogdom")])).toEqual(["duchy"]);
    expect(names("Fines apply.", [term("fine", "boete")])).toEqual(["fine"]);
  });

  it("treats accented and other-language letters as part of a word", () => {
    expect(names("A quiet café.", [term("cafe", "kafee")])).toEqual([]);
  });

  it("matches multi-word terms", () => {
    expect(names("Sign the peace treaty.", [term("peace treaty", "vredesverdrag")])).toEqual(["peace treaty"]);
  });

  it("copes with terms containing punctuation", () => {
    expect(names("Visit St. Petersburg today.", [term("St. Petersburg", "Sint Petersburg")])).toEqual([
      "St. Petersburg",
    ]);
    expect(() => names("anything", [term("a+b(c)[d]", "x")])).not.toThrow();
  });
});

describe("matchGlossaryTerms — game code is not text", () => {
  it("ignores words that only appear inside icons, variables and functions", () => {
    expect(names("Pay £gold£ to $GOLD$ and [GetGold].", [term("gold", "goud")])).toEqual([]);
    expect(names("Pay £gold£ in gold.", [term("gold", "goud")])).toEqual(["gold"]);
  });
});

describe("matchGlossaryTerms — which term wins", () => {
  it("prefers the longer phrase over a shorter one it covers", () => {
    expect(names("Sign the peace treaty.", [term("peace", "vrede"), term("peace treaty", "vredesverdrag")])).toEqual([
      "peace treaty",
    ]);
  });

  it("still keeps the shorter term when it also appears on its own", () => {
    expect(
      names("Sign the peace treaty and keep the peace.", [term("peace", "vrede"), term("peace treaty", "vredesverdrag")]).sort()
    ).toEqual(["peace", "peace treaty"]);
  });

  it("does not let an unrelated longer word suppress a shorter term", () => {
    expect(names("A war and a warrant.", [term("war", "oorlog"), term("warrant", "lasbrief")]).sort()).toEqual([
      "war",
      "warrant",
    ]);
  });

  it("uses the most specific scope for the same English word: mod > base game > shared", () => {
    const shared = term("duchy", "SHARED", { game_id: null, priority: 1 });
    const base = term("duchy", "BASE", { game_id: "eu5", priority: 2 });
    const mod = term("duchy", "MOD", { game_id: "eu5:mod:x", priority: 3 });
    expect(matchGlossaryTerms("A duchy.", [shared, base, mod]).map((t) => t.translated_term)).toEqual(["MOD"]);
    expect(matchGlossaryTerms("A duchy.", [mod, base, shared]).map((t) => t.translated_term)).toEqual(["MOD"]);
    expect(matchGlossaryTerms("A duchy.", [shared, base]).map((t) => t.translated_term)).toEqual(["BASE"]);
  });

  it("without priorities, a game-specific term still beats a shared one", () => {
    const shared = term("duchy", "SHARED", { game_id: null });
    const game = term("duchy", "GAME");
    expect(matchGlossaryTerms("A duchy.", [shared, game]).map((t) => t.translated_term)).toEqual(["GAME"]);
  });
});

describe("matchGlossaryTerms — unusable terms", () => {
  it("skips terms with no translation or no English word", () => {
    expect(names("Sign the peace treaty.", [term("peace treaty", ""), term("peace", "   ")])).toEqual([]);
    expect(names("Anything at all.", [term("", "x")])).toEqual([]);
  });
});

describe("buildGlossaryInstructions", () => {
  it("quotes the word as it appears in the text and matches its capital letter", () => {
    const src = "Wars are costly.";
    const lines = buildGlossaryInstructions(src, matchGlossaryTerms(src, [term("war", "oorlog")]));
    expect(lines).toEqual(['- "Wars" must be translated as "Oorlog"']);
  });

  it("never produces an empty translation instruction", () => {
    const src = "Sign the peace treaty.";
    const lines = buildGlossaryInstructions(src, matchGlossaryTerms(src, [term("peace treaty", "")]));
    expect(lines).toEqual([]);
  });
});