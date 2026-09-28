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
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}