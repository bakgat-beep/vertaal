export interface EditorRow {
  key: string;
  game_id: string;
  source_text: string;
  source_text_hash: string;
  context_label: string | null;
  translated_text: string | null;
  status: string | null;
  flagged: number | null;
  translated_by: string | null;
  updated_at: string | null;
  file_path?: string | null;
  source_hash_at_translation: string | null;
}
export interface Project {
  id: number;
  game_id: string;
  source_language: string;
  target_language: string;
  mod_name: string;
  output_path: string | null;
  install_path: string | null;
  ai_model: string | null;
  translation_provider_id: string | null;
}
export interface TranslationRequest {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  glossaryInstruction?: string; // pre-built, provider-agnostic instruction text
}

export interface TranslationResult {
  translatedText: string;
  raw?: unknown; // provider's original response, kept for debugging
}

export interface TranslationProvider {
  id: string;               // "ollama", "deepl", "openai-compatible", etc.
  displayName: string;
  isLocal: boolean;
  supportsGlossary: boolean;
  supportsBatch: boolean;

  translate(request: TranslationRequest, config: ProviderConfig): Promise<TranslationResult>;
  detectAvailability?(config: ProviderConfig): Promise<boolean>; // e.g. "is Ollama running", "is the API key valid"
  listModels?(config: ProviderConfig): Promise<string[]>;
}

// What a project stores about how it's configured to use a given provider.
export interface ProviderConfig {
  providerId: string;
  model: string | null;
  apiKey: string | null;   // encrypted at rest, same approach as the GitHub token
  baseUrl: string | null;  // for self-hosted/OpenAI-compatible endpoints
}