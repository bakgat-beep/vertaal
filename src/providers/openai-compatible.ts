import type { TranslationProvider, TranslationRequest, TranslationResult, ProviderConfig } from "./types";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function resolveBaseUrl(config: ProviderConfig): string {
  const trimmed = config.baseUrl?.trim();
  if (!trimmed) return DEFAULT_BASE_URL;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

async function translate(request: TranslationRequest, config: ProviderConfig): Promise<TranslationResult> {
  if (!config.model) throw new Error("No model configured for the OpenAI-compatible provider.");

  const glossaryBlock = request.glossaryInstruction
    ? `\n\nFollow these mandatory terminology rules:\n${request.glossaryInstruction}`
    : "";

  const prompt =
    `You are a professional ${request.sourceLanguage} to ${request.targetLanguage} translator. Your goal is to accurately convey the meaning and nuances of the original text while adhering to grammar, vocabulary, and cultural sensitivities. Produce only the translation, without any additional explanations or commentary.${glossaryBlock}\n\nPlease translate the following text:\n\n${request.text}`;

  const baseUrl = resolveBaseUrl(config);
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI-compatible request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const translatedText = data.choices?.[0]?.message?.content;
  if (!translatedText) throw new Error("OpenAI-compatible endpoint returned no translation text.");

  return { translatedText: translatedText.trim(), raw: data };
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
  translate,
  detectAvailability,
  listModels,
};