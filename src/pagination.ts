import type { ViewMode } from "./App";
import { SQL_UNTRANSLATED, SQL_DRAFT, SQL_CONFIRMED, SQL_OUTDATED, SQL_ISSUES } from "./statusFilters";

// Why this file exists — the "shrinking list" problem:
//
// Some lists only contain strings in a certain state: Untranslated, Drafts,
// Patch Changed, Check for Issues, Flagged. As you work, strings LEAVE the list
// (confirm a string and it is no longer "untranslated"). The screen keeps
// showing the strings you just finished until the next reload, which is
// convenient — but the database no longer counts them. So "Next" (which used
// to jump ahead by exactly one page) skipped over a whole page of strings you
// hadn't seen yet.
//
// The fix: when going to the next page, only count the strings on the current
// page that are STILL in the list. Those are the only ones that still sit
// before the next page.

// The status buttons shown in a category ("Show: Untranslated / Drafts /
// Confirmed") turned into one database condition.
export function buildStatusClause(filter: Set<string>): string {
  const clauses: string[] = [];
  if (filter.has("untranslated")) clauses.push(SQL_UNTRANSLATED);
  if (filter.has("draft")) clauses.push(SQL_DRAFT);
  if (filter.has("human-confirmed")) clauses.push(SQL_CONFIRMED);
  if (clauses.length === 0) return "1=0";
  return `(${clauses.join(" OR ")})`;
}

// The database condition that decides whether a string is in this list, for the
// lists where strings can drop out while you work. Returns null for lists where
// nothing drops out (All strings, search results), where the plain
// "current position + one page" is already correct.
export function shrinkingViewClause(mode: ViewMode, statusFilter: Set<string>): string | null {
  switch (mode) {
    case "untranslated":
      return SQL_UNTRANSLATED;
    case "draft":
      return SQL_DRAFT;
    case "translated":
      return SQL_CONFIRMED;
    case "outdated":
      return SQL_OUTDATED;
    case "issues":
      return SQL_ISSUES;
    case "flagged":
      return "t.flagged = 1";
    case "category":
    case "subcategory":
      return buildStatusClause(statusFilter);
    default:
      return null;
  }
}

// Counts how many of the given strings (the ones on the current page) are still
// in the list. Parameters: $1 = target language, $2 = game id, $3... = the keys.
export function buildStillInViewSql(clause: string, keyCount: number): string {
  const placeholders = Array.from({ length: keyCount }, (_, i) => `$${i + 3}`).join(", ");
  return `SELECT COUNT(*) AS n
     FROM strings s
     LEFT JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id AND t.target_language = $1
     WHERE s.game_id = $2 AND ${clause} AND s.key IN (${placeholders})`;
}