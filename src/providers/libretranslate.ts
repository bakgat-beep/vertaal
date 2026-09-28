import type { TranslationProvider, TranslationRequest, TranslationResult, ProviderConfig } from "./types";

// Requests go through Tauri's HTTP plugin, not the page's own fetch: the
// browser view enforces CORS and a fixed connect-src allowlist, which
// blocks self-hosted servers (OpenAI-compatible, LibreTranslate) and even
// DeepL, whose API rejects browser-origin requests outright. Requests made
// this way run in the native backend, so none of that applies.
import { fetch } from "@tauri-apps/plugin-http";

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
  chinese: "zh",
  turkish: "tr",
  arabic: "ar",
  hindi: "hi",
  korean: "ko",
  swahili: "sw",
  zulu: "zu",
  xhosa: "xh",
  // Raw values a game's own nativeLanguages can produce (see games/*.ts),
  // used directly as request.sourceLanguage/targetLanguage — not language
  // names, so they need their own entries here rather than relying on the
  // name-based ones above.
  braz_por: "pt",
  simp_chinese: "zh",
};

function toLibreCode(language: string): string {
  return LANGUAGE_CODE_MAP[language.toLowerCase()] ?? language.toLowerCase();
}

function resolveBaseUrl(config: ProviderConfig): string {
  const trimmed = config.baseUrl?.trim();
  if (!trimmed) {
    throw new Error("No LibreTranslate server URL configured — set it as the Base URL in Project Settings.");
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

async function translate(request: TranslationRequest, config: ProviderConfig): Promise<TranslationResult> {
  const baseUrl = resolveBaseUrl(config);
  const sourceCode = toLibreCode(request.sourceLanguage);
  const targetCode = toLibreCode(request.targetLanguage);

  const body: Record<string, unknown> = {
    q: request.text,
    source: sourceCode,
    target: targetCode,
    format: "text",
  };
  if (config.apiKey) body.api_key = config.apiKey;

  const response = await fetch(`${baseUrl}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`LibreTranslate request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  if (!data.translatedText) throw new Error("LibreTranslate returned no translation.");

  return { translatedText: data.translatedText, raw: data };
}

async function detectAvailability(config: ProviderConfig): Promise<boolean> {
  try {
    const baseUrl = resolveBaseUrl(config);
    const response = await fetch(`${baseUrl}/languages`);
    return response.ok;
  } catch {
    return false;
  }
}

export const libreTranslateProvider: TranslationProvider = {
  id: "libretranslate",
  displayName: "LibreTranslate (self-hosted or public server)",
  isLocal: false,
  requiresModel: false,
  supportsGlossary: false,
  supportsBatch: false,
  translate,
  detectAvailability,
};