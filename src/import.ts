import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import { getDb } from "./db";
import { parseLocFile } from "./parser";
import type { Project } from "./types";
import type { GameAdapter } from "./games/types";

export async function findLocFiles(dirPath: string, sourceLanguage: string): Promise<string[]> {
  const entries = await readDir(dirPath);
  entries.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  let found: string[] = [];
  for (const entry of entries) {
    const fullPath = await join(dirPath, entry.name ?? "");
    if (entry.isDirectory) {
      found = found.concat(await findLocFiles(fullPath, sourceLanguage));
    } else if (entry.name?.endsWith(`_l_${sourceLanguage}.yml`)) {
      found.push(fullPath);
    }
  }
  return found;
}

export async function validateInstallPath(dirPath: string, sourceLanguage: string): Promise<boolean> {
  try {
    const files = await findLocFiles(dirPath, sourceLanguage);
    return files.length > 0;
  } catch {
    return false;
  }
}

export function extractModCategory(fullPath: string): string {
  const marker = /\\locali[sz]ation\\/i;
  const match = fullPath.match(marker);
  if (!match) return "general";
  const idx = fullPath.search(marker);
  const afterLoc = fullPath.substring(idx + match[0].length);
  const parts = afterLoc.split("\\"); // [<lang>, ...subfolders?, filename]
  if (parts.length > 2) return parts[1];
  const fileName = parts[parts.length - 1];
  const stripped = fileName.replace(/_l_[a-z_]+\.yml$/i, "").replace(/_/g, " ");
  return stripped || "general";
}

export function extractModSubcategory(fullPath: string): string {
  const marker = /\\locali[sz]ation\\/i;
  const match = fullPath.match(marker);
  if (!match) return "general";
  const idx = fullPath.search(marker);
  const afterLoc = fullPath.substring(idx + match[0].length);
  const parts = afterLoc.split("\\");
  if (parts.length > 3) return parts[2];
  return "general";
}

export function findModLocRelativeParts(fullPath: string): string[] | null {
  const marker = /\\(locali[sz]ation)\\/i;
  const match = fullPath.match(marker);
  if (!match) return null;
  const idx = fullPath.search(marker);
  return fullPath.substring(idx + 1).split("\\");
}

export type ImportOutcome =
  | {
      status: "ok";
      filesProcessed: number;
      stringsProcessed: number;
      newStrings: number;
      changedStrings: number;
      unchangedStrings: number;
      // A string whose file WAS rescanned this run, but the key no longer
      // appears in it — most often because a game patch removed it. A key in
      // a file the user didn't happen to include this time (they picked a
      // narrower folder than last time) is never counted here — only files
      // actually read this run are judged.
      removedStrings: number;
      // A string previously marked removed that has reappeared (a patch
      // added it back, or the earlier import was of a narrower folder).
      reappearedStrings: number;
    }
  | { status: "cancelled" }
  | { status: "no-files-found" }
  | { status: "error"; error: string };

export async function importProjectFolder(
  currentProject: Project,
  gm: GameAdapter,
  onStatus: (msg: string) => void
): Promise<ImportOutcome> {
  const isMod = currentProject.project_type === "mod";
  onStatus("Waiting for folder selection...");
  const folderPath = await open({
    directory: true,
    multiple: false,
    defaultPath: currentProject.install_path ?? undefined,
  });
  if (!folderPath) {
    return { status: "cancelled" };
  }

  onStatus("Scanning folder for localization files... (please wait!)");
  const files = await findLocFiles(folderPath as string, currentProject.source_language);
  if (files.length === 0) {
    return { status: "no-files-found" };
  }

  try {
    const db = await getDb();
    const gamesDisplayName = isMod ? `${gm.displayName} — ${currentProject.source_mod_name ?? "Mod"}` : gm.displayName;
    await db.execute("INSERT OR REPLACE INTO games (game_id, display_name, detected_version) VALUES ($1, $2, $3)", [
      currentProject.game_id,
      gamesDisplayName,
      "1.0",
    ]);

    // Loaded once, up front, so each string can be classified as new /
    // changed / unchanged, and so a string that disappears from a file we DID
    // rescan can be told apart from one that's simply outside the folder
    // chosen this time (which must be left alone — see removedStrings above).
    const existingRows = (await db.select("SELECT key, source_text, file_path, removed_at FROM strings WHERE game_id = $1", [
      currentProject.game_id,
    ])) as { key: string; source_text: string; file_path: string; removed_at: string | null }[];
    const existingByKey = new Map(existingRows.map((r) => [r.key, r]));
    const scannedFilePaths = new Set(files);
    const seenThisRun = new Set<string>();

    let totalStrings = 0;
    let newStrings = 0;
    let changedStrings = 0;
    let unchangedStrings = 0;
    let reappearedStrings = 0;

    for (const filePath of files) {
      onStatus(`Reading ${filePath}...`);
      const content = await readTextFile(filePath);
      const parsed = parseLocFile(content);
      const fileName = filePath.split("\\").pop() ?? filePath;
      const contextLabel = fileName.replace(`_l_${currentProject.source_language}.yml`, "").replace(/_/g, " ");
      const category = isMod ? extractModCategory(filePath) : gm.extractCategory(filePath);
      const subcategory = isMod ? extractModSubcategory(filePath) : gm.extractSubcategory(filePath);
      for (const item of parsed) {
        seenThisRun.add(item.key);
        const existing = existingByKey.get(item.key);
        const hash = String(item.text.length) + "-" + item.text.slice(0, 20);
        await db.execute(
          // An "upsert" (update the row if it exists) rather than INSERT OR REPLACE
          // (delete it and add a new one): the database notices a changed
          // source text on an UPDATE and records the old wording against the
          // translations made with it. See migration 0020. removed_at is
          // always cleared here — being found in this scan, by definition,
          // means it's present.
          `INSERT INTO strings (key, game_id, source_text, source_text_hash, file_path, context_label, category, subcategory, removed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
           ON CONFLICT(key, game_id) DO UPDATE SET
             source_text = excluded.source_text,
             source_text_hash = excluded.source_text_hash,
             file_path = excluded.file_path,
             context_label = excluded.context_label,
             category = excluded.category,
             subcategory = excluded.subcategory,
             removed_at = NULL`,
          [item.key, currentProject.game_id, item.text, hash, filePath, contextLabel, category, subcategory]
        );

        if (!existing) newStrings++;
        else if (existing.source_text !== item.text) changedStrings++;
        else {
          unchangedStrings++;
          if (existing.removed_at) reappearedStrings++;
        }
        totalStrings++;
      }
    }

    let removedStrings = 0;
    for (const row of existingRows) {
      if (scannedFilePaths.has(row.file_path) && !seenThisRun.has(row.key) && !row.removed_at) {
        await db.execute("UPDATE strings SET removed_at = datetime('now') WHERE key = $1 AND game_id = $2", [
          row.key,
          currentProject.game_id,
        ]);
        removedStrings++;
      }
    }

    return {
      status: "ok",
      filesProcessed: files.length,
      stringsProcessed: totalStrings,
      newStrings,
      changedStrings,
      unchangedStrings,
      removedStrings,
      reappearedStrings,
    };
  } catch (err) {
    return { status: "error", error: String(err) };
  }
}