// Makes a piece of text safe to use as (part of) a file name on Windows.
//
// Why: mod projects have an internal id like "eu5:mod:my-mod", and Windows does
// not allow a colon in a file name (it treats "name:something" as a hidden
// "alternate data stream" attached to another file). Exporting or syncing a
// mod project therefore couldn't write its JSON file properly. Ordinary
// project ids like "eu5" have no such characters and come out unchanged, so
// existing export files keep their current names.
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, ""); // Windows also dislikes names ending in a dot or space
  return cleaned === "" ? "export" : cleaned;
}

// Turns a contributor's display name into the piece of a file name that
// identifies them, e.g. "Michi van Wyk" -> "michi-van-wyk".
export function contributorSlug(contributorName: string): string {
  return safeFileName(contributorName.toLowerCase().replace(/\s+/g, "-"));
}

// The one place that decides what a project's shareable JSON file is called,
// so "Export JSON", the automatic export, and Collaboration sync/pull can
// never disagree about the name.
//
// A contributor name, when given, becomes part of the file name — this is
// what lets two collaborators sync to the same shared folder without ever
// touching each other's file: everyone reads every contributor's file, but
// each person only ever WRITES their own. Omitting it (as the standalone
// "Save translations to a file" feature does) keeps the original shared,
// no-contributor name, unchanged from before.
export function portableExportFileName(
  project: { game_id: string; target_language: string },
  contributorName?: string | null
): string {
  const base = `${safeFileName(project.game_id)}-${safeFileName(project.target_language)}`;
  if (!contributorName || !contributorName.trim()) return `${base}-vertaal-export.json`;
  return `${base}-${contributorSlug(contributorName)}-vertaal-export.json`;
}

// Whether a file name is SOME contributor's shareable export for this exact
// project (any contributor, or the old shared no-contributor name from
// before per-contributor files existed) — used when scanning a synced folder
// for every file to merge in, not just one.
export function matchesProjectExportFile(
  fileName: string,
  project: { game_id: string; target_language: string }
): boolean {
  const prefix = `${safeFileName(project.game_id)}-${safeFileName(project.target_language)}`;
  return fileName.startsWith(prefix) && fileName.endsWith("-vertaal-export.json");
}

// The folder name for an exported mod, and the "id" field inside its
// metadata.json, both come from the mod's display name (e.g. "Grim: Dawn's
// Legacy?"). Lower-cased and space-separated first, in keeping with Vertaal's
// existing style, then made filesystem-safe the same way as any other
// generated file name.
export function modFolderName(modName: string): string {
  return safeFileName(modName.toLowerCase().replace(/\s+/g, "-"));
}