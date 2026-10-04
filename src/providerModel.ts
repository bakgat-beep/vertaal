// The "Model" box on the provider settings. A model name only makes sense for
// the provider it was typed for ("translategemma:4b" means nothing to an
// OpenAI-compatible server), so each provider gets its own remembered name:
// switching provider shows THAT provider's name (blank if it never had one),
// and switching back brings the earlier one back instead of losing it.

export type ModelMemory = Record<string, string>;

// Starting point for a project that already has a provider + model saved.
export function initialModelMemory(providerId: string | null, model: string | null): ModelMemory {
  return providerId && model ? { [providerId]: model } : {};
}

export function modelFor(memory: ModelMemory, providerId: string): string {
  return memory[providerId] ?? "";
}

export function withModel(memory: ModelMemory, providerId: string, model: string): ModelMemory {
  return { ...memory, [providerId]: model };
}

// What actually gets saved on the project: nothing for manual-only (no AI), and
// otherwise only the name belonging to the chosen provider.
export function modelToSave(providerId: string, memory: ModelMemory, noAiProviderId: string): string | null {
  if (!providerId || providerId === noAiProviderId) return null;
  return modelFor(memory, providerId).trim() || null;
}