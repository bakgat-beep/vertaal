import { getDb } from "./db";
import { protectTokens } from "./parser";

export interface GlossaryTerm {
  id: number;
  english_term: string;
  translated_term: string;
  game_id: string | null;
  target_language: string;
  // Set by loadGlossaryTerms: which scope the term came from, so that when the
  // same English word exists in several places the most specific one wins.
  // 3 = this project's own (a mod's) terms, 2 = the base game's terms, 1 = shared.
  priority?: number;
}

// Shape passed to addGlossaryTerm/updateGlossaryTerm for the newer fields.
// Any field left out is simply not touched: on insert, SQLite's own column
// default applies (status defaults to 'preferred', notes to NULL); on
// update, the existing stored value is left exactly as it was — so old call
// sites that don't know about notes/status can't accidentally wipe or reset
// them.
export interface GlossaryTermExtra {
  notes?: string | null;
  status?: "preferred" | "review";
}

export async function addGlossaryTerm(
  englishTerm: string,
  translatedTerm: string,
  gameId: string | null,
  targetLanguage: string,
  extra: GlossaryTermExtra = {}
) {
  const db = await getDb();
  const columns = ["english_term", "translated_term", "game_id", "target_language"];
  const params: (string | number | null)[] = [englishTerm.trim(), translatedTerm.trim(), gameId, targetLanguage];

  if (extra.notes !== undefined) {
    columns.push("notes");
    params.push(extra.notes?.trim() || null);
  }
  if (extra.status !== undefined) {
    columns.push("status");
    params.push(extra.status);
  }

  const placeholders = params.map((_, i) => `$${i + 1}`).join(", ");
  await db.execute(`INSERT INTO glossary (${columns.join(", ")}) VALUES (${placeholders})`, params);
}

// Loads the terms the AI should actually be told about for a project:
//  - this project's own terms, plus shared ones (game_id NULL);
//  - for a MOD project, also the base game's terms (so the mod stays
//    consistent with a vanilla translation); the mod's own version of a term
//    wins if both exist;
//  - only terms marked "Preferred" — "Needs review" terms are not enforced;
//  - only terms that actually have a translation (an empty one would produce
//    the instruction 'must be translated as ""').
export async function loadGlossaryTerms(gameId: string, targetLanguage: string): Promise<GlossaryTerm[]> {
  const db = await getDb();

  const parentRows = (await db.select("SELECT parent_game_id FROM projects WHERE game_id = $1 LIMIT 1", [
    gameId,
  ])) as { parent_game_id: string | null }[];
  const parentId = parentRows[0]?.parent_game_id;
  const baseGameId = parentId && parentId !== gameId ? parentId : null;

  return (await db.select(
    `SELECT id, english_term, translated_term, game_id, target_language,
            CASE WHEN game_id = $2 THEN 3 WHEN game_id = $3 THEN 2 ELSE 1 END AS priority
     FROM glossary
     WHERE target_language = $1
       AND (game_id = $2 OR game_id IS NULL OR game_id = $3)
       AND status = 'preferred'
       AND TRIM(translated_term) != ''
       AND TRIM(english_term) != ''`,
    [targetLanguage, gameId, baseGameId]
  )) as GlossaryTerm[];
}

// ---- Matching ----
//
// A term matches only as a WHOLE WORD (or words), so "war" is found in "The
// war ended" and "Wars" but NOT inside "warrant" or "swarm". A plain English
// plural ending (-s / -es) is allowed. Text inside game code (icons like
// £gold£, variables like $GOLD$, [functions]) is ignored — those aren't words
// to translate. Letters from any language count as word characters, so
// "cafe" does not match inside "café".

const WORD_CHARS = "\\p{L}\\p{N}_";
const termPatternCache = new Map<string, { lower: string; regex: RegExp }>();

// One compiled pattern per term, reused (compiling thousands of patterns for
// every string in a big batch would be far too slow). NOTE: these patterns are
// shared, so only ever use them through matchAll (which works on a copy) —
// never .test() or .exec(), which would carry state from one string to the next.
function termPattern(term: string): { lower: string; regex: RegExp } {
  const trimmed = term.trim();
  const key = trimmed.toLowerCase();
  let entry = termPatternCache.get(key);
  if (!entry) {
    entry = {
      lower: key,
      regex: new RegExp(`(?<![${WORD_CHARS}])${escapeRegExp(trimmed)}(?:s|es)?(?![${WORD_CHARS}])`, "giu"),
    };
    termPatternCache.set(key, entry);
  }
  return entry;
}

