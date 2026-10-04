import { describe, it, expect } from "vitest";
import { buildSearchPattern, buildSearchClause, buildSearchPageQuery } from "./searchPattern";

// ---- test-only stand-ins for how the database reads the two pattern kinds ----

const escapeRegex = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// LIKE (with ESCAPE '\'): % = any run, _ = any one character, \x = literal x.
// The database ignores capitals for A-Z only.
function likeMatches(pattern: string, text: string): boolean {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") re += escapeRegex(pattern[++i] ?? "");
    else if (ch === "%") re += "[\\s\\S]*";
    else if (ch === "_") re += "[\\s\\S]";
    else if (/[a-z]/i.test(ch)) re += `[${ch.toLowerCase()}${ch.toUpperCase()}]`;
    else re += escapeRegex(ch);
  }
  return new RegExp(`^${re}$`, "u").test(text);
}

// GLOB: * = any run, ? = any one character, [abc] = one of those; case-sensitive.
function globMatches(pattern: string, text: string): boolean {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") re += "[\\s\\S]*";
    else if (ch === "?") re += "[\\s\\S]";
    else if (ch === "[") {
      const close = pattern.indexOf("]", i + 2);
      const members = Array.from(pattern.slice(i + 1, close)).map(escapeRegex);
      re += `(?:${members.join("|")})`;
      i = close;
    } else re += escapeRegex(ch);
  }
  return new RegExp(`^${re}$`, "u").test(text);
}

function finds(term: string, text: string): boolean {
  const p = buildSearchPattern(term);
  return p.operator === "LIKE" ? likeMatches(p.pattern, text) : globMatches(p.pattern, text);
}

describe("buildSearchPattern — which kind of pattern", () => {
  it("uses the faster LIKE form for plain ASCII terms, with its escape character declared", () => {
    const p = buildSearchPattern("army");
    expect(p).toEqual({ operator: "LIKE", pattern: "%army%", suffix: " ESCAPE '\\'" });
  });

  it("uses GLOB when the term has letters outside A-Z", () => {
    expect(buildSearchPattern("sê").operator).toBe("GLOB");
    expect(buildSearchPattern("Östergötland").operator).toBe("GLOB");
  });
});

describe("a typed _ or % is just that character", () => {
  it("does not treat % as 'anything'", () => {
    expect(finds("100%", "Tax is 100% now")).toBe(true);
    expect(finds("100%", "1000 men")).toBe(false);
  });

  it("does not treat _ as 'any one character' (keys are full of underscores)", () => {
    expect(finds("character_name", "x character_name y")).toBe(true);
    expect(finds("character_name", "characterXname")).toBe(false);
  });

  it("treats a backslash literally", () => {
    expect(finds("a\\b", "path a\\b here")).toBe(true);
    expect(finds("a\\b", "path ab here")).toBe(false);
  });

  it("treats * ? [ literally in the GLOB form too", () => {
    expect(finds("ê*", "see ê* here")).toBe(true);
    expect(finds("ê*", "see êxyz here")).toBe(false);
    expect(finds("ê?", "ê? yes")).toBe(true);
    expect(finds("ê?", "êx no")).toBe(false);
    expect(finds("ê[1]", "ê[1] yes")).toBe(true);
    expect(finds("ê[1]", "ê1 no")).toBe(false);
  });
});

describe("capitals are ignored in every alphabet", () => {
  it("plain ASCII", () => {
    expect(finds("army", "The ARMY marches")).toBe(true);
  });

  it("accented and other non-ASCII letters, which LIKE alone gets wrong", () => {
    expect(finds("östergötland", "Östergötland")).toBe(true);
    expect(finds("ÖSTERGÖTLAND", "östergötland")).toBe(true);
    expect(finds("é", "É")).toBe(true);
    expect(finds("привет", "Привет, мир")).toBe(true);
  });

  it("ASCII letters inside a term that also has accents are still case-insensitive", () => {
    expect(finds("KASÊ", "kasê")).toBe(true);
    expect(finds("kasê", "KASÊ")).toBe(true);
  });
});

describe("accents are NOT ignored (in Afrikaans an accent can change the word)", () => {
  it("sê does not find se, and se does not find sê", () => {
    expect(finds("sê", "ek sê dit")).toBe(true);
    expect(finds("sê", "sy se kat")).toBe(false);
    expect(finds("se", "ek sê dit")).toBe(false);
  });
});

describe("terms that cannot be mangled", () => {
  it("a letter whose capital is two letters (ß -> SS) is kept as typed", () => {
    expect(finds("straße", "Die Straße")).toBe(true);
  });

  it("an empty term matches everything, like before", () => {
    expect(finds("", "anything")).toBe(true);
  });

  it("text outside the BMP (e.g. emoji, rare scripts) is kept intact", () => {
    expect(finds("ê😀", "x ê😀 y")).toBe(true);
  });
});

describe("buildSearchClause", () => {
  it("adds one parameter per column and numbers placeholders after the existing ones", () => {
    const params: (string | number)[] = ["afrikaans", "eu5"];
    const clause = buildSearchClause(["a", "b", "c"], "army", params);
    expect(clause).toBe("(a LIKE $3 ESCAPE '\\' OR b LIKE $4 ESCAPE '\\' OR c LIKE $5 ESCAPE '\\')");
    expect(params).toEqual(["afrikaans", "eu5", "%army%", "%army%", "%army%"]);
  });

  it("uses GLOB without an ESCAPE for non-ASCII terms", () => {
    const params: (string | number)[] = ["x"];
    const clause = buildSearchClause(["a"], "ê", params);
    expect(clause).toBe("(a GLOB $2)");
    expect(params[1]).toBe("*[êÊ]*");
  });
});

describe("buildSearchPageQuery", () => {
  it("numbers every placeholder 1..n with a parameter for each, in order", () => {
    for (const term of ["army", "Östergötland"]) {
      const { sql, params } = buildSearchPageQuery("SELECT 1 FROM x WHERE a = $1 AND b = $2", term, "afrikaans", "eu5", 100, 200);
      const used = Array.from(sql.matchAll(/\$(\d+)/g)).map((m) => Number(m[1]));
      expect(Math.max(...used)).toBe(params.length);
      expect(new Set(used).size).toBe(params.length); // none skipped
      expect(params.slice(0, 2)).toEqual(["afrikaans", "eu5"]);
      expect(params.slice(-2)).toEqual([100, 200]);
      expect(sql).toMatch(/LIMIT \$\d+ OFFSET \$\d+$/);
    }
  });
});
