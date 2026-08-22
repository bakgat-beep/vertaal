import { readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

export async function findLocFiles(dirPath: string, sourceLanguage: string): Promise<string[]> {
  const entries = await readDir(dirPath);
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

// Cheap check for the welcome screen: does this folder (or something inside it)
// actually contain localisation files, before letting someone create a project on it.
export async function validateInstallPath(dirPath: string, sourceLanguage: string): Promise<boolean> {
  try {
    const files = await findLocFiles(dirPath, sourceLanguage);
    return files.length > 0;
  } catch {
    return false;
  }
}