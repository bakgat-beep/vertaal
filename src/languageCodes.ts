// Turns an internal language value into something readable, for use in text
// meant for a person or an AI model to read (a prompt, a label) — never for
// building a URL or an API parameter, which each provider handles itself.
//
// Most values already read fine as-is once capitalised ("english",
// "afrikaans", "french", ...). A few are Paradox's own internal codes, not
// language names, and need spelling out — these came from a game's own
// nativeLanguages (see games/*.ts): the game stores its French/German/etc.
// files under names Vertaal reuses directly as the source_language value,
// but a couple of games abbreviate: "braz_por", "simp_chinese".
const OVERRIDES: Record<string, string> = {
  braz_por: "Brazilian Portuguese",
  simp_chinese: "Simplified Chinese",
};

export function languageDisplayName(rawLanguage: string): string {
  const key = rawLanguage.toLowerCase();
  if (OVERRIDES[key]) return OVERRIDES[key];
  // A bare two-letter code (typed as a custom language's code) reads better
  // as the language it stands for.
  if (key.length === 2 && CODE_TO_NAME[key]) return CODE_TO_NAME[key];
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

// Short ISO language codes ("fr", "af") for the language names and Paradox
// folder names Vertaal uses. Some AI models are told the code as well as the
// name (TranslateGemma expects both). A value that already IS a short code
// (what you type in the "Code" box for a custom language) is passed through
// unchanged. Returns null for a language this list does not know.
const ISO_CODES: Record<string, string> = {
  english: "en", afrikaans: "af", dutch: "nl", german: "de", french: "fr", spanish: "es", italian: "it",
  portuguese: "pt", "brazilian portuguese": "pt", braz_por: "pt", polish: "pl", russian: "ru", turkish: "tr",
  arabic: "ar", hindi: "hi", chinese: "zh", "simplified chinese": "zh", simp_chinese: "zh", japanese: "ja",
  korean: "ko", swahili: "sw", zulu: "zu", xhosa: "xh", ukrainian: "uk", swedish: "sv", norwegian: "no",
  danish: "da", finnish: "fi", greek: "el", czech: "cs", hungarian: "hu", romanian: "ro", bulgarian: "bg",
  hebrew: "he", thai: "th", vietnamese: "vi", indonesian: "id", persian: "fa", catalan: "ca",
};
const CODE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/i;

export function languageIsoCode(rawLanguage: string): string | null {
  const key = rawLanguage.trim().toLowerCase();
  if (ISO_CODES[key]) return ISO_CODES[key];
  if (CODE_PATTERN.test(key)) return key;
  return null;
}


const CODE_TO_NAME: Record<string, string> = {};
for (const [name, code] of Object.entries(ISO_CODES)) {
  if (!name.includes(" ") && !name.includes("_") && !(code in CODE_TO_NAME)) {
    CODE_TO_NAME[code] = name[0].toUpperCase() + name.slice(1);
  }
}