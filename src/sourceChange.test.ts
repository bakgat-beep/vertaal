import { describe, it, expect } from "vitest";
// The files below are read as plain text (Vite's "?raw") so these tests can
// check that the SQL and the TypeScript rule stay in step.
import statusFiltersSource from "./statusFilters.ts?raw";
import migration0019 from "../src-tauri/migrations/0019_source_text_at_translation.sql?raw";
import migration0020 from "../src-tauri/migrations/0020_compact_change_tracking.sql?raw";
import importSource from "./import.ts?raw";
import {
  SOURCE_TEXT_UNKNOWN,
  isSourceChanged,
  legacySourceHash,
  diffWords,
  isWhitespaceOnlyChange,
} from "./sourceChange";

const row = (
  source_text: string,
  source_text_at_translation: string | null,
  status: string | null = "human-confirmed"
) => ({
  source_text,
  source_text_at_translation,
  status,
});

describe("isSourceChanged — any change at all is detected", () => {
  it("is false when the source is identical, or when nothing older is recorded (made against the current text)", () => {
    expect(isSourceChanged(row("Gain 10% tax.", "Gain 10% tax."))).toBe(false);
    expect(isSourceChanged(row("Gain 10% tax.", null))).toBe(false);
  });

  it("applies to confirmed and draft translations alike", () => {
    for (const status of ["human-confirmed", "human-draft", "ai-suggested"]) {
      expect(isSourceChanged(row("new", "old", status))).toBe(true);
    }
  });

  it("still applies to a confirmed string whose translation is empty (e.g. a blank string that gained text)", () => {
    expect(isSourceChanged(row("Now has words", " ", "human-confirmed"))).toBe(true);
  });

  it("catches changes the old length-plus-first-20-characters check missed", () => {
    const oldText = "Increases the maximum number of levies by 10%.";
    const newText = "Increases the maximum number of levies by 15%.";
    // the old fingerprint really was blind to this...
    expect(legacySourceHash(oldText)).toBe(legacySourceHash(newText));
    // ...the new comparison is not
    expect(isSourceChanged(row(newText, oldText))).toBe(true);
  });

  it("catches tiny edits: one character, punctuation, spacing, letter case", () => {
    const base = "Cannot be built in provinces with less than 5 development.";
    expect(isSourceChanged(row(base.replace("5", "3"), base))).toBe(true);
    expect(isSourceChanged(row(base.replace(".", ""), base))).toBe(true);
    expect(isSourceChanged(row(base.replace("in provinces", "in  provinces"), base))).toBe(true);
    expect(isSourceChanged(row(base.replace("Cannot", "cannot"), base))).toBe(true);
    expect(isSourceChanged(row(base + " ", base))).toBe(true);
  });

  it("stays flagged for translations whose earlier wording was never recorded", () => {
    expect(isSourceChanged(row("anything", SOURCE_TEXT_UNKNOWN))).toBe(true);
  });

  it("ignores placeholder rows that have no translation", () => {
    expect(isSourceChanged(row("b", "a", "untranslated"))).toBe(false);
    expect(isSourceChanged(row("b", "a", null))).toBe(false);
  });
});

describe("the SQL rule and this rule agree", () => {
  it("statusFilters.ts uses the same three conditions", () => {
    const src = statusFiltersSource;
    expect(src).toContain("t.source_text_at_translation IS NOT NULL");
    expect(src).toContain("t.status != 'untranslated'");
    expect(src).toContain("t.source_text_at_translation != s.source_text");
  });

  it("re-imports must UPDATE strings (never INSERT OR REPLACE them), or the database can't record the old wording", () => {
    expect(importSource).not.toContain("INSERT OR REPLACE INTO strings");
    expect(importSource).toContain("ON CONFLICT(key, game_id) DO UPDATE SET");
    expect(migration0020).toContain("AFTER UPDATE OF source_text ON strings");
  });

  it("migration 0019 writes exactly the SOURCE_TEXT_UNKNOWN marker", () => {
    expect(migration0019).toContain(`'${SOURCE_TEXT_UNKNOWN}'`);
  });
});

