import type { TranslationProvider, TranslationRequest, TranslationResult, ProviderConfig } from "./types";

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

async function detectAvailability(): Promise<boolean> {
  try {
    const response = await fetch("http://localhost:11434/api/tags");
    return response.ok;
  } catch {
    return false;
  }
}

async function listModels(): Promise<string[]> {
  try {
    const response = await fetch("http://localhost:11434/api/tags");
    if (!response.ok) return [];
    const data = await response.json();
    return (data.models ?? [])
      .filter((m: { name: string }) => m.name.startsWith("translategemma"))
      .map((m: { name: string }) => m.name);
  } catch {
    return [];
  }
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