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
  // Set by the caller. When it fires (the person pressed Stop, or the request
  // took too long) the provider must abandon the request - pass it to fetch.
  signal?: AbortSignal;
}

export interface TranslationProvider {
  id: string;
  displayName: string;
  isLocal: boolean;
  supportsGlossary: boolean;
  supportsBatch: boolean;
  requiresModel: boolean;
  // What the settings screen should offer for this provider.
  requiresApiKey: boolean;
  supportsCustomBaseUrl: boolean;
  // An AI chat model (as opposed to a dedicated translation service). Its
  // replies are checked for chatty extras such as "Here is the translation:".
  isLlm: boolean;
  // How long to wait for one reply before giving up; 60 seconds when absent.
  requestTimeoutMs?: number;

  translate(request: TranslationRequest, config: ProviderConfig): Promise<TranslationResult>;
  detectAvailability?(config: ProviderConfig): Promise<boolean>;
  listModels?(config: ProviderConfig): Promise<string[]>;
}