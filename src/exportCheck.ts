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
  return checkRecordsAreWellFormed(d);
}

const KNOWN_STATUSES = new Set(["untranslated", "ai-suggested", "human-draft", "human-confirmed"]);

function isTextOrMissing(v: unknown): boolean {
  return v === undefined || v === null || typeof v === "string";
}

// Looks at EVERY translation and glossary record before anything is merged, so
// one damaged record (a missing key, text that isn't text, an unknown status)
// stops the whole import with a clear message, instead of being found halfway
// through after some rows have already been changed. Returns null when all
// records are fine.
function checkRecordsAreWellFormed(d: Record<string, unknown>): string | null {
  const translations = d.translations as unknown[];
  for (let i = 0; i < translations.length; i++) {
    const t = translations[i];
    const where = `translation #${i + 1}`;
    if (typeof t !== "object" || t === null) {
      return `This file is damaged: ${where} is not a proper entry. Nothing was imported.`;
    }
    const r = t as Record<string, unknown>;
    if (typeof r.key !== "string" || r.key === "") {
      return `This file is damaged: ${where} has no key. Nothing was imported.`;
    }
    if (!isTextOrMissing(r.translated_text)) {
      return `This file is damaged: ${where} ("${r.key}") has translated text that isn't text. Nothing was imported.`;
    }
    if (typeof r.status !== "string" || !KNOWN_STATUSES.has(r.status)) {
      return `This file is damaged: ${where} ("${r.key}") has an unrecognised status. Nothing was imported.`;
    }
    if (
      !isTextOrMissing(r.translated_by) ||
      !isTextOrMissing(r.updated_at) ||
      !isTextOrMissing(r.source_text) ||
      !isTextOrMissing(r.source_text_at_translation)
    ) {
      return `This file is damaged: ${where} ("${r.key}") has a field of the wrong type. Nothing was imported.`;
    }
  }
  const glossary = (d.glossary as unknown[] | undefined) ?? [];
  for (let i = 0; i < glossary.length; i++) {
    const g = glossary[i];
    const where = `glossary term #${i + 1}`;
    if (typeof g !== "object" || g === null) {
      return `This file is damaged: ${where} is not a proper entry. Nothing was imported.`;
    }
    const r = g as Record<string, unknown>;
    if (typeof r.english_term !== "string" || r.english_term === "" || typeof r.translated_term !== "string") {
      return `This file is damaged: ${where} is missing its term or its translation. Nothing was imported.`;
    }
    if (!isTextOrMissing(r.notes) || !isTextOrMissing(r.status)) {
      return `This file is damaged: ${where} ("${r.english_term}") has a field of the wrong type. Nothing was imported.`;
    }
  }
  return null;
}