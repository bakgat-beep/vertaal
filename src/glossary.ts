import { getDb } from "./db";

export interface GlossaryTerm {
  id: number;
  english_term: string;
  translated_term: string;
  game_id: string | null;
  target_language: string;
}

export async function addGlossaryTerm(
  englishTerm: string,
  translatedTerm: string,
  gameId: string | null,
  targetLanguage: string
) {
  const db = await getDb();
  await db.execute(
    "INSERT INTO glossary (english_term, translated_term, game_id, target_language) VALUES ($1, $2, $3, $4)",
    [englishTerm.trim(), translatedTerm.trim(), gameId, targetLanguage]
  );
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
  game_id: string | null;
  target_language: string;
}

export async function listGlossaryTerms(gameId: string, targetLanguage: string): Promise<GlossaryRow[]> {
  const db = await getDb();
  return (await db.select(
    `SELECT id, english_term, translated_term, game_id, target_language FROM glossary
     WHERE target_language = $1 AND (game_id = $2 OR game_id IS NULL)
     ORDER BY english_term`,
    [targetLanguage, gameId]
  )) as GlossaryRow[];
}

export async function updateGlossaryTerm(
  id: number,
  englishTerm: string,
  translatedTerm: string,
  gameId: string | null
) {
  const db = await getDb();
  await db.execute(
    "UPDATE glossary SET english_term = $1, translated_term = $2, game_id = $3 WHERE id = $4",
    [englishTerm.trim(), translatedTerm.trim(), gameId, id]
  );
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