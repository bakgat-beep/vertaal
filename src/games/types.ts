export interface GameAdapter {
  id: string;
  displayName: string;
  sourceLanguage: string;
  detectModPath: () => Promise<string>;
  extractCategory: (fullPath: string) => string;
  extractSubcategory: (fullPath: string) => string;
  toModRelativePath: (fullPath: string, languageCode: string) => string | null;
  toModExportRelativePath?: (fullPath: string, languageCode: string) => string | null;
  buildMetadata: (modName: string, targetLanguage: string) => Record<string, unknown>;
  buildDescriptor: (modName: string) => string;
  nativeLanguages: Record<string, string>;
  forbiddenCharacters?: Record<string, string>;
  buildOuterModPointer?: (modName: string, modRootAbsolutePath: string) => { fileName: string; content: string };
}