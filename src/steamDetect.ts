import { readTextFile, readDir } from "@tauri-apps/plugin-fs";

const DEFAULT_STEAM_ROOTS = ["C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"];

async function pathExists(path: string): Promise<boolean> {
  try {
    await readDir(path);
    return true;
  } catch {
    return false;
  }
}

async function getSteamLibraryPaths(steamRoot: string): Promise<string[]> {
  try {
    const raw = await readTextFile(`${steamRoot}\\steamapps\\libraryfolders.vdf`);
    const matches = [...raw.matchAll(/"path"\s*"([^"]+)"/g)];
    return matches.map((m) => m[1].replace(/\\\\/g, "\\"));
  } catch {
    return [];
  }
}

export async function detectSteamGameFolder(folderName: string): Promise<string | null> {
  for (const steamRoot of DEFAULT_STEAM_ROOTS) {
    if (!(await pathExists(steamRoot))) continue;
    const libraries = [steamRoot, ...(await getSteamLibraryPaths(steamRoot))];
    for (const lib of libraries) {
      const candidate = `${lib}\\steamapps\\common\\${folderName}`;
      if (await pathExists(candidate)) return candidate;
    }
  }
  return null;
}