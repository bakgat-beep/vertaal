import { protectTokens } from "./parser";

// "Blank" = nothing there at all: empty, or only spaces, tabs and line breaks.
// (Deliberately limited to those few characters so this exact rule can also be
// written in SQL — see SQL_ISSUES in statusFilters.ts.)
export function isBlank(sourceText: string): boolean {
  return /^[ \t\r\n]*$/.test(sourceText);
}

// True when a string is made up ENTIRELY of game code — icons, variables,
// [functions], colour codes — with no actual words to translate, e.g.
// "$COUNT$" or "[GetName]£gold£". A blank string is not "code-only" (it has no
// code either); see isBlank.
export function isCodeOnly(sourceText: string): boolean {
  if (isBlank(sourceText)) return false;
  const { text } = protectTokens(sourceText);
  return text.replace(/__TOKEN_\d+__/g, "").trim() === "";
}

// Either of the above: there is nothing here for a translator (human or AI) to
// translate. AI batches skip these strings.
export function needsNoTranslation(sourceText: string): boolean {
  return isBlank(sourceText) || isCodeOnly(sourceText);
}

// A string row as read for the "confirm as they are" actions.
export interface AsIsCandidate {
  source_text: string;
  status: string | null;
  translated_text: string | null;
  translated_by: string | null;
}

// Whether the "Confirm code-only / blank strings" actions should confirm this
// string. It must qualify (code-only, or blank) AND either have no translation
// yet or hold only a copy of the source — such as an AI-draft copy left by an
// earlier version of that action. Text a person typed (a human draft) or an
// AI draft that differs from the source is never replaced. (Flagged and
// already-confirmed strings are filtered out by the database query.)
export function shouldConfirmAsIs(c: AsIsCandidate, qualifies: (sourceText: string) => boolean): boolean {
  if (!qualifies(c.source_text)) return false;
  if (c.status === null || c.status === "untranslated") return true;
  if (c.status !== "ai-suggested") return false;
  return c.translated_text === c.source_text || (c.translated_by ?? "").startsWith("auto (");
}