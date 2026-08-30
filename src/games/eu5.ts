import { join, documentDir } from "@tauri-apps/api/path";
import type { GameAdapter } from "./types";

export const EU5_DEFAULT_INSTALL_GUESS =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Europa Universalis V\\game";

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

function toModRelativePath(fullPath: string): string | null {
  const marker = "\\game\\";
  const idx = fullPath.indexOf(marker);
  if (idx === -1) return null;
  const afterGame = fullPath.substring(idx + marker.length);
  const parts = afterGame.split("\\");
  const fileName = parts.pop();
  return [...parts, "replace", fileName].join("\\");
}

export const eu5Adapter: GameAdapter = {
  id: "eu5",
  displayName: "Europa Universalis 5",
  sourceLanguage: "english",
  detectModPath,
  extractCategory,
  extractSubcategory,
  toModRelativePath,
  buildMetadata: (modName, targetLanguage) => ({
    name: modName,
    id: modName.toLowerCase().replace(/\s+/g, "-"),
    version: "0.1.0",
    game_id: "eu5",
    supported_game_version: "1.3.*",
    short_description: `${targetLanguage} translation of Europa Universalis V.`,
    tags: ["Translation"],
    relationships: [],
    game_custom_data: {},
  }),
  buildDescriptor: (modName) => `version="0.1.0"\ntags={\n\t"Translation"\n}\nname="${modName}"\n`,
};