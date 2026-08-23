export interface OllamaModel {
  name: string;
  sizeGb: number;
}

// Asks Ollama what's actually installed, and picks out the translation-relevant
// ones so the welcome screen doesn't have to show every model on the machine.
export async function detectInstalledModels(): Promise<OllamaModel[]> {
  try {
    const response = await fetch("http://localhost:11434/api/tags");
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