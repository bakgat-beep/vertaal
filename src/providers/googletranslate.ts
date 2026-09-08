import type { TranslationProvider, TranslationRequest, TranslationResult, ProviderConfig } from "./types";

// Uses Google Translate's public web-facing endpoint (the same one
// translate.google.com calls internally) rather than the paid Cloud
// Translation API — no API key, no billing. Confirmed via three independent
// unofficial-client projects that all use this same endpoint and query
// shape. Google doesn't publish or guarantee this endpoint, so it's free
// but unofficial and could change without notice.
const ENDPOINT = "https://translate.googleapis.com/translate_a/single";

const LANGUAGE_CODE_MAP: Record<string, string> = {
  english: "en",
  afrikaans: "af",
  german: "de",
  french: "fr",
  spanish: "es",
  dutch: "nl",
  portuguese: "pt",
  italian: "it",
  polish: "pl",
  russian: "ru",
  japanese: "ja",
  chinese: "zh-CN",
  swahili: "sw",
  zulu: "zu",
  xhosa: "xh",
};

function toGoogleCode(language: string): string {
  return LANGUAGE_CODE_MAP[language.toLowerCase()] ?? language.toLowerCase();
}

async function translate(request: TranslationRequest, _config: ProviderConfig): Promise<TranslationResult> {
  const sourceCode = toGoogleCode(request.sourceLanguage);
  const targetCode = toGoogleCode(request.targetLanguage);

  const params = new URLSearchParams({
    client: "gtx",
    sl: sourceCode,
    tl: targetCode,
    dt: "t",
    q: request.text,
  });

  const response = await fetch(`${ENDPOINT}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Google Translate request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const segments = data?.[0];
  if (!Array.isArray(segments)) {
    throw new Error("Google Translate returned an unexpected response shape.");
  }
  const translatedText = segments.map((seg: unknown[]) => seg[0]).join("");
  if (!translatedText) throw new Error("Google Translate returned no translation.");

  return { translatedText, raw: data };
}

async function detectAvailability(): Promise<boolean> {
  try {
    const params = new URLSearchParams({ client: "gtx", sl: "en", tl: "af", dt: "t", q: "test" });
    const response = await fetch(`${ENDPOINT}?${params.toString()}`);
    return response.ok;
  } catch {
    return false;
  }
}

export const googleTranslateProvider: TranslationProvider = {
  id: "google-translate",
  displayName: "Google Translate (free, unofficial)",
  isLocal: false,
  requiresModel: false,
  supportsGlossary: false,
  supportsBatch: false,
  translate,
  detectAvailability,
};