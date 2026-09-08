import { join, documentDir } from "@tauri-apps/api/path";
import type { GameAdapter } from "./types";
import { findModLocRelativeParts } from "../import";

export const IMPERATOR_DEFAULT_INSTALL_GUESS =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\ImperatorRome\\game";

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
  const stripped = fileName.replace(/_l_english\.yml$/i, "");
  return stripped || "general";
}

function toModRelativePath(fullPath: string, languageCode: string): string | null {
  const marker = "\\localization\\";
  const idx = fullPath.indexOf(marker);
  if (idx === -1) return null;
  const afterLoc = fullPath.substring(idx + marker.length);
  const parts = afterLoc.split("\\");
  const fileName = parts.pop() as string;
  const renamedFileName = fileName.replace(/_l_english\.yml$/i, `_l_${languageCode}.yml`);

  return ["localization", "replace", renamedFileName].join("\\");
}

function toModExportRelativePath(fullPath: string, languageCode: string): string | null {
  const parts = findModLocRelativeParts(fullPath);
  if (!parts) return null;
  const fileName = (parts.pop() as string).replace(/_l_english\.yml$/i, `_l_${languageCode}.yml`);
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
    id: modName.toLowerCase().replace(/\s+/g, "-"),
    version: "0.1.0",
    supported_game_version: "2.*",
    short_description: `${targetLanguage} translation of Imperator: Rome.`,
    tags: ["Translation"],
    relationships: [],
    game_custom_data: {},
  }),
  buildDescriptor: (modName) => `version="0.1.0"\ntags={\n\t"Translation"\n}\nname="${modName}"\n`,

  buildOuterModPointer: (modName, modRootAbsolutePath) => ({
    fileName: `${modName.toLowerCase().replace(/\s+/g, "-")}.mod`,
    content: `version="0.1.0"\ntags={\n\t"Translation"\n}\nname="${modName}"\nsupported_version="2.*"\npath="${toUnixPath(modRootAbsolutePath)}"\n`,
  }),
};