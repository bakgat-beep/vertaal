// The ONE place that defines what "untranslated", "draft" and "confirmed"
// mean in database terms. The sidebar counts, the status bar, the list views,
// the category counts and the category filter buttons all use these same
// pieces of text — so a number you see can never disagree with the list you
// get when you click it (which used to happen for typed-but-unconfirmed
// drafts).
//
// All of them expect a query that names the translations table `t` and the
// strings table `s` (a LEFT JOIN from strings to translations, so a string
// with no translation row at all still counts as untranslated).

// Nothing usable yet: no row at all, or a row that is just holding a flag.
export const SQL_UNTRANSLATED = "(t.status IS NULL OR t.status = 'untranslated')";

// Has text, but a person hasn't confirmed it: an AI suggestion OR something
// you typed yourself and haven't confirmed yet.
export const SQL_DRAFT = "t.status IN ('ai-suggested', 'human-draft')";

// Confirmed by a person.
export const SQL_CONFIRMED = "t.status = 'human-confirmed'";

// Translated against an EARLIER version of the source text ("Patch Changed").
// A translation stores the earlier wording only when the source has changed
// since (NULL = made against the current text — see migration 0020), and the
// string counts as changed while that stored text differs from the current
// source. Covers confirmed and draft translations alike; placeholder rows with
// no translation (status 'untranslated') never count. (Same rule as
// isSourceChanged in sourceChange.ts, which a test keeps in step with this.)
export const SQL_OUTDATED =
  "t.source_text_at_translation IS NOT NULL AND t.status != 'untranslated' AND t.source_text_at_translation != s.source_text";

// Marked as done/drafted but there is no actual text saved — except when the
// ORIGINAL is itself blank (empty, or only spaces / tabs / line breaks): such
// strings are supposed to be confirmed as they are (see isBlank in
// codeOnly.ts, which uses the same set of characters).
export const SQL_ISSUES =
  "t.status IN ('human-confirmed', 'ai-suggested', 'human-draft') AND (t.translated_text IS NULL OR TRIM(t.translated_text) = '') AND TRIM(s.source_text, ' ' || char(9) || char(10) || char(13)) != ''";