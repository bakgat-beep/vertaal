import { describe, it, expect } from "vitest";
import {
  parseLocFile,
  protectTokens,
  restoreTokens,
  validateTokensPreserved,
  escapeForLocExport,
} from "./parser";

// This is the first test file in the project. These tests characterize
// parser.ts's CURRENT, real behavior — including known limitations that
// are documented rather than silently "fixed" without a concrete example
// showing they cause a real problem (see AI_ASSISTED_DEVELOPMENT.md's
// preference for hardening driven by real failing cases over speculative
// rewrites). Where a test documents a known limitation rather than
// asserting ideal behavior, it says so.

describe("parseLocFile", () => {
  it("parses a normal versioned entry", () => {
    const result = parseLocFile(`some_key:0 "Some text"`);
    expect(result).toEqual([{ key: "some_key", text: "Some text" }]);
  });

  it("parses an entry with no version number", () => {
    const result = parseLocFile(`some_key: "Some text"`);
    expect(result).toEqual([{ key: "some_key", text: "Some text" }]);
  });

  it("parses an indented entry", () => {
    const result = parseLocFile(` some_key:0 "Some text"`);
    expect(result).toEqual([{ key: "some_key", text: "Some text" }]);
  });

  it("parses a key containing dots", () => {
    const result = parseLocFile(`some.nested.key:0 "Some text"`);
    expect(result).toEqual([{ key: "some.nested.key", text: "Some text" }]);
  });

  it("parses an empty value", () => {
    const result = parseLocFile(`some_key:0 ""`);
    expect(result).toEqual([{ key: "some_key", text: "" }]);
  });

  it("preserves a colon inside the value", () => {
    const result = parseLocFile(`some_key:0 "Time: 5 minutes"`);
    expect(result).toEqual([{ key: "some_key", text: "Time: 5 minutes" }]);
  });

  it("preserves unicode/accented characters", () => {
    const result = parseLocFile(`some_key:0 "Café résumé"`);
    expect(result).toEqual([{ key: "some_key", text: "Café résumé" }]);
  });

  it("ignores a full-line comment", () => {
    const result = parseLocFile(`# this is a comment`);
    expect(result).toEqual([]);
  });

  it("ignores a comment that happens to look data-shaped (does not misparse it)", () => {
    const result = parseLocFile(`# some_key: "example text"`);
    expect(result).toEqual([]);
  });

  it("ignores blank and whitespace-only lines", () => {
    const result = parseLocFile(`\n   \n\t\n`);
    expect(result).toEqual([]);
  });

  it("skips a line with an unterminated quote rather than misparsing it", () => {
    const result = parseLocFile(`some_key:0 "unterminated`);
    expect(result).toEqual([]);
  });

  it("skips a line with no quotes at all", () => {
    const result = parseLocFile(`some_key:0 no quotes here`);
    expect(result).toEqual([]);
  });

  it("parses multiple entries across lines, skipping blank/comment lines between them", () => {
    const content = [
      `# header comment`,
      `first_key:0 "First"`,
      ``,
      `second_key:0 "Second"`,
    ].join("\n");
    const result = parseLocFile(content);
    expect(result).toEqual([
      { key: "first_key", text: "First" },
      { key: "second_key", text: "Second" },
    ]);
  });

  it("parses a data line with a trailing same-line comment, keeping the string", () => {
    const result = parseLocFile(`some_key:0 "Some text" # trailing comment`);
    expect(result).toEqual([{ key: "some_key", text: "Some text" }]);
  });

  it("parses a trailing comment even with no space before the #", () => {
    const result = parseLocFile(`some_key:0 "Some text"# trailing comment`);
    expect(result).toEqual([{ key: "some_key", text: "Some text" }]);
  });

  it("correctly finds the real closing quote even when the trailing comment itself contains a quote character", () => {
    // This is the case that made a naive fix risky: if the parser just
    // looked for the LAST quote on the line to find "the" closing quote,
    // a quote inside the comment (not inside the value) would be
    // mistaken for the value's real terminator, corrupting the imported
    // text by pulling comment content into it.
    const result = parseLocFile(`some_key:0 "Some text" # this was "old"`);
    expect(result).toEqual([{ key: "some_key", text: "Some text" }]);
  });

  it("still parses an empty value that has a trailing comment", () => {
    const result = parseLocFile(`some_key:0 "" # empty but noted`);
    expect(result).toEqual([{ key: "some_key", text: "" }]);
  });
});

