export interface TranslationRequest {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  glossaryInstruction?: string; // raw rule lines; each provider wraps its own prompt format
}

export interface TranslationResult {
  translatedText: string;
  raw?: unknown;
}

export interface ProviderConfig {
  providerId: string;
  model: string | null;
  apiKey: string | null;
  baseUrl: string | null;
}

export interface TranslationProvider {
  id: string;
  displayName: string;
  isLocal: boolean;
  supportsGlossary: boolean;
  supportsBatch: boolean;

  translate(request: TranslationRequest, config: ProviderConfig): Promise<TranslationResult>;
  detectAvailability?(config: ProviderConfig): Promise<boolean>;
  listModels?(config: ProviderConfig): Promise<string[]>;
}