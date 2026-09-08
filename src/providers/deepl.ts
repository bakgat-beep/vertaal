import type { TranslationProvider, TranslationRequest, TranslationResult, ProviderConfig } from "./types";

const LANGUAGE_CODE_MAP: Record<string, string> = {
  acehnese: "ACE",
  afrikaans: "AF",
  albanian: "SQ",
  arabic: "AR",
  aragonese: "AN",
  armenian: "HY",
  assamese: "AS",
  aymara: "AY",
  azerbaijani: "AZ",
  bashkir: "BA",
  basque: "EU",
  belarusian: "BE",
  bengali: "BN",
  bhojpuri: "BHO",
  bosnian: "BS",
  breton: "BR",
  bulgarian: "BG",
  burmese: "MY",
  cantonese: "YUE",
  catalan: "CA",
  cebuano: "CEB",
  chinese_simplified: "ZH-HANS",
  chinese_traditional: "ZH-HANT",
  chinese: "ZH",
  croatian: "HR",
  czech: "CS",
  danish: "DA",
  dari: "PRS",
  dutch: "NL",
  english: "EN",
  english_us: "EN-US",
  english_uk: "EN-GB",
  esperanto: "EO",
  estonian: "ET",
  finnish: "FI",
  french: "FR",
  french_canadian: "FR-CA",
  french_france: "FR-FR",
  galician: "GL",
  georgian: "KA",
  german: "DE",
  german_germany: "DE-DE",
  german_swiss: "DE-CH",
  greek: "EL",
  guarani: "GN",
  gujarati: "GU",
  haitian_creole: "HT",
  hausa: "HA",
  hebrew: "HE",
  hindi: "HI",
  hungarian: "HU",
  icelandic: "IS",
  igbo: "IG",
  indonesian: "ID",
  irish: "GA",
  italian: "IT",
  japanese: "JA",
  javanese: "JV",
  kapampangan: "PAM",
  kazakh: "KK",
  konkani: "GOM",
  korean: "KO",
  kurdish_kurmanji: "KMR",
  kurdish_sorani: "CKB",
  kyrgyz: "KY",
  latin: "LA",
  latvian: "LV",
  lingala: "LN",
  lithuanian: "LT",
  lombard: "LMO",
  luxembourgish: "LB",
  macedonian: "MK",
  maithili: "MAI",
  malagasy: "MG",
  malay: "MS",
  malayalam: "ML",
  maltese: "MT",
  maori: "MI",
  marathi: "MR",
  mongolian: "MN",
  nepali: "NE",
  norwegian_bokmal: "NB",
  occitan: "OC",
  oromo: "OM",
  pangasinan: "PAG",
  pashto: "PS",
  persian: "FA",
  polish: "PL",
  portuguese_brazilian: "PT-BR",
  portuguese_european: "PT-PT",
  portuguese: "PT",
  punjabi: "PA",
  quechua: "QU",
  romanian: "RO",
  russian: "RU",
  sanskrit: "SA",
  serbian: "SR",
  sesotho: "ST",
  sicilian: "SCN",
  slovak: "SK",
  slovenian: "SL",
  spanish: "ES",
  spanish_latin_american: "ES-419",
  sundanese: "SU",
  swahili: "SW",
  swedish: "SV",
  tagalog: "TL",
  tajik: "TG",
  tamil: "TA",
  tatar: "TT",
  telugu: "TE",
  thai: "TH",
  tsonga: "TS",
  tswana: "TN",
  turkish: "TR",
  turkmen: "TK",
  ukrainian: "UK",
  urdu: "UR",
  uzbek: "UZ",
  vietnamese: "VI",
  welsh: "CY",
  wolof: "WO",
  xhosa: "XH",
  yiddish: "YI",
  zulu: "ZU",
};

function toDeepLCode(language: string): string {
  return LANGUAGE_CODE_MAP[language.toLowerCase()] ?? language.toUpperCase();
}

async function translate(request: TranslationRequest, config: ProviderConfig): Promise<TranslationResult> {
  if (!config.apiKey) throw new Error("No DeepL API key configured.");

  const targetCode = toDeepLCode(request.targetLanguage);
  const sourceCode = toDeepLCode(request.sourceLanguage);

  // Free-tier keys end in ":fx" and require the free API host; paid keys use the standard one.
  const isFreeKey = config.apiKey.endsWith(":fx");
  const host = isFreeKey ? "https://api-free.deepl.com" : "https://api.deepl.com";

  const body: Record<string, unknown> = { text: [request.text], target_lang: targetCode };
  if (sourceCode) body.source_lang = sourceCode;

  const response = await fetch(`${host}/v2/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `DeepL-Auth-Key ${config.apiKey}` },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`DeepL request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const translatedText = data.translations?.[0]?.text;
  if (!translatedText) throw new Error("DeepL returned no translation.");

  return { translatedText, raw: data };
}

async function detectAvailability(config: ProviderConfig): Promise<boolean> {
  if (!config.apiKey) return false;
  try {
    const isFreeKey = config.apiKey.endsWith(":fx");
    const host = isFreeKey ? "https://api-free.deepl.com" : "https://api.deepl.com";
    const response = await fetch(`${host}/v2/usage`, { headers: { Authorization: `DeepL-Auth-Key ${config.apiKey}` } });
    return response.ok;
  } catch {
    return false;
  }
}

export const deeplProvider: TranslationProvider = {
  id: "deepl",
  displayName: "DeepL",
  isLocal: false,
  requiresModel: false,
  supportsGlossary: false, // DeepL has its own separate glossary API we haven't wired up; treat as unsupported for now
  supportsBatch: true,
  translate,
  detectAvailability,
};