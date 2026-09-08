import { readTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

export interface ModDescriptorInfo {
  name: string | null;
  identifier: string | null;
  format: "metadata-json" | "descriptor-mod" | "none";
}

export async function readModDescriptor(modFolderPath: string): Promise<ModDescriptorInfo> {
  try {
    const metadataPath = await join(modFolderPath, ".metadata", "metadata.json");
    const raw = await readTextFile(metadataPath);
    const data = JSON.parse(raw);
    return {
      name: typeof data.name === "string" ? data.name : null,
      identifier: data.remote_file_id ?? data.steam_id ?? data.id ?? null,
      format: "metadata-json",
    };
  } catch {
  }

  try {
    const descriptorPath = await join(modFolderPath, "descriptor.mod");
    const raw = await readTextFile(descriptorPath);
    const nameMatch = raw.match(/(?:^|\n)\s*name\s*=\s*"([^"]*)"/);
    const remoteIdMatch = raw.match(/(?:^|\n)\s*remote_file_id\s*=\s*"?(\d+)"?/);
    return {
      name: nameMatch ? nameMatch[1] : null,
      identifier: remoteIdMatch ? remoteIdMatch[1] : null,
      format: "descriptor-mod",
    };
  } catch {
  }

  return { name: null, identifier: null, format: "none" };
}

export function slugifyModName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return slug || "mod";
}