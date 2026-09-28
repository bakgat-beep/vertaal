import { readTextFile, writeTextFile, remove, mkdir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

// Every export writes a manifest listing the localisation files it wrote,
// relative to the mod's folder. The NEXT export reads it and deletes any
// listed file that this run did NOT write again — otherwise, if a string is
// unflagged, unconfirmed, or reverted so a file it used to be in now has no
// exportable strings, that file's stale (and possibly wrong) content would
// stay on disk forever, since nothing had ever written over it since.
const MANIFEST_RELATIVE_PATH = [".metadata", "vertaal-export-manifest.json"];

export async function readExportManifest(modRoot: string): Promise<string[]> {
  try {
    const raw = await readTextFile(await join(modRoot, ...MANIFEST_RELATIVE_PATH));
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    // No manifest yet (first export of this mod, or an older Vertaal export
    // that predates this feature) — there is nothing to clean up.
    return [];
  }
}

export async function writeExportManifest(modRoot: string, relPaths: string[]): Promise<void> {
  await mkdir(await join(modRoot, ".metadata"), { recursive: true });
  await writeTextFile(await join(modRoot, ...MANIFEST_RELATIVE_PATH), JSON.stringify(relPaths, null, 2));
}

// Which files the PREVIOUS export wrote that this run is not writing again.
export function computeStaleRelPaths(previousManifest: string[], currentRelPaths: string[]): string[] {
  const current = new Set(currentRelPaths);
  return previousManifest.filter((p) => !current.has(p));
}

// Deletes exactly the files the previous export wrote that this run isn't
// writing again. Best-effort: a file that is already gone (the user removed
// it, or a folder was cleared) is not an error.
export async function removeStaleFiles(modRoot: string, staleRelPaths: string[]): Promise<void> {
  for (const relPath of staleRelPaths) {
    try {
      await remove(await join(modRoot, relPath));
    } catch {
      // Already gone, or otherwise unremovable — nothing more useful to do.
    }
  }
}