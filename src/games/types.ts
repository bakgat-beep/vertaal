export interface GameAdapter {
  id: string;
  displayName: string;
  sourceLanguage: string;
  detectModPath: () => Promise<string>;
  extractCategory: (fullPath: string) => string;
  extractSubcategory: (fullPath: string) => string;
  toModRelativePath: (fullPath: string) => string | null;
  buildMetadata: (modName: string, targetLanguage: string) => Record<string, unknown>;
  buildDescriptor: (modName: string) => string;
}