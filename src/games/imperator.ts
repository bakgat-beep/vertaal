import { join, documentDir } from "@tauri-apps/api/path";
import type { GameAdapter } from "./types";
import { findModLocRelativeParts } from "../import";
import { modFolderName } from "../fileNames";
import { escapeDescriptorString } from "../modExport";
import { renameLangSuffix } from "./langPaths";

const NATIVE_LANGUAGES: Record<string, string> = {
  french: "french",
  german: "german",
  russian: "russian",
  spanish: "spanish",
  "simplified chinese": "simp_chinese",
};

const FORBIDDEN_CHARACTERS: Record<string, string> = {
  "„": '"',
  "\u201c": '"',
  "\u201a": "'",
  "\u2018": "'",
  "\u2013": "-",
  "\u201d": '"',
  "\u2019": "'",
  "\u2026": "...",
  "\u2014": "-",
};

async function detectModPath(): Promise<string> {
  const docs = await documentDir();
  return await join(docs, "Paradox Interactive", "Imperator", "mod");
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
  if (parts.length > 2) {
    return parts[1];
  }
  const fileName = parts[parts.length - 1];
  const stripped = fileName.replace(/_l_[a-z_]+\.yml$/i, "");
  return stripped || "general";
}

function toModRelativePath(fullPath: string, languageCode: string, sourceLanguage: string = "english"): string | null {
  const marker = "\\localization\\";
  const idx = fullPath.indexOf(marker);
  if (idx === -1) return null;
  const afterLoc = fullPath.substring(idx + marker.length);
  const parts = afterLoc.split("\\");
  const fileName = parts.pop() as string;
  const renamedFileName = renameLangSuffix(fileName, sourceLanguage, languageCode);

  return ["localization", "replace", renamedFileName].join("\\");
}

function toModExportRelativePath(fullPath: string, languageCode: string, sourceLanguage: string = "english"): string | null {
  const parts = findModLocRelativeParts(fullPath);
  if (!parts) return null;
  const fileName = renameLangSuffix(parts.pop() as string, sourceLanguage, languageCode);
  return ["localization", "replace", fileName].join("\\");
}

function toUnixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export const imperatorAdapter: GameAdapter = {
  id: "imperator",
  displayName: "Imperator: Rome",
  sourceLanguage: "english",
  nativeLanguages: NATIVE_LANGUAGES,
  forbiddenCharacters: FORBIDDEN_CHARACTERS,
  detectModPath,
  extractCategory,
  extractSubcategory,
  toModRelativePath,
  toModExportRelativePath,
  buildMetadata: (modName, targetLanguage) => ({
    name: modName,
    id: modFolderName(modName),
    version: "0.1.0",
    supported_game_version: "2.*",
    short_description: `${targetLanguage} translation of Imperator: Rome.`,
    tags: ["Translation"],
    relationships: [],
    game_custom_data: {},
  }),
  buildDescriptor: (modName) => `version="0.1.0"\ntags={\n\t"Translation"\n}\nname="${escapeDescriptorString(modName)}"\n`,

  buildOuterModPointer: (modName, modRootAbsolutePath) => ({
    fileName: `${modFolderName(modName)}.mod`,
    content: `version="0.1.0"\ntags={\n\t"Translation"\n}\nname="${escapeDescriptorString(modName)}"\nsupported_version="2.*"\npath="${toUnixPath(modRootAbsolutePath)}"\n`,
  }),
};