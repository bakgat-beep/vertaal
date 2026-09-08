import { join, documentDir } from "@tauri-apps/api/path";
import type { GameAdapter } from "./types";
import { findModLocRelativeParts } from "../import";

export const VICTORIA3_DEFAULT_INSTALL_GUESS =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Victoria 3\\game";

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
  return await join(docs, "Paradox Interactive", "Victoria 3", "mod");
}

// Victoria 3 uses the same "\game\<category>\..." layout as EU5, with
// localization further split by language folder: \game\localization\english\...
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
  const marker = "\\game\\";
  const idx = fullPath.indexOf(marker);
  if (idx === -1) return null;
  const afterGame = fullPath.substring(idx + marker.length);
  const parts = afterGame.split("\\");
  let fileName = parts.pop() as string;

  const englishFolderIndex = parts.indexOf("english");
  if (englishFolderIndex !== -1 && languageCode !== "english") {
    parts[englishFolderIndex] = languageCode;
  }
  fileName = fileName.replace(/_l_english\.yml$/i, `_l_${languageCode}.yml`);

  return [...parts, "replace", fileName].join("\\");
}

function toModExportRelativePath(fullPath: string, languageCode: string): string | null {
  const parts = findModLocRelativeParts(fullPath);
  if (!parts) return null;
  let fileName = parts.pop() as string;

  const englishFolderIndex = parts.indexOf("english");
  if (englishFolderIndex !== -1 && languageCode !== "english") {
    parts[englishFolderIndex] = languageCode;
  }
  fileName = fileName.replace(/_l_english\.yml$/i, `_l_${languageCode}.yml`);

  return [...parts, "replace", fileName].join("\\");
}

export const victoria3Adapter: GameAdapter = {
  id: "victoria3",
  displayName: "Victoria 3",
  sourceLanguage: "english",
  nativeLanguages: NATIVE_LANGUAGES,
  detectModPath,
  extractCategory,
  extractSubcategory,
  toModRelativePath,
  toModExportRelativePath,
  buildMetadata: (modName, targetLanguage) => ({
    name: modName,
    id: modName.toLowerCase().replace(/\s+/g, "-"),
    version: "0.1.0",
    supported_game_version: "1.*",
    short_description: `${targetLanguage} translation of Victoria 3.`,
    tags: ["Translation"],
    relationships: [],
    game_custom_data: {},
  }),
  buildDescriptor: (modName) => `version="0.1.0"\ntags={\n\t"Translation"\n}\nname="${modName}"\n`,
};