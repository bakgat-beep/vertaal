import type { TranslationProvider, TranslationRequest, TranslationResult, ProviderConfig } from "./types";

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