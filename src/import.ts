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