describe("diffWords", () => {
  const before = (parts: ReturnType<typeof diffWords>) =>
    parts.filter((p) => p.kind !== "added").map((p) => p.text).join("");
  const after = (parts: ReturnType<typeof diffWords>) =>
    parts.filter((p) => p.kind !== "removed").map((p) => p.text).join("");

  it("pinpoints a single changed number", () => {
    const parts = diffWords("Gain 10% tax per year.", "Gain 15% tax per year.");
    expect(parts.filter((p) => p.kind === "removed").map((p) => p.text)).toEqual(["10%"]);
    expect(parts.filter((p) => p.kind === "added").map((p) => p.text)).toEqual(["15%"]);
  });

  it("shows added and removed words", () => {
    const parts = diffWords("The old king", "The young wise king");
    expect(before(parts)).toBe("The old king");
    expect(after(parts)).toBe("The young wise king");
  });

  it("reports no changes for identical text", () => {
    expect(diffWords("same text", "same text")).toEqual([{ text: "same text", kind: "same" }]);
  });

  it("can always rebuild both originals exactly (randomised check)", () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const words = ["war", "peace", "10%", "15%", "$GOLD$", "[GetName]", "the", "a", "\n", "  "];
    const make = () =>
      Array.from({ length: Math.floor(rnd() * 12) }, () => words[Math.floor(rnd() * words.length)]).join(
        rnd() < 0.5 ? " " : ""
      );
    for (let n = 0; n < 500; n++) {
      const x = make();
      const y = make();
      const parts = diffWords(x, y);
      expect(before(parts)).toBe(x);
      expect(after(parts)).toBe(y);
    }
  });

  it("copes with very large text without freezing", () => {
    const big = "word ".repeat(3000);
    const parts = diffWords(big, big + "extra");
    expect(before(parts)).toBe(big);
    expect(after(parts)).toBe(big + "extra");
  });
});

describe("isWhitespaceOnlyChange", () => {
  it("recognises spacing-only edits", () => {
    expect(isWhitespaceOnlyChange("a b", "a  b")).toBe(true);
    expect(isWhitespaceOnlyChange("a b", "a\nb")).toBe(true);
    expect(isWhitespaceOnlyChange("a b", " a b ")).toBe(true);
  });
  it("is false for real changes and for identical text", () => {
    expect(isWhitespaceOnlyChange("a b", "a c")).toBe(false);
    expect(isWhitespaceOnlyChange("a b", "a b")).toBe(false);
  });
});

import { baselineForImportedTranslation } from "./sourceChange";

describe("baselineForImportedTranslation", () => {
  it("format 2: uses the stated text, or the exporter's own text when none is stated", () => {
    expect(baselineForImportedTranslation({ source_text: "new", source_text_at_translation: "old" }, "local", 2)).toBe("old");
    expect(baselineForImportedTranslation({ source_text: "same", source_text_at_translation: null }, "local", 2)).toBe("same");
    expect(baselineForImportedTranslation({}, "local", 2)).toBe("local");
  });

  it("format 2: a collaborator on a different game version shows up as changed here", () => {
    const baseline = baselineForImportedTranslation({ source_text: "their text" }, "my text", 2);
    expect(isSourceChanged({ source_text: "my text", source_text_at_translation: baseline, status: "human-confirmed" })).toBe(true);
  });

  it("format 1: recovers the exact wording when the old fingerprint matches the exporter's text", () => {
    const h = legacySourceHash("their text");
    expect(baselineForImportedTranslation({ source_text: "their text", source_text_hash: h }, "my text", 1)).toBe("their text");
  });

  it("format 1: treats it as up to date when the fingerprint matches this machine's text", () => {
    const h = legacySourceHash("my text");
    expect(baselineForImportedTranslation({ source_text: "other", source_text_hash: h }, "my text", 1)).toBe("my text");
  });

  it("format 1: keeps it flagged when the fingerprint matches neither text", () => {
    expect(baselineForImportedTranslation({ source_text: "a", source_text_hash: "1-zzz" }, "b", 1)).toBe(SOURCE_TEXT_UNKNOWN);
  });

  it("format 1: with no fingerprint at all, starts watching from the current local text", () => {
    expect(baselineForImportedTranslation({ source_text: "a" }, "b", 1)).toBe("b");
    expect(baselineForImportedTranslation({ source_text: "a", source_text_hash: null }, "b", 1)).toBe("b");
  });
});