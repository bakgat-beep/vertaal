import type { TranslationProvider } from "./types";
import { ollamaProvider } from "./ollama";
import { deeplProvider } from "./deepl";
import { googleTranslateProvider } from "./googletranslate";
import { openaiCompatibleProvider } from "./openai-compatible";
import { libreTranslateProvider } from "./libretranslate";

export const TRANSLATION_PROVIDERS: Record<string, TranslationProvider> = {
  ollama: ollamaProvider,
  deepl: deeplProvider,
  "google-translate": googleTranslateProvider,
  "openai-compatible": openaiCompatibleProvider,
  libretranslate: libreTranslateProvider,
};