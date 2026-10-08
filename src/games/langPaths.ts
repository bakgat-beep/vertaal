// Small helpers the game files share for turning a path inside the SOURCE
// language's files (English, or whichever language a project reads) into the
// matching path for the language being exported.

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "ui_l_english.yml" -> "ui_l_german.yml" (source "english", target "german").
export function renameLangSuffix(fileName: string, sourceLanguage: string, languageCode: string): string {
  return fileName.replace(new RegExp(`_l_${escapeRegExp(sourceLanguage)}\\.yml$`, "i"), `_l_${languageCode}.yml`);
}