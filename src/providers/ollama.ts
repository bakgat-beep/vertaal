// The TranslationProvider for Ollama (sends actual translation requests).
//
// Model *discovery* (what's installed) is handled by detectInstalledModels()
// in src/ollama.ts — reused here for listModels() so there's only one place
// that knows how to ask Ollama what's installed and filter it down to
// translation-relevant models, instead of two near-identical copies.
import type { TranslationProvider, TranslationRequest, TranslationResult, ProviderConfig } from "./types";
import { detectInstalledModels } from "../ollama";

async function translate(request: TranslationRequest, config: ProviderConfig): Promise<TranslationResult> {
  if (!config.model) throw new Error("No Ollama model configured.");

  const glossaryBlock = request.glossaryInstruction
    ? `\n\nFollow these mandatory terminology rules:\n${request.glossaryInstruction}`
    : "";

  const prompt =
    `You are a professional ${request.sourceLanguage} to ${request.targetLanguage} translator. Your goal is to accurately convey the meaning and nuances of the original text while adhering to grammar, vocabulary, and cultural sensitivities. Produce only the translation, without any additional explanations or commentary.${glossaryBlock}\n\nPlease translate the following text:\n\n${request.text}`;

  const response = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return { translatedText: data.message.content.trim(), raw: data };
}

// Deliberately kept separate from detectInstalledModels(): this only checks
// that the Ollama service itself is reachable, regardless of whether any
// translation-relevant model is installed yet. Folding this into the model
// list would change its meaning (available vs. "available AND has a
// translategemma model"), which is a bigger behavior change than this
// cleanup is meant to make.
async function detectAvailability(): Promise<boolean> {
  try {
    const response = await fetch("http://localhost:11434/api/tags");
    return response.ok;
  } catch {
    return false;
  }
}

async function listModels(): Promise<string[]> {
  const models = await detectInstalledModels();
  return models.map((m) => m.name);
}

export const ollamaProvider: TranslationProvider = {
  id: "ollama",
  displayName: "TranslateGemma (local, via Ollama)",
  isLocal: true,
  requiresModel: true,
  supportsGlossary: true,
  supportsBatch: false,
  translate,
  detectAvailability,
  listModels,
};