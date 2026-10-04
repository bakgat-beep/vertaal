import { getDb } from "./db";

export interface HistoryEntry {
  id: number;
  old_text: string;
  new_text: string;
  changed_by: string | null;
  changed_at: string;
}

// Newest first. changed_at only has one-second resolution, so several changes
// within the same second (a quick edit then a revert, or a bulk action) tie;
// the id - which only ever grows - then puts the last one written first.
export async function loadHistory(key: string, gameId: string, targetLanguage: string): Promise<HistoryEntry[]> {
  const db = await getDb();
  return (await db.select(
    `SELECT id, old_text, new_text, changed_by, changed_at FROM translation_history
     WHERE string_key = $1 AND game_id = $2 AND target_language = $3
     ORDER BY changed_at DESC, id DESC`,
    [key, gameId, targetLanguage]
  )) as HistoryEntry[];
}