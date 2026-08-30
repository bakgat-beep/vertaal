import type { TranslationProvider } from "./types";
import { ollamaProvider } from "./ollama";

export const TRANSLATION_PROVIDERS: Record<string, TranslationProvider> = {
  ollama: ollamaProvider,
};