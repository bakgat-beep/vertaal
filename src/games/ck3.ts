import { join, documentDir } from "@tauri-apps/api/path";
import type { GameAdapter } from "./types";
import { findModLocRelativeParts } from "../import";

const NATIVE_LANGUAGES: Record<string, string> = {
  french: "french",
  italian: "italian",
  german: "german",
  spanish: "spanish",
  "brazilian portuguese": "braz_por",
  japanese: "japanese",
  korean: "korean",
  polish: "polish",
  russian: "russian",
  "simplified chinese": "simp_chinese",
};

async function detectModPath(): Promise<string> {
  const docs = await documentDir();
  return await join(docs, "Paradox Interactive", "Crusader Kings III", "mod");
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
  const subfolders = parts.slice(1); // drop the language folder (parts[0]); preserve any real subfolder after it
  const renamedFileName = fileName.replace(/_l_english\.yml$/i, `_l_${languageCode}.yml`);

  return ["localization", "replace", languageCode, ...subfolders, renamedFileName].join("\\");
}

function toModExportRelativePath(fullPath: string, languageCode: string): string | null {
  const rawParts = findModLocRelativeParts(fullPath);
  if (!rawParts) return null;
  const parts = rawParts.slice(1); // drop the "localization" segment; it's hardcoded below
  const fileName = parts.pop() as string;
  const subfolders = parts.slice(1); // drop the language folder (parts[0]); preserve any real subfolder after it
  const renamedFileName = fileName.replace(/_l_english\.yml$/i, `_l_${languageCode}.yml`);

  return ["localization", "replace", languageCode, ...subfolders, renamedFileName].join("\\");
}

function toUnixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export const ck3Adapter: GameAdapter = {
  id: "ck3",
  displayName: "Crusader Kings III",
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
    short_description: `${targetLanguage} translation of Crusader Kings III.`,
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