describe("protectTokens / restoreTokens round-trip", () => {
  it("protects and restores a $variable$", () => {
    const { text, tokens } = protectTokens("Build $COUNT$ ships.");
    expect(text).toBe("Build __TOKEN_0__ ships.");
    expect(tokens).toEqual(["$COUNT$"]);
    expect(restoreTokens(text, tokens)).toBe("Build $COUNT$ ships.");
  });

  it("protects and restores multiple different token types together", () => {
    const source = "Build $COUNT$ ships in £naval_base£ for #bold important#! reasons.";
    const { text, tokens } = protectTokens(source);
    const restored = restoreTokens(text, tokens);
    expect(restored).toBe(source);
  });

  it("round-trips even when the translation reorders the tokens", () => {
    // Deliberately verifying that reordering placeholders in the
    // "translated" text still restores correctly — this is the legitimate
    // case validateTokensPreserved is designed to allow (see its own
    // comment in parser.ts about word-order differences across languages).
    const { text, tokens } = protectTokens("Send $GOLD$ to $COUNTRY$.");
    // Simulate a translation that swaps the two token positions.
    const reordered = text.replace("__TOKEN_0__", "__TMP__").replace("__TOKEN_1__", "__TOKEN_0__").replace("__TMP__", "__TOKEN_1__");
    const restored = restoreTokens(reordered, tokens);
    expect(restored).toBe("Send $COUNTRY$ to $GOLD$.");
  });

  // KNOWN LIMITATION — not yet confirmed as a real problem in practice.
  // restoreTokens uses a non-global string replace, so it only substitutes
  // the FIRST occurrence of a given placeholder. In today's code this is
  // masked by validateTokensPreserved rejecting any translation with a
  // duplicated placeholder before restoreTokens ever sees it — so it's not
  // reachable through the normal translation flow right now. Documented
  // here so it's visible if that validation rule ever changes (e.g. to
  // deliberately allow a translator repeating a variable for style).
  it("[KNOWN LIMITATION] only restores the first occurrence of a repeated placeholder", () => {
    const tokens = ["$GOLD$"];
    const translatedWithRepeat = "__TOKEN_0__ and __TOKEN_0__ again";
    const restored = restoreTokens(translatedWithRepeat, tokens);
    expect(restored).toBe("$GOLD$ and __TOKEN_0__ again"); // second occurrence left unrestored
  });
});

describe("validateTokensPreserved", () => {
  it("accepts unchanged tokens", () => {
    expect(validateTokensPreserved("Bou __TOKEN_0__ skepe in __TOKEN_1__.", 2)).toBe(true);
  });

  it("accepts legitimately reordered tokens (different word order)", () => {
    expect(validateTokensPreserved("In __TOKEN_1__ bou __TOKEN_0__ skepe.", 2)).toBe(true);
  });

  it("rejects a missing token", () => {
    expect(validateTokensPreserved("Bou skepe in __TOKEN_1__.", 2)).toBe(false);
  });

  it("rejects a duplicated token with another missing", () => {
    expect(validateTokensPreserved("Bou __TOKEN_0__ skepe in __TOKEN_0__.", 2)).toBe(false);
  });

  it("rejects an invented/out-of-range token index", () => {
    expect(validateTokensPreserved("Bou __TOKEN_0__ skepe in __TOKEN_5__.", 2)).toBe(false);
  });

  it("rejects an extra unexpected token", () => {
    expect(validateTokensPreserved("Bou __TOKEN_0__ skepe in __TOKEN_1__ __TOKEN_1__.", 2)).toBe(false);
  });

  it("accepts zero tokens when none were protected", () => {
    expect(validateTokensPreserved("Plain text with no tokens.", 0)).toBe(true);
  });
});

describe("escapeForLocExport", () => {
  it("leaves plain text untouched", () => {
    expect(escapeForLocExport("Simple text")).toBe("Simple text");
  });

  it("escapes a quote", () => {
    expect(escapeForLocExport(`He said "hello"`)).toBe(`He said \\"hello\\"`);
  });

  it("escapes a backslash", () => {
    expect(escapeForLocExport(`Path C:\\Users\\test`)).toBe(`Path C:\\\\Users\\\\test`);
  });

  it("escapes backslashes and quotes together without double-escaping", () => {
    expect(escapeForLocExport(`Mixed \\ and "quote"`)).toBe(`Mixed \\\\ and \\"quote\\"`);
  });
});