import { getDb } from "./db";

export interface GlossaryTerm {
  id: number;
  english_term: string;
  translated_term: string;
  game_id: string | null;
  target_language: string;
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

export async function loadGlossaryTerms(gameId: string, targetLanguage: string): Promise<GlossaryTerm[]> {
  const db = await getDb();
  // Game-specific terms and shared (game_id IS NULL) terms both apply.
  return (await db.select(
    `SELECT id, english_term, translated_term, game_id, target_language FROM glossary
     WHERE target_language = $1 AND (game_id = $2 OR game_id IS NULL)`,
    [targetLanguage, gameId]
  )) as GlossaryTerm[];
}

// Game-specific terms override shared ones for the same English word, and
// longer matched phrases win over shorter ones they contain (e.g. "peace
// treaty" wins over "peace" when both would otherwise match).
export function matchGlossaryTerms(sourceText: string, terms: GlossaryTerm[]): GlossaryTerm[] {
  const lowerSource = sourceText.toLowerCase();

  const byTerm = new Map<string, GlossaryTerm>();
  for (const t of terms) {
    const key = t.english_term.toLowerCase();
    const existing = byTerm.get(key);
    if (!existing || (t.game_id !== null && existing.game_id === null)) {
      byTerm.set(key, t);
    }
  }
  const deduped = Array.from(byTerm.values());

  const matched = deduped.filter((t) => lowerSource.includes(t.english_term.toLowerCase()));

  return matched.filter(
    (t) =>
      !matched.some(
        (other) =>
          other.english_term !== t.english_term &&
          other.english_term.toLowerCase().includes(t.english_term.toLowerCase())
      )
  );
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

// How many of this game's source strings actually contain the term — the
// "N strings" usage count shown per glossary row. Deliberately checks only
// the source text (not translated_text): a glossary term is a source-
// language word, so "usage" means how often it appears in the English
// strings, not the target-language output.
export async function countGlossaryTermUsage(gameId: string, englishTerm: string): Promise<number> {
  const db = await getDb();
  const result = (await db.select("SELECT COUNT(*) as count FROM strings WHERE game_id = $1 AND source_text LIKE $2", [
    gameId,
    `%${englishTerm}%`,
  ])) as { count: number }[];
  return result[0]?.count ?? 0;
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
  return matchedTerms.map((t) => {
    const regex = new RegExp(escapeRegExp(t.english_term), "i");
    const match = sourceText.match(regex);
    const occurrence = match ? match[0] : t.english_term;
    const adjusted = matchCase(occurrence, t.translated_term);
    return `- "${occurrence}" must be translated as "${adjusted}"`;
  });
}