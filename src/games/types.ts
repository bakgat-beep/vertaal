export interface GameAdapter {
  id: string;
  displayName: string;
  sourceLanguage: string;
  detectModPath: () => Promise<string>;
  extractCategory: (fullPath: string) => string;
  extractSubcategory: (fullPath: string) => string;
  // sourceLanguage = the language the files being converted are in (the project's
  // source language); it defaults to English for callers that do not say.
  toModRelativePath: (fullPath: string, languageCode: string, sourceLanguage?: string) => string | null;
  toModExportRelativePath?: (fullPath: string, languageCode: string, sourceLanguage?: string) => string | null;
  buildMetadata: (modName: string, targetLanguage: string) => Record<string, unknown>;
  buildDescriptor: (modName: string) => string;
  nativeLanguages: Record<string, string>;
  forbiddenCharacters?: Record<string, string>;
  buildOuterModPointer?: (modName: string, modRootAbsolutePath: string) => { fileName: string; content: string };
}