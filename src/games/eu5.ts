import { join, documentDir } from "@tauri-apps/api/path";
import type { GameAdapter } from "./types";
import { findModLocRelativeParts } from "../import";
import { modFolderName } from "../fileNames";
import { escapeDescriptorString } from "../modExport";
import { renameLangSuffix } from "./langPaths";

const NATIVE_LANGUAGES: Record<string, string> = {
  "brazilian portuguese": "braz_por",
  french: "french",
  german: "german",
  polish: "polish",
  russian: "russian",
  spanish: "spanish",
  japanese: "japanese",
  "simplified chinese": "simp_chinese",
  korean: "korean",
  turkish: "turkish",
};

async function detectModPath(): Promise<string> {
  const docs = await documentDir();
  return await join(docs, "Paradox Interactive", "Europa Universalis V", "mod");
}

function extractCategory(fullPath: string): string {
  const marker = "\\game\\";
  const idx = fullPath.indexOf(marker);
  if (idx === -1) return "other";
  const afterGame = fullPath.substring(idx + marker.length);
  return afterGame.split("\\")[0];
}

function extractSubcategory(fullPath: string): string {
  const marker = "\\localization\\";
  const idx = fullPath.indexOf(marker);
  if (idx === -1) return "general";
  const afterLoc = fullPath.substring(idx + marker.length);
  const parts = afterLoc.split("\\");
  if (parts.length <= 2) return "general";
  return parts[1];
}

function toModRelativePath(fullPath: string, languageCode: string, sourceLanguage: string = "english"): string | null {
  const marker = "\\game\\";
  const idx = fullPath.indexOf(marker);
  if (idx === -1) return null;
  const afterGame = fullPath.substring(idx + marker.length);
  const parts = afterGame.split("\\");
  let fileName = parts.pop() as string;

  const sourceFolderIndex = parts.indexOf(sourceLanguage);
  if (sourceFolderIndex !== -1 && languageCode !== sourceLanguage) {
    parts[sourceFolderIndex] = languageCode;
  }
  fileName = renameLangSuffix(fileName, sourceLanguage, languageCode);

  return [...parts, "replace", fileName].join("\\");
}

function toModExportRelativePath(fullPath: string, languageCode: string, sourceLanguage: string = "english"): string | null {
  const parts = findModLocRelativeParts(fullPath);
  if (!parts) return null;
  let fileName = parts.pop() as string;

  const sourceFolderIndex = parts.indexOf(sourceLanguage);
  if (sourceFolderIndex !== -1 && languageCode !== sourceLanguage) {
    parts[sourceFolderIndex] = languageCode;
  }
  fileName = renameLangSuffix(fileName, sourceLanguage, languageCode);

  return [...parts, "replace", fileName].join("\\");
}

export const eu5Adapter: GameAdapter = {
  id: "eu5",
  displayName: "Europa Universalis 5",
  sourceLanguage: "english",
  nativeLanguages: NATIVE_LANGUAGES,
  detectModPath,
  extractCategory,
  extractSubcategory,
  toModRelativePath,
  toModExportRelativePath,
  buildMetadata: (modName, targetLanguage) => ({
    name: modName,
    id: modFolderName(modName),
    version: "0.1.0",
    game_id: "eu5",
    supported_game_version: "1.*",
    short_description: `${targetLanguage} translation of Europa Universalis V.`,
    tags: ["Translation"],
    relationships: [],
    game_custom_data: {},
  }),
  buildDescriptor: (modName) => `version="0.1.0"\ntags={\n\t"Translation"\n}\nname="${escapeDescriptorString(modName)}"\n`,
};