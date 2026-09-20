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

// The one place that decides what a project's shareable JSON file is called,
// so "Export JSON", the automatic export, and Collaboration sync/pull can
// never disagree about the name.
export function portableExportFileName(project: { game_id: string; target_language: string }): string {
  return `${safeFileName(project.game_id)}-${safeFileName(project.target_language)}-vertaal-export.json`;
}