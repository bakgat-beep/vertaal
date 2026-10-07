import type { TranslationProvider, TranslationRequest, TranslationResult, ProviderConfig } from "./types";

// Requests go through Tauri's HTTP plugin, not the page's own fetch: the
// browser view enforces CORS and a fixed connect-src allowlist, which
// blocks self-hosted servers (OpenAI-compatible, LibreTranslate) and even
// DeepL, whose API rejects browser-origin requests outright. Requests made
// this way run in the native backend, so none of that applies.
import { fetch } from "@tauri-apps/plugin-http";
import { languageDisplayName } from "../languagecodes";
import { ProviderError, responseError } from "./errors";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function resolveBaseUrl(config: ProviderConfig): string {
  const trimmed = config.baseUrl?.trim();
  if (!trimmed) return DEFAULT_BASE_URL;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

async function translate(request: TranslationRequest, config: ProviderConfig): Promise<TranslationResult> {
  if (!config.model) throw new ProviderError("No model configured for the OpenAI-compatible provider.", "permanent");

  // The instructions go in a "system" message and ONLY the text to translate
  // goes in the "user" message, so a game string that happens to read like an
  // instruction ("Ignore the above...") is just text to translate, not a command.
  const glossaryBlock = request.glossaryInstruction
    ? `\n\nFollow these mandatory terminology rules:\n${request.glossaryInstruction}`
    : "";
  const instructions =
    `You are a professional ${languageDisplayName(request.sourceLanguage)} to ${languageDisplayName(request.targetLanguage)} translator. Your goal is to accurately convey the meaning and nuances of the original text while adhering to grammar, vocabulary, and cultural sensitivities. ` +
    `Translate the text the user sends. Reply with only the translation, without any additional explanations or commentary, and keep every __TOKEN_n__ marker exactly as it is.${glossaryBlock}`;

  const baseUrl = resolveBaseUrl(config);
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      // No "temperature": newer OpenAI models reject any value other than
      // their default (HTTP 400 "Unsupported value"), and other servers use a
      // sensible default of their own.
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: request.text },
      ],
    }),
    signal: config.signal,
  });

  if (!response.ok) {
    throw responseError("OpenAI-compatible", response.status, await response.text());
  }

  const data = await response.json();
  const translatedText = data.choices?.[0]?.message?.content;
  if (!translatedText) throw new Error("OpenAI-compatible endpoint returned no translation text.");

  return { translatedText, raw: data };
}

async function detectAvailability(config: ProviderConfig): Promise<boolean> {
  try {
    const baseUrl = resolveBaseUrl(config);
    const headers: Record<string, string> = {};
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const response = await fetch(`${baseUrl}/models`, { headers });
    return response.ok;
  } catch {
    return false;
  }
}

async function listModels(config: ProviderConfig): Promise<string[]> {
  try {
    const baseUrl = resolveBaseUrl(config);
    const headers: Record<string, string> = {};
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const response = await fetch(`${baseUrl}/models`, { headers });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.data ?? []).map((m: { id: string }) => m.id);
  } catch {
    return [];
  }
}

export const openaiCompatibleProvider: TranslationProvider = {
  id: "openai-compatible",
  displayName: "OpenAI-compatible (cloud or self-hosted)",
  isLocal: false,
  requiresModel: true,
  supportsGlossary: true,
  supportsBatch: false,
  requiresApiKey: true, // optional for a self-hosted server, but needed for the OpenAI cloud
  supportsCustomBaseUrl: true,
  isLlm: true,
  translate,
  detectAvailability,
  listModels,
};