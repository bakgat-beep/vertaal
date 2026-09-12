import { open } from "@tauri-apps/plugin-dialog";
import { mkdir, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { getDb } from "./db";
import type { Project } from "./types";
import { GAME_ADAPTERS } from "./games";
import { escapeForLocExport } from "./parser";
import { buildCompanionDescriptor } from "./modExport";
import type { ExportOutcome } from "./ExportSummary";

// Both exportMod() and exportModCompanion() write the same shape of output —
// one loc file per relPath, each entry as "key: "text"" — just built from a
// different game-adapter method and metadata. Previously that write loop was
// duplicated verbatim in both functions; this is the one copy both call.
async function writeModLocFiles(
  modRoot: string,
  languageCode: string,
  byFile: Record<string, { key: string; translated_text: string }[]>
) {
  for (const [relPath, entries] of Object.entries(byFile)) {
    const fullOutputPath = await join(modRoot, relPath);
    const folderPath = fullOutputPath.substring(0, fullOutputPath.lastIndexOf("\\"));
    await mkdir(folderPath, { recursive: true });

    let fileContent = `l_${languageCode}:\n`;
    for (const entry of entries) {
      const safeText = escapeForLocExport(entry.translated_text);
      fileContent += ` ${entry.key}: "${safeText}"\n`;
    }
    await writeTextFileWithBom(fullOutputPath, fileContent);
  }
}

async function writeTextFileWithBom(path: string, content: string) {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const textBytes = new TextEncoder().encode(content);
  const combined = new Uint8Array(bom.length + textBytes.length);
  combined.set(bom, 0);
  combined.set(textBytes, bom.length);
  await writeFile(path, combined);
}

const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function writePlaceholderThumbnail(modRoot: string) {
  const pngBytes = Uint8Array.from(atob(PLACEHOLDER_PNG_BASE64), (c) => c.charCodeAt(0));
  await writeFile(await join(modRoot, ".metadata", "thumbnail.png"), pngBytes);
}

// Exports a vanilla-project's confirmed translations as a standalone mod.
// onStatus mirrors what used to be direct setStatus(...) calls in App.tsx —
// the caller decides what to do with the progress messages (App.tsx shows
// them in its status bar).
export async function exportMod(currentProject: Project, onStatus: (msg: string) => void): Promise<ExportOutcome> {
  if (currentProject.project_type === "mod") {
    return exportModCompanion(currentProject, onStatus);
  }
  const gm = GAME_ADAPTERS[currentProject.parent_game_id] ?? null;
  if (!gm) return { status: "error", error: "Could not resolve this project's game." };

  try {
    onStatus("Choose a folder to export the mod into...");
    const defaultDest = currentProject.output_path ?? (await gm.detectModPath());
    const destFolder = await open({ directory: true, multiple: false, defaultPath: defaultDest });
    if (!destFolder) return { status: "cancelled" };

    const modRoot = await join(destFolder as string, currentProject.mod_name.toLowerCase().replace(/\s+/g, "-"));

    onStatus("Gathering translated strings...");
    const db = await getDb();

    const translated = (await db.select(
      `SELECT s.key as key, s.file_path as file_path, t.translated_text as translated_text
       FROM strings s
       JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id
       WHERE t.status = 'human-confirmed' AND t.translated_text IS NOT NULL AND t.translated_text != ''
         AND s.game_id = $1 AND t.target_language = $2`,
      [currentProject.game_id, currentProject.target_language]
    )) as { key: string; file_path: string; translated_text: string }[];

    if (translated.length === 0) {
      return { status: "error", error: "No confirmed translations to export yet." };
    }

    const nativeCode = gm.nativeLanguages[currentProject.target_language.toLowerCase()];
    const languageCode = nativeCode ?? currentProject.source_language;
    if (nativeCode) {
      onStatus(`Exporting as a native "${currentProject.target_language}" language mod...`);
    }

    const byFile: Record<string, { key: string; translated_text: string }[]> = {};
    for (const row of translated) {
      const relPath = gm.toModRelativePath(row.file_path, languageCode);
      if (!relPath) continue;
      if (!byFile[relPath]) byFile[relPath] = [];
      byFile[relPath].push({ key: row.key, translated_text: row.translated_text });
    }

    onStatus(`Writing ${Object.keys(byFile).length} localization files...`);
    await writeModLocFiles(modRoot, languageCode, byFile);

    await mkdir(await join(modRoot, ".metadata"), { recursive: true });
    await writeTextFile(
      await join(modRoot, ".metadata", "metadata.json"),
      JSON.stringify(gm.buildMetadata(currentProject.mod_name, currentProject.target_language), null, 2)
    );
    await writePlaceholderThumbnail(modRoot);

    await writeTextFile(await join(modRoot, "descriptor.mod"), gm.buildDescriptor(currentProject.mod_name));

    if (gm.buildOuterModPointer) {
      const pointer = gm.buildOuterModPointer(currentProject.mod_name, modRoot);
      await writeTextFile(await join(destFolder as string, pointer.fileName), pointer.content);
    }

    await db.execute("UPDATE projects SET output_path = $1 WHERE id = $2", [destFolder, currentProject.id]);

    return {
      status: "ok",
      stringsWritten: translated.length,
      filesWritten: Object.keys(byFile).length,
      destPath: modRoot,
    };
  } catch (err) {
    return { status: "error", error: String(err) };
  }
}

// Exports a mod-project's confirmed translations as a standalone "companion"
// mod (never edits the source mod's own files directly).
export async function exportModCompanion(
  currentProject: Project,
  onStatus: (msg: string) => void
): Promise<ExportOutcome> {
  const gm = GAME_ADAPTERS[currentProject.parent_game_id] ?? null;
  if (!gm) return { status: "error", error: "Could not resolve this project's game." };
  if (!gm.toModExportRelativePath) {
    return { status: "error", error: `Mod export isn't supported yet for ${gm.displayName}.` };
  }
  if (!currentProject.source_mod_name) {
    return { status: "error", error: "This project is missing the source mod's name — check Project Settings." };
  }

  try {
    onStatus("Choose a folder to export the companion mod into...");
    const defaultDest = currentProject.output_path ?? (await gm.detectModPath());
    const destFolder = await open({ directory: true, multiple: false, defaultPath: defaultDest });
    if (!destFolder) return { status: "cancelled" };

    const modRoot = await join(destFolder as string, currentProject.mod_name.toLowerCase().replace(/\s+/g, "-"));

    onStatus("Gathering translated strings...");
    const db = await getDb();

    const translated = (await db.select(
      `SELECT s.key as key, s.file_path as file_path, t.translated_text as translated_text
       FROM strings s
       JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id
       WHERE t.status = 'human-confirmed' AND t.translated_text IS NOT NULL AND t.translated_text != ''
         AND s.game_id = $1 AND t.target_language = $2`,
      [currentProject.game_id, currentProject.target_language]
    )) as { key: string; file_path: string; translated_text: string }[];

    if (translated.length === 0) {
      return { status: "error", error: "No confirmed translations to export yet." };
    }

    const nativeCode = gm.nativeLanguages[currentProject.target_language.toLowerCase()];
    const languageCode = nativeCode ?? currentProject.source_language;
    if (nativeCode) {
      onStatus(`Exporting as a native "${currentProject.target_language}" language mod...`);
    }

    const byFile: Record<string, { key: string; translated_text: string }[]> = {};
    for (const row of translated) {
      const relPath = gm.toModExportRelativePath(row.file_path, languageCode);
      if (!relPath) continue;
      if (!byFile[relPath]) byFile[relPath] = [];
      byFile[relPath].push({ key: row.key, translated_text: row.translated_text });
    }

    onStatus(`Writing ${Object.keys(byFile).length} localization files...`);
    await writeModLocFiles(modRoot, languageCode, byFile);

    await mkdir(await join(modRoot, ".metadata"), { recursive: true });
    const metadata = {
      ...gm.buildMetadata(currentProject.mod_name, currentProject.target_language),
      short_description: `${currentProject.target_language} translation of the mod "${currentProject.source_mod_name}".`,
    };
    await writeTextFile(await join(modRoot, ".metadata", "metadata.json"), JSON.stringify(metadata, null, 2));
    await writePlaceholderThumbnail(modRoot);

    await writeTextFile(
      await join(modRoot, "descriptor.mod"),
      buildCompanionDescriptor(currentProject.mod_name, currentProject.source_mod_name)
    );

    if (gm.buildOuterModPointer) {
      const pointer = gm.buildOuterModPointer(currentProject.mod_name, modRoot);
      await writeTextFile(await join(destFolder as string, pointer.fileName), pointer.content);
    }

    await db.execute("UPDATE projects SET output_path = $1 WHERE id = $2", [destFolder, currentProject.id]);

    return {
      status: "ok",
      stringsWritten: translated.length,
      filesWritten: Object.keys(byFile).length,
      destPath: modRoot,
    };
  } catch (err) {
    return { status: "error", error: String(err) };
  }
}