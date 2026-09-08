import { join, documentDir } from "@tauri-apps/api/path";
import type { GameAdapter } from "./types";
import { findModLocRelativeParts } from "../import";

export const HOI4_DEFAULT_INSTALL_GUESS =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hearts of Iron IV";

const NATIVE_LANGUAGES: Record<string, string> = {
  french: "french",
  german: "german",
  spanish: "spanish",
  "brazilian portuguese": "braz_por",
  polish: "polish",
  russian: "russian",
  japanese: "japanese",
  "simplified chinese": "simp_chinese",
  korean: "korean",
};

async function detectModPath(): Promise<string> {
  const docs = await documentDir();
  return await join(docs, "Paradox Interactive", "Hearts of Iron IV", "mod");
}

function extractCategory(fullPath: string): string {
  const marker = "\\Hearts of Iron IV\\";
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

  return ["localisation", ...parts, "replace", fileName].join("\\");
}

function toModExportRelativePath(fullPath: string, languageCode: string): string | null {
  const rawParts = findModLocRelativeParts(fullPath);
  if (!rawParts) return null;
  const parts = rawParts.slice(1); // drop the "localisation" segment; it's hardcoded below
  let fileName = parts.pop() as string;

  const englishFolderIndex = parts.indexOf("english");
  if (englishFolderIndex !== -1 && languageCode !== "english") {
    parts[englishFolderIndex] = languageCode;
  }
  fileName = fileName.replace(/_l_english\.yml$/i, `_l_${languageCode}.yml`);

  return ["localisation", ...parts, "replace", fileName].join("\\");
}

function toUnixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export const hoi4Adapter: GameAdapter = {
  id: "hoi4",
  displayName: "Hearts of Iron IV",
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
    short_description: `${targetLanguage} translation of Hearts of Iron IV.`,
    tags: ["Translation"],
    relationships: [],
    game_custom_data: {},
  }),
  buildDescriptor: (modName) => `version="0.1.0"\ntags={\n\t"Translation"\n}\nname="${modName}"\n`,
  buildOuterModPointer: (modName, modRootAbsolutePath) => ({
    fileName: `${modName.toLowerCase().replace(/\s+/g, "-")}.mod`,
    content: `version="0.1.0"\ntags={\n\t"Translation"\n}\nname="${modName}"\nsupported_version="1.*"\npath="${toUnixPath(modRootAbsolutePath)}"\n`,
  }),
};