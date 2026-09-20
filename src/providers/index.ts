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
// Stored as a project's provider id when it is set to manual translation only
// (no AI at all). A project with NO id stored (older projects, created before
// providers existed) is treated as TranslateGemma, as it always was — so "no
// provider" needs its own explicit value.
export const NO_AI_PROVIDER_ID = "none";

// The provider a project actually uses, or null when it is manual-only.
export function getProjectProvider(project: { translation_provider_id: string | null }): TranslationProvider | null {
  const id = project.translation_provider_id;
  if (id === NO_AI_PROVIDER_ID) return null;
  return TRANSLATION_PROVIDERS[id ?? "ollama"] ?? null;
}

// How a provider is written in a drop-down list: its name, plus where it runs
// unless the name already says so (avoids things like "self-hosted … (cloud)").
export function providerOptionLabel(p: TranslationProvider): string {
  if (p.displayName.includes("(")) return p.displayName;
  return `${p.displayName} ${p.isLocal ? "(runs on your computer)" : "(online)"}`;
}