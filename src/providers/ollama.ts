// The TranslationProvider for Ollama (sends actual translation requests).
//
// Model *discovery* (what's installed) is handled by detectInstalledModels()
// in src/ollama.ts — reused here for listModels() so there's only one place
// that knows how to ask Ollama what's installed and filter it down to
// translation-relevant models, instead of two near-identical copies.
import type { TranslationProvider, TranslationRequest, TranslationResult, ProviderConfig } from "./types";
import { detectInstalledModels, resolveOllamaUrl } from "../ollama";
import { ProviderError, responseError } from "./errors";

// Requests go through Tauri's HTTP plugin, not the page's own fetch: the
// browser view enforces CORS and a fixed connect-src allowlist, which
// blocks self-hosted servers (OpenAI-compatible, LibreTranslate) and even
// DeepL, whose API rejects browser-origin requests outright. Requests made
// this way run in the native backend, so none of that applies.
import { fetch } from "@tauri-apps/plugin-http";
import { languageDisplayName, languageIsoCode } from "../languageCodes";

// TranslateGemma was trained on one exact prompt, which names each language
// AND gives its short code, and puts two blank lines before the text. When a
// language's code isn't known (a custom language with no code entered) the
// code part is left out rather than guessed.
export function buildTranslateGemmaPrompt(request: TranslationRequest): string {
  const source = languageDisplayName(request.sourceLanguage);
  const target = languageDisplayName(request.targetLanguage);
  const sourceCode = languageIsoCode(request.sourceLanguage);
  const targetCode = languageIsoCode(request.targetLanguage);
  const sourceLabel = sourceCode ? `${source} (${sourceCode})` : source;
  const targetLabel = targetCode ? `${target} (${targetCode})` : target;
  const glossaryBlock = request.glossaryInstruction
    ? `\n\nFollow these mandatory terminology rules:\n${request.glossaryInstruction}`
    : "";
  return (
    `You are a professional ${sourceLabel} to ${targetLabel} translator. Your goal is to accurately convey the meaning and nuances of the original ${source} text while adhering to ${target} grammar, vocabulary, and cultural sensitivities.\n` +
    `Produce only the ${target} translation, without any additional explanations or commentary.${glossaryBlock} Please translate the following ${source} text into ${target}:\n\n\n${request.text}`
  );
}

async function translate(request: TranslationRequest, config: ProviderConfig): Promise<TranslationResult> {
  if (!config.model) throw new ProviderError("No Ollama model configured.", "permanent");

  const response = await fetch(`${resolveOllamaUrl(config.baseUrl)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: buildTranslateGemmaPrompt(request) }],
      stream: false,
    }),
    signal: config.signal,
  });

  if (!response.ok) {
    throw responseError("Ollama", response.status, response.statusText);
  }

  const data = await response.json();
  const content = data?.message?.content;
  if (typeof content !== "string") throw new Error("Ollama returned no translation text.");
  return { translatedText: content, raw: data };
}

// Deliberately kept separate from detectInstalledModels(): this only checks
// that the Ollama service itself is reachable, regardless of whether any
// translation-relevant model is installed yet. Folding this into the model
// list would change its meaning (available vs. "available AND has a
// translategemma model"), which is a bigger behavior change than this
// cleanup is meant to make.
async function detectAvailability(config?: ProviderConfig): Promise<boolean> {
  try {
    const response = await fetch(`${resolveOllamaUrl(config?.baseUrl)}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

async function listModels(config?: ProviderConfig): Promise<string[]> {
  const models = await detectInstalledModels(config?.baseUrl);
  return models.map((m) => m.name);
}

export const ollamaProvider: TranslationProvider = {
  id: "ollama",
  displayName: "TranslateGemma (local, via Ollama)",
  isLocal: true,
  requiresModel: true,
  supportsGlossary: true,
  supportsBatch: false,
  requiresApiKey: false,
  supportsCustomBaseUrl: true, // Ollama running on another computer
  isLlm: true,
  requestTimeoutMs: 5 * 60 * 1000, // a model that is still loading can be slow to answer
  translate,
  detectAvailability,
  listModels,
};

export { detectInstalledModels };