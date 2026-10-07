import { describe, it, expect } from "vitest";
import { shrinkingViewClause, buildStatusClause, buildStillInViewSql } from "./pagination";
import { SQL_UNTRANSLATED, SQL_DRAFT, SQL_CONFIRMED, SQL_OUTDATED, SQL_ISSUES, SQL_FLAGGED } from "./statusFilters";

const ALL = new Set(["untranslated", "draft", "human-confirmed"]);

describe("shrinkingViewClause", () => {
  it("uses the same definition as the list itself for each list that shrinks", () => {
    expect(shrinkingViewClause("untranslated", ALL)).toBe(SQL_UNTRANSLATED);
    expect(shrinkingViewClause("draft", ALL)).toBe(SQL_DRAFT);
    expect(shrinkingViewClause("translated", ALL)).toBe(SQL_CONFIRMED);
    expect(shrinkingViewClause("outdated", ALL)).toBe(SQL_OUTDATED);
    expect(shrinkingViewClause("issues", ALL)).toBe(SQL_ISSUES);
    expect(shrinkingViewClause("flagged", ALL)).toBe(SQL_FLAGGED);
  });

  it("returns null for lists where nothing drops out", () => {
    expect(shrinkingViewClause("all", ALL)).toBeNull();
    expect(shrinkingViewClause("search", ALL)).toBeNull();
  });

  it("follows the Show: buttons in a category or subcategory", () => {
    const onlyUntranslated = new Set(["untranslated"]);
    expect(shrinkingViewClause("category", onlyUntranslated)).toBe(`(${SQL_UNTRANSLATED})`);
    expect(shrinkingViewClause("subcategory", onlyUntranslated)).toBe(`(${SQL_UNTRANSLATED})`);
  });
});

describe("buildStatusClause", () => {
  it("combines the chosen buckets with OR", () => {
    expect(buildStatusClause(new Set(["draft", "human-confirmed"]))).toBe(`(${SQL_DRAFT} OR ${SQL_CONFIRMED})`);
  });

  it("matches nothing when no bucket is chosen", () => {
    expect(buildStatusClause(new Set())).toBe("1=0");
  });
});

describe("buildStillInViewSql", () => {
  it("has one placeholder per key, numbered after the language and game", () => {
    const sql = buildStillInViewSql("t.flagged = 1", 3);
    expect(sql).toContain("s.key IN ($3, $4, $5)");
    expect(sql).toContain("t.flagged = 1");
  });
});