import { join, documentDir } from "@tauri-apps/api/path";
import type { GameAdapter } from "./types";
import { findModLocRelativeParts } from "../import";

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
};

const FORBIDDEN_CHARACTERS: Record<string, string> = {
  "„": '"',
  "\u201c": '"', // “
  "\u201a": "'", // ‚
  "\u2018": "'", // ‘
  "\u2013": "-", // – (en dash)
  "\u201d": '"', // ”
  "\u2019": "'", // ’
  "\u2026": "...", // …
  "\u2014": "-", // — (em dash)
};

async function detectModPath(): Promise<string> {
  const docs = await documentDir();
  return await join(docs, "Paradox Interactive", "Stellaris", "mod");
}

function extractCategory(fullPath: string): string {
  const marker = "\\Stellaris\\";
  const idx = fullPath.indexOf(marker);
  if (idx === -1) return "other";
  const afterRoot = fullPath.substring(idx + marker.length);
  return afterRoot.split("\\")[0];
}

function extractSubcategory(fullPath: string): string {
  const marker = "\\localisation\\";
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
  const marker = "\\localisation\\";
  const idx = fullPath.indexOf(marker);
  if (idx === -1) return null;
  const afterLoc = fullPath.substring(idx + marker.length);
  const parts = afterLoc.split("\\");
  let fileName = parts.pop() as string;

  const englishFolderIndex = parts.indexOf("english");
  if (englishFolderIndex !== -1 && languageCode !== "english") {
    parts[englishFolderIndex] = languageCode;
  }
  fileName = fileName.replace(/_l_english\.yml$/i, `_l_${languageCode}.yml`);

  return ["localisation", "replace", fileName].join("\\");
}

function toModExportRelativePath(fullPath: string, languageCode: string): string | null {
  const parts = findModLocRelativeParts(fullPath);
  if (!parts) return null;
  const fileName = (parts.pop() as string).replace(/_l_english\.yml$/i, `_l_${languageCode}.yml`);
  return ["localisation", "replace", fileName].join("\\");
}

function toUnixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export const stellarisAdapter: GameAdapter = {
  id: "stellaris",
  displayName: "Stellaris",
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
    supported_game_version: "3.*",
    short_description: `${targetLanguage} translation of Stellaris.`,
    tags: ["Translation"],
    relationships: [],
    game_custom_data: {},
  }),

  buildDescriptor: (modName) =>
    `version="0.1.0"\ntags={\n\t"Translation"\n}\nname="${modName}"\nsupported_version="v3.*"\n`,
  buildOuterModPointer: (modName, modRootAbsolutePath) => ({
    fileName: `${modName.toLowerCase().replace(/\s+/g, "-")}.mod`,
    content: `version="0.1.0"\ntags={\n\t"Translation"\n}\nname="${modName}"\nsupported_version="v3.*"\npath="${toUnixPath(modRootAbsolutePath)}"\n`,
  }),
};