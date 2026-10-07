// Ollama *model discovery* for the Welcome Screen's model dropdown (name +
// size, so the user can see what's installed before picking one).
//
// This is a different concern from src/providers/ollama.ts, which is the
// actual TranslationProvider that sends translation requests to Ollama.
// That file reuses detectInstalledModels() below for its own model listing,
// so the "ask Ollama what's installed" logic only lives in one place.
//
// Requests go through Tauri's HTTP plugin, not the page's own fetch — see
// src/providers/deepl.ts for why.
import { fetch } from "@tauri-apps/plugin-http";

export interface OllamaModel {
  name: string;
  sizeGb: number;
}

// Asks Ollama what's actually installed, and picks out the translation-relevant
// ones so the welcome screen doesn't have to show every model on the machine.
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

// The address Ollama is reachable at: the one the person entered, or the
// usual local one. A trailing slash is removed so paths join cleanly.
export function resolveOllamaUrl(baseUrl?: string | null): string {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return DEFAULT_OLLAMA_URL;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export async function detectInstalledModels(baseUrl?: string | null): Promise<OllamaModel[]> {
  try {
    const response = await fetch(`${resolveOllamaUrl(baseUrl)}/api/tags`);
    if (!response.ok) return [];
    const data = await response.json();
    const models: OllamaModel[] = (data.models ?? [])
      .filter((m: { name: string }) => m.name.startsWith("translategemma"))
      .map((m: { name: string; size: number }) => ({
        name: m.name,
        sizeGb: Math.round((m.size / 1_000_000_000) * 10) / 10,
      }));
    return models;
  } catch {
    // Ollama not running, or unreachable — treated as "nothing detected"
    // rather than an error, since this is just for populating a dropdown.
    return [];
  }
}