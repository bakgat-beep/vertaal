import { describe, it, expect } from "vitest";
import { isBlank, isCodeOnly, needsNoTranslation } from "./codeOnly";

describe("isCodeOnly", () => {
  it("is true for strings made only of variables, functions and icons", () => {
    expect(isCodeOnly("$COUNT$")).toBe(true);
    expect(isCodeOnly("[GetName]")).toBe(true);
    expect(isCodeOnly("£gold£ $VALUE$")).toBe(true);
    expect(isCodeOnly("$A$\\n$B$")).toBe(true);
  });

  it("is false as soon as there is real text", () => {
    expect(isCodeOnly("Build $COUNT$ ships.")).toBe(false);
    expect(isCodeOnly("Peace")).toBe(false);
    expect(isCodeOnly("[GetName] declares war")).toBe(false);
  });

  it("is false for blank strings (they have no code in them either)", () => {
    expect(isCodeOnly("")).toBe(false);
    expect(isCodeOnly("   ")).toBe(false);
  });
});

describe("isBlank", () => {
  it("is true for empty and whitespace-only strings", () => {
    expect(isBlank("")).toBe(true);
    expect(isBlank(" ")).toBe(true);
    expect(isBlank("   \t\r\n ")).toBe(true);
  });

  it("is false when there is anything else", () => {
    expect(isBlank("a")).toBe(false);
    expect(isBlank(" $X$ ")).toBe(false);
    expect(isBlank(" . ")).toBe(false);
  });
});

describe("needsNoTranslation", () => {
  it("covers both blank and code-only strings, but not real text", () => {
    expect(needsNoTranslation("")).toBe(true);
    expect(needsNoTranslation(" ")).toBe(true);
    expect(needsNoTranslation("$COUNT$")).toBe(true);
    expect(needsNoTranslation("Peace")).toBe(false);
  });
});

import { shouldConfirmAsIs } from "./codeOnly";

describe("shouldConfirmAsIs", () => {
  const c = (over: Partial<Parameters<typeof shouldConfirmAsIs>[0]>) => ({
    source_text: "$COUNT$",
    status: null as string | null,
    translated_text: null as string | null,
    translated_by: null as string | null,
    ...over,
  });

  it("confirms untranslated strings that qualify", () => {
    expect(shouldConfirmAsIs(c({}), isCodeOnly)).toBe(true);
    expect(shouldConfirmAsIs(c({ status: "untranslated", translated_text: "" }), isCodeOnly)).toBe(true);
    expect(shouldConfirmAsIs(c({ source_text: " " }), isBlank)).toBe(true);
    expect(shouldConfirmAsIs(c({ source_text: "" }), isBlank)).toBe(true);
  });

  it("does not confirm strings that don't qualify", () => {
    expect(shouldConfirmAsIs(c({ source_text: "Peace" }), isCodeOnly)).toBe(false);
    expect(shouldConfirmAsIs(c({ source_text: "$COUNT$" }), isBlank)).toBe(false);
  });

  it("also confirms AI drafts that are just a copy of the source (left by the old action)", () => {
    expect(shouldConfirmAsIs(c({ status: "ai-suggested", translated_text: "$COUNT$" }), isCodeOnly)).toBe(true);
    expect(shouldConfirmAsIs(c({ status: "ai-suggested", translated_text: "x", translated_by: "auto (code-only)" }), isCodeOnly)).toBe(true);
  });

  it("never replaces text somebody wrote or an AI draft that differs from the source", () => {
    expect(shouldConfirmAsIs(c({ status: "human-draft", translated_text: "$TELLING$" }), isCodeOnly)).toBe(false);
    expect(shouldConfirmAsIs(c({ status: "ai-suggested", translated_text: "$OTHER$", translated_by: "model" }), isCodeOnly)).toBe(false);
    expect(shouldConfirmAsIs(c({ status: "human-confirmed", translated_text: "$COUNT$" }), isCodeOnly)).toBe(false);
  });
});