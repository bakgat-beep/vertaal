import { getDb } from "./db";

// Shared by every query in this file: a row is eligible only if it hasn't
// been touched by a human yet (no human-draft/human-confirmed translation
// on record) and isn't flagged. Matches the same "untouched" definition
// used by the other bulk-confirm actions elsewhere in the app (Confirm
// Blank Source, Auto-Confirm Code) — a row a human already saved anything
// to, or already confirmed, is never a candidate here.
const UNTOUCHED_UNFLAGGED_JOIN = `
  LEFT JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id AND t.target_language = $2
  WHERE s.game_id = $1
    AND (t.status IS NULL OR t.status = 'untranslated')
    AND (t.flagged IS NULL OR t.flagged = 0)
`;

export interface SourceFileOption {
  file_path: string;
  context_label: string | null;
  count: number;
}

// Lists every distinct source file for this game/language that still has
// at least one untouched, unflagged string, with a friendly label
// (context_label, e.g. "character names") and a count — for the file
// checklist in the selector panel. Files with zero eligible strings left
// don't show up, since there'd be nothing left to select there anyway.
export async function listSourceFileOptions(gameId: string, targetLanguage: string): Promise<SourceFileOption[]> {
  const db = await getDb();
  return (await db.select(
    `SELECT s.file_path as file_path, MIN(s.context_label) as context_label, COUNT(*) as count
     FROM strings s
     ${UNTOUCHED_UNFLAGGED_JOIN}
       AND s.file_path IS NOT NULL
     GROUP BY s.file_path
     ORDER BY s.file_path`,
    [gameId, targetLanguage]
  )) as SourceFileOption[];
}

// Splits a comma-separated text box into individual, trimmed, non-empty
// substrings — e.g. "character_name_, location_name_" becomes two
// patterns. Used both for the live preview count and the actual bulk
// confirm, so both always agree on exactly what "the pattern" means.
export function splitKeyPatterns(raw: string): string[] {
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// Builds the "(key matches...) OR (file matches...)" clause shared by the
// preview count and the actual confirm below, appending its placeholders
// to params as it goes. Both callers build their own params array starting
// with [gameId, targetLanguage] (for UNTOUCHED_UNFLAGGED_JOIN's $1/$2), so
// this always appends from $3 onward. Returns null if both selectors are
// empty — callers treat that as "nothing to match," not "match everything."
function buildMatchClause(
  params: (string | number)[],
  keyPatterns: string[],
  selectedFiles: string[]
): string | null {
  if (keyPatterns.length === 0 && selectedFiles.length === 0) return null;
  const matchClauses: string[] = [];

  if (keyPatterns.length > 0) {
    const keyClauses = keyPatterns.map((p) => {
      params.push(`%${p}%`);
      return `s.key LIKE $${params.length}`;
    });
    matchClauses.push(`(${keyClauses.join(" OR ")})`);
  }

  if (selectedFiles.length > 0) {
    const fileClauses = selectedFiles.map((f) => {
      params.push(f);
      return `s.file_path = $${params.length}`;
    });
    matchClauses.push(`(${fileClauses.join(" OR ")})`);
  }

  return matchClauses.join(" OR ");
}

// Counts untouched, unflagged strings that match ANY of the given key
// substrings OR belong to ANY of the given files. Returns 0 if both
// selectors are empty, rather than matching everything — an empty
// selection should never silently mean "everything."
export async function countNameConfirmMatches(
  gameId: string,
  targetLanguage: string,
  keyPatterns: string[],
  selectedFiles: string[]
): Promise<number> {
  const params: (string | number)[] = [gameId, targetLanguage];
  const clause = buildMatchClause(params, keyPatterns, selectedFiles);
  if (clause === null) return 0;

  const db = await getDb();
  const result = (await db.select(
    `SELECT COUNT(*) as count
     FROM strings s
     ${UNTOUCHED_UNFLAGGED_JOIN}
       AND (${clause})`,
    params
  )) as { count: number }[];
  return result[0]?.count ?? 0;
}

// Confirms every untouched, unflagged string matching the same key/file
// selection countNameConfirmMatches just previewed — translated_text is
// set to source_text verbatim (never altered) and status becomes
// 'human-confirmed'. Returns how many rows were confirmed, so the caller
// can report it without a second count query. Returns 0 (no writes) if
// both selectors are empty.
export async function confirmNameMatches(
  gameId: string,
  targetLanguage: string,
  keyPatterns: string[],
  selectedFiles: string[],
  translatedBy: string | null
): Promise<number> {
  const params: (string | number)[] = [gameId, targetLanguage];
  const clause = buildMatchClause(params, keyPatterns, selectedFiles);
  if (clause === null) return 0;

  const db = await getDb();
  const matches = (await db.select(
    `SELECT s.key as key, s.source_text as source_text, s.source_text_hash as source_text_hash
     FROM strings s
     ${UNTOUCHED_UNFLAGGED_JOIN}
       AND (${clause})`,
    params
  )) as { key: string; source_text: string; source_text_hash: string }[];

  for (const m of matches) {
    await db.execute(
      `INSERT OR REPLACE INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, flagged, source_hash_at_translation)
       VALUES ($1, $2, $3, $4, 'human-confirmed', $5, datetime('now'), COALESCE((SELECT flagged FROM translations WHERE string_key = $6 AND game_id = $7 AND target_language = $8), 0), $9)`,
      [m.key, gameId, targetLanguage, m.source_text, translatedBy, m.key, gameId, targetLanguage, m.source_text_hash]
    );
  }

  return matches.length;
}