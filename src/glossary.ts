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