import { readTextFile } from "@tauri-apps/plugin-fs";
import { getDb } from "./db";
import type { Project } from "./types";

interface PortableTranslation {
  key: string;
  source_text: string;
  translated_text: string;
  status: string;
  translated_by: string | null;
  updated_at: string | null;
}
interface PortableGlossaryTerm {
  english_term: string;
  translated_term: string;
  scope: "shared" | "game-specific";
}
interface PortableProjectExport {
  format_version: number;
  game_id: string;
  target_language: string;
  exported_at: string;
  translations: PortableTranslation[];
  glossary: PortableGlossaryTerm[];
}

export interface MergeSummary {
  applied: number;
  skippedNoLocalString: number;
  skippedLocalNewer: number;
  glossaryAdded: number;
  glossaryUpdated: number;
}

// Merges an incoming portable export into the local database. Strategy:
// last-write-wins by timestamp, and a translation for a string you don't
// have locally (e.g. you haven't imported that game file yet) is skipped
// rather than guessed at. Every applied change is also logged to
// translation_history, so a merge is never destructive or silent.
export async function importPortableProjectData(project: Project, filePath: string): Promise<MergeSummary> {
  const raw = await readTextFile(filePath);
  const data = JSON.parse(raw) as PortableProjectExport;
  const db = await getDb();

  const summary: MergeSummary = {
    applied: 0,
    skippedNoLocalString: 0,
    skippedLocalNewer: 0,
    glossaryAdded: 0,
    glossaryUpdated: 0,
  };

  for (const t of data.translations) {
    const localString = (await db.select("SELECT key FROM strings WHERE key = $1 AND game_id = $2", [
      t.key,
      project.game_id,
    ])) as { key: string }[];
    if (localString.length === 0) {
      summary.skippedNoLocalString++;
      continue;
    }

    const localTranslation = (await db.select(
      "SELECT translated_text, updated_at FROM translations WHERE string_key = $1 AND game_id = $2 AND target_language = $3",
      [t.key, project.game_id, project.target_language]
    )) as { translated_text: string; updated_at: string | null }[];
    const local = localTranslation[0];

    if (local?.updated_at && t.updated_at && local.updated_at >= t.updated_at) {
      summary.skippedLocalNewer++;
      continue;
    }

    await db.execute(
      `INSERT OR REPLACE INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, flagged)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE((SELECT flagged FROM translations WHERE string_key = $1 AND game_id = $2 AND target_language = $3), 0))`,
      [t.key, project.game_id, project.target_language, t.translated_text, t.status, t.translated_by, t.updated_at ?? new Date().toISOString()]
    );

    await db.execute(
      `INSERT INTO translation_history (string_key, game_id, target_language, old_text, new_text, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [t.key, project.game_id, project.target_language, local?.translated_text ?? "", t.translated_text, t.translated_by ?? "merged from collaborator"]
    );

    summary.applied++;
  }

  for (const g of data.glossary) {
    const scopeGameId = g.scope === "shared" ? null : project.game_id;
    const existing = scopeGameId === null
      ? ((await db.select(
          "SELECT id, translated_term FROM glossary WHERE english_term = $1 AND target_language = $2 AND game_id IS NULL",
          [g.english_term, project.target_language]
        )) as { id: number; translated_term: string }[])
      : ((await db.select(
          "SELECT id, translated_term FROM glossary WHERE english_term = $1 AND target_language = $2 AND game_id = $3",
          [g.english_term, project.target_language, scopeGameId]
        )) as { id: number; translated_term: string }[]);

    if (existing.length > 0) {
      if (existing[0].translated_term !== g.translated_term) {
        await db.execute("UPDATE glossary SET translated_term = $1 WHERE id = $2", [g.translated_term, existing[0].id]);
        summary.glossaryUpdated++;
      }
    } else {
      await db.execute(
        "INSERT INTO glossary (english_term, translated_term, game_id, target_language) VALUES ($1, $2, $3, $4)",
        [g.english_term, g.translated_term, scopeGameId, project.target_language]
      );
      summary.glossaryAdded++;
    }
  }

  return summary;
}