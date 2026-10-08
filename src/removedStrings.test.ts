import { describe, it, expect } from "vitest";
import { SQL_UNTRANSLATED, SQL_DRAFT, SQL_CONFIRMED, SQL_OUTDATED, SQL_ISSUES, SQL_FLAGGED } from "./statusFilters";
import { SQL_EXPORTABLE } from "./export";

// A string that a game patch removed (strings.removed_at is set) must not be
// counted, listed under the work-to-do views, or written into the exported
// mod. These definitions are shared by the counts, the lists and the export,
// so checking that each one carries the condition covers all of them.
describe("strings removed from the game files", () => {
  const definitions: Record<string, string> = {
    SQL_UNTRANSLATED,
    SQL_DRAFT,
    SQL_CONFIRMED,
    SQL_OUTDATED,
    SQL_ISSUES,
    SQL_FLAGGED,
    SQL_EXPORTABLE,
  };
  for (const [name, sql] of Object.entries(definitions)) {
    it(`${name} leaves out removed strings`, () => {
      expect(sql).toContain("s.removed_at IS NULL");
    });
  }
});