// The source text with game code blanked out, leaving only translatable words.
function plainText(sourceText: string): string {
  return protectTokens(sourceText).text.replace(/__TOKEN_\d+__/g, " ");
}

// Every place the term appears as a whole word: [start, end) positions.
function findTermSpans(plain: string, term: string, lowerPlain: string = plain.toLowerCase()): [number, number][] {
  const { lower, regex } = termPattern(term);
  // Cheap check first — almost every term is absent from almost every string.
  if (!lowerPlain.includes(lower)) return [];
  return [...plain.matchAll(regex)].map((m) => [m.index!, m.index! + m[0].length] as [number, number]);
}

// The usable terms with duplicates resolved (most specific scope wins). A batch
// passes the same list for every string, so the result is remembered per list
// instead of being rebuilt thousands of times. (The list must not be edited
// after it's first used — loadGlossaryTerms always returns a fresh one.)
const usableTermsCache = new WeakMap<GlossaryTerm[], GlossaryTerm[]>();
function usableTerms(terms: GlossaryTerm[], rank: (t: GlossaryTerm) => number): GlossaryTerm[] {
  const cached = usableTermsCache.get(terms);
  if (cached) return cached;
  const byTerm = new Map<string, GlossaryTerm>();
  for (const t of terms) {
    if (!t.english_term.trim() || !t.translated_term.trim()) continue;
    const key = t.english_term.trim().toLowerCase();
    const existing = byTerm.get(key);
    if (!existing || rank(t) > rank(existing)) byTerm.set(key, t);
  }
  const result = Array.from(byTerm.values());
  usableTermsCache.set(terms, result);
  return result;
}

// Game-specific terms override shared ones for the same English word (and a
// mod's own term overrides the base game's), and longer matched phrases win
// over shorter ones they overlap (e.g. "peace treaty" wins over "peace" when
// both would otherwise match — but a separate, standalone "peace" elsewhere in
// the same string still counts).
export function matchGlossaryTerms(sourceText: string, terms: GlossaryTerm[]): GlossaryTerm[] {
  const plain = plainText(sourceText);
  const lowerPlain = plain.toLowerCase();
  const rank = (t: GlossaryTerm) => t.priority ?? (t.game_id === null ? 1 : 2);

  const hits = usableTerms(terms, rank)
    .map((t) => ({ term: t, spans: findTermSpans(plain, t.english_term, lowerPlain) }))
    .filter((h) => h.spans.length > 0);

  return hits
    .filter((h) =>
      h.spans.some(
        ([start, end]) =>
          !hits.some(
            (other) =>
              other !== h &&
              other.spans.some(([os, oe]) => os <= start && end <= oe && oe - os > end - start)
          )
      )
    )
    .map((h) => h.term);
}

export interface GlossaryRow {
  id: number;
  english_term: string;
  translated_term: string;
  notes: string | null;
  game_id: string | null;
  target_language: string;
  status: "preferred" | "review";
}

// The status actually shown to the user. An empty translation always reads
// as "untranslated" regardless of what's stored in the status column, so
// the two can never contradict each other — "untranslated" itself is never
// written to the database.
export function effectiveStatus(row: Pick<GlossaryRow, "translated_term" | "status">): "preferred" | "review" | "untranslated" {
  if (!row.translated_term.trim()) return "untranslated";
  return row.status;
}

