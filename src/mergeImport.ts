import { readTextFile } from "@tauri-apps/plugin-fs";
import { getDb } from "./db";
import type { Project } from "./types";
import { checkExportMatchesProject } from "./exportCheck";
import { baselineForImportedTranslation } from "./sourceChange";

interface PortableTranslation {
  key: string;
  source_text: string;
  translated_text: string;
  status: string;
  translated_by: string | null;
  updated_at: string | null;
  // Format 2+: the source text this translation was made against, present only
  // when it differs from source_text. See portableExport.ts.
  source_text_at_translation?: string | null;
  // Format 1 only (older Vertaal): the old length-plus-20-characters
  // fingerprint. Still read, so files from older versions keep working.
  source_text_hash?: string | null;
}
interface PortableGlossaryTerm {
  english_term: string;
  translated_term: string;
  scope: "shared" | "game-specific";
  // Absent in exports from older versions; when absent the existing value on
  // this machine is left alone (and a new term gets the defaults).
  notes?: string | null;
  status?: string;
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
  const parsed: unknown = JSON.parse(raw);

  // Refuse files that belong to a different game/mod or language, or that
  // aren't Vertaal exports at all — before touching anything.
  const problem = checkExportMatchesProject(parsed, project);
  if (problem) throw new Error(problem);

  const data = parsed as PortableProjectExport;
  const db = await getDb();

  const summary: MergeSummary = {
    applied: 0,
    skippedNoLocalString: 0,
    skippedLocalNewer: 0,
    glossaryAdded: 0,
    glossaryUpdated: 0,
  };

  for (const t of data.translations) {
    // An incoming row with no text (e.g. a placeholder that only carried a
    // flag) has nothing to merge, and must never blank out a translation
    // you already have.
    if ((t.translated_text ?? "").trim() === "") continue;

    const localString = (await db.select("SELECT key, source_text FROM strings WHERE key = $1 AND game_id = $2", [
      t.key,
      project.game_id,
    ])) as { key: string; source_text: string }[];
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

    // What the translation was made against (so a changed source is noticed).
    const baseline = baselineForImportedTranslation(t, localString[0].source_text, data.format_version ?? 1);

    await db.execute(
      `INSERT OR REPLACE INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, source_text_at_translation, flagged)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE((SELECT flagged FROM translations WHERE string_key = $1 AND game_id = $2 AND target_language = $3), 0))`,
      [
        t.key,
        project.game_id,
        project.target_language,
        t.translated_text,
        t.status,
        t.translated_by ?? null,
        t.updated_at ?? new Date().toISOString(),
        baseline,
      ]
    );

    await db.execute(
      `INSERT INTO translation_history (string_key, game_id, target_language, old_text, new_text, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [t.key, project.game_id, project.target_language, local?.translated_text ?? "", t.translated_text, t.translated_by ?? "merged from collaborator"]
    );

    summary.applied++;
  }

  for (const g of data.glossary ?? []) {
    const scopeGameId = g.scope === "shared" ? null : project.game_id;
    const incomingStatus = g.status === "preferred" || g.status === "review" ? g.status : undefined;
    const incomingNotes = g.notes === undefined ? undefined : (g.notes?.trim() || null);

    const existing = (await db.select(
      scopeGameId === null
        ? "SELECT id, translated_term, notes, status FROM glossary WHERE english_term = $1 AND target_language = $2 AND game_id IS NULL"
        : "SELECT id, translated_term, notes, status FROM glossary WHERE english_term = $1 AND target_language = $2 AND game_id = $3",
      scopeGameId === null
        ? [g.english_term, project.target_language]
        : [g.english_term, project.target_language, scopeGameId]
    )) as { id: number; translated_term: string; notes: string | null; status: string }[];

    if (existing.length > 0) {
      const current = existing[0];
      const changed =
        current.translated_term !== g.translated_term ||
        (incomingNotes !== undefined && incomingNotes !== current.notes) ||
        (incomingStatus !== undefined && incomingStatus !== current.status);
      if (changed) {
        await db.execute(
          "UPDATE glossary SET translated_term = $1, notes = $2, status = $3 WHERE id = $4",
          [
            g.translated_term,
            incomingNotes !== undefined ? incomingNotes : current.notes,
            incomingStatus ?? current.status,
            current.id,
          ]
        );
        summary.glossaryUpdated++;
      }
    } else {
      await db.execute(
        "INSERT INTO glossary (english_term, translated_term, game_id, target_language, notes, status) VALUES ($1, $2, $3, $4, $5, $6)",
        [g.english_term, g.translated_term, scopeGameId, project.target_language, incomingNotes ?? null, incomingStatus ?? "preferred"]
      );
      summary.glossaryAdded++;
    }
  }

  return summary;
}