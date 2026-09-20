// Checks that a Vertaal export file really belongs to the project it is being
// imported into, BEFORE anything is changed. Without this, importing (say) an
// Afrikaans export into a Dutch project, or another game's file, would quietly
// merge the wrong text into your translations.
//
// Returns null when everything is fine, or a plain-English reason when not.
// 2 = translations carry the exact source text they were made against (1 carried
// a short fingerprint). This version reads both, and writes 2.
export const SUPPORTED_EXPORT_FORMAT_VERSION = 2;

export function checkExportMatchesProject(
  data: unknown,
  project: { game_id: string; target_language: string }
): string | null {
  if (typeof data !== "object" || data === null) {
    return "This doesn't look like a Vertaal export file.";
  }
  const d = data as Record<string, unknown>;

  if (!Array.isArray(d.translations) || typeof d.game_id !== "string" || typeof d.target_language !== "string") {
    return "This doesn't look like a Vertaal export file (it's missing the expected fields).";
  }
  if (d.glossary !== undefined && !Array.isArray(d.glossary)) {
    return "This doesn't look like a Vertaal export file (its glossary section is damaged).";
  }
  if (typeof d.format_version === "number" && d.format_version > SUPPORTED_EXPORT_FORMAT_VERSION) {
    return "This file was made by a newer version of Vertaal. Please update Vertaal, then try again.";
  }
  if (d.game_id !== project.game_id) {
    return `This file is for "${d.game_id}", but this project is "${project.game_id}". Nothing was imported.`;
  }
  if (d.target_language.toLowerCase() !== project.target_language.toLowerCase()) {
    return `This file is a ${d.target_language} translation, but this project translates into ${project.target_language}. Nothing was imported.`;
  }
  return null;
}