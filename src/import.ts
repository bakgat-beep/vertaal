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
  | { status: "ok"; filesProcessed: number; stringsProcessed: number }
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

    let totalStrings = 0;
    for (const filePath of files) {
      onStatus(`Reading ${filePath}...`);
      const content = await readTextFile(filePath);
      const parsed = parseLocFile(content);
      const fileName = filePath.split("\\").pop() ?? filePath;
      const contextLabel = fileName.replace(`_l_${currentProject.source_language}.yml`, "").replace(/_/g, " ");
      const category = isMod ? extractModCategory(filePath) : gm.extractCategory(filePath);
      const subcategory = isMod ? extractModSubcategory(filePath) : gm.extractSubcategory(filePath);
      for (const item of parsed) {
        const hash = String(item.text.length) + "-" + item.text.slice(0, 20);
        await db.execute(
          `INSERT OR REPLACE INTO strings (key, game_id, source_text, source_text_hash, file_path, context_label, category, subcategory)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [item.key, currentProject.game_id, item.text, hash, filePath, contextLabel, category, subcategory]
        );
        totalStrings++;
      }
    }

    return { status: "ok", filesProcessed: files.length, stringsProcessed: totalStrings };
  } catch (err) {
    return { status: "error", error: String(err) };
  }
}