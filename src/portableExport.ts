import { writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
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
  format_version: 1;
  game_id: string;
  target_language: string;
  exported_at: string;
  translations: PortableTranslation[];
  glossary: PortableGlossaryTerm[];
}

export async function exportPortableProjectData(project: Project, destPath?: string): Promise<string> {
  const db = await getDb();

  const translations = (await db.select(
    `SELECT s.key as key, s.source_text as source_text, t.translated_text as translated_text,
            t.status as status, t.translated_by as translated_by, t.updated_at as updated_at
     FROM strings s
     JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id
     WHERE s.game_id = $1 AND t.target_language = $2
     ORDER BY s.key`,
    [project.game_id, project.target_language]
  )) as PortableTranslation[];

  const glossaryRows = (await db.select(
    `SELECT english_term, translated_term, game_id
     FROM glossary
     WHERE target_language = $1 AND (game_id = $2 OR game_id IS NULL)
     ORDER BY english_term`,
    [project.target_language, project.game_id]
  )) as { english_term: string; translated_term: string; game_id: string | null }[];

  const glossary: PortableGlossaryTerm[] = glossaryRows.map((g) => ({
    english_term: g.english_term,
    translated_term: g.translated_term,
    scope: g.game_id === null ? "shared" : "game-specific",
  }));

  const payload: PortableProjectExport = {
    format_version: 1,
    game_id: project.game_id,
    target_language: project.target_language,
    exported_at: new Date().toISOString(),
    translations,
    glossary,
  };

  let finalPath = destPath;
  if (!finalPath) {
    const dataDir = await appDataDir();
    const exportsDir = await join(dataDir, "exports");
    await mkdir(exportsDir, { recursive: true });
    finalPath = await join(exportsDir, `${project.game_id}-${project.target_language}-vertaal-export.json`);
  }

  await writeTextFile(finalPath, JSON.stringify(payload, null, 2));
  return finalPath;
}