export interface ListGlossaryTermsOptions {
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listGlossaryTerms(
  gameId: string,
  targetLanguage: string,
  options: ListGlossaryTermsOptions = {}
): Promise<GlossaryRow[]> {
  const db = await getDb();
  const { limit = 50, offset = 0 } = options;
  const trimmedSearch = options.search?.trim();

  const params: (string | number)[] = [targetLanguage, gameId];
  let searchClause = "";
  if (trimmedSearch) {
    params.push(`%${trimmedSearch}%`);
    searchClause = `AND (english_term LIKE $${params.length} OR translated_term LIKE $${params.length} OR notes LIKE $${params.length})`;
  }
  params.push(limit, offset);
  const limitIndex = params.length - 1;
  const offsetIndex = params.length;

  return (await db.select(
    `SELECT id, english_term, translated_term, notes, game_id, target_language, status FROM glossary
     WHERE target_language = $1 AND (game_id = $2 OR game_id IS NULL) ${searchClause}
     ORDER BY english_term
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    params
  )) as GlossaryRow[];
}

// Total count for the same filters listGlossaryTerms uses — needed to drive
// "Showing X–Y of N" and to know whether the Next page button should be
// enabled, without pulling every row back just to count them.
export async function countGlossaryTerms(gameId: string, targetLanguage: string, search?: string): Promise<number> {
  const db = await getDb();
  const trimmedSearch = search?.trim();
  const params: (string | number)[] = [targetLanguage, gameId];
  let searchClause = "";
  if (trimmedSearch) {
    params.push(`%${trimmedSearch}%`);
    searchClause = `AND (english_term LIKE $${params.length} OR translated_term LIKE $${params.length} OR notes LIKE $${params.length})`;
  }
  const result = (await db.select(
    `SELECT COUNT(*) as count FROM glossary WHERE target_language = $1 AND (game_id = $2 OR game_id IS NULL) ${searchClause}`,
    params
  )) as { count: number }[];
  return result[0]?.count ?? 0;
}

// How many of this game's source strings contain the term — the "N strings"
// usage count shown per glossary row. Counted the same way the translator
// matches terms (whole words, ignoring game code), so the number reflects
// where the term will really be applied. Deliberately checks only the source
// text: a glossary term is a source-language word.
export async function countGlossaryTermUsage(gameId: string, englishTerm: string): Promise<number> {
  const term = englishTerm.trim();
  if (!term) return 0;
  const db = await getDb();
  // The database narrows it down quickly (any string containing the letters);
  // the exact whole-word check then runs on just those candidates.
  const candidates = (await db.select(
    "SELECT source_text FROM strings WHERE game_id = $1 AND source_text LIKE $2 ESCAPE '\\' LIMIT 50000",
    [gameId, `%${term.replace(/[\\%_]/g, "\\$&")}%`]
  )) as { source_text: string }[];
  return candidates.filter((c) => findTermSpans(plainText(c.source_text), term).length > 0).length;
}

export async function updateGlossaryTerm(
  id: number,
  englishTerm: string,
  translatedTerm: string,
  gameId: string | null,
  extra: GlossaryTermExtra = {}
) {
  const db = await getDb();
  const setClauses = ["english_term = $1", "translated_term = $2", "game_id = $3"];
  const params: (string | number | null)[] = [englishTerm.trim(), translatedTerm.trim(), gameId];

  if (extra.notes !== undefined) {
    params.push(extra.notes?.trim() || null);
    setClauses.push(`notes = $${params.length}`);
  }
  if (extra.status !== undefined) {
    params.push(extra.status);
    setClauses.push(`status = $${params.length}`);
  }

  params.push(id);
  await db.execute(`UPDATE glossary SET ${setClauses.join(", ")} WHERE id = $${params.length}`, params);
}

export async function deleteGlossaryTerm(id: number) {
  const db = await getDb();
  await db.execute("DELETE FROM glossary WHERE id = $1", [id]);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchCase(sourceOccurrence: string, translated: string): string {
  if (!sourceOccurrence || !translated) return translated;
  const firstChar = sourceOccurrence[0];
  const isUpper = firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase();
  return isUpper
    ? translated.charAt(0).toUpperCase() + translated.slice(1)
    : translated.charAt(0).toLowerCase() + translated.slice(1);
}

export function buildGlossaryInstructions(sourceText: string, matchedTerms: GlossaryTerm[]): string[] {
  const plain = plainText(sourceText);
  return matchedTerms.map((t) => {
    const spans = findTermSpans(plain, t.english_term);
    const occurrence = spans.length > 0 ? plain.slice(spans[0][0], spans[0][1]) : t.english_term;
    const adjusted = matchCase(occurrence, t.translated_term);
    return `- "${occurrence}" must be translated as "${adjusted}"`;
  });
}