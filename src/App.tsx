import WelcomeScreen from "./WelcomeScreen";
import { findLocFiles } from "./import";
import { useState, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, readDir, writeTextFile, mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import "./App.css";
import { getDb } from "./db";
import type { EditorRow, Project } from "./types";
import { parseLocFile, protectTokens, restoreTokens, validateTokensPreserved } from "./parser";
import { loadGlossaryTerms, matchGlossaryTerms, buildGlossaryInstructions } from "./glossary";
import { GAME_ADAPTERS } from "./games";
import { getContributorName, setContributorName } from "./settings";
import { backupDatabase } from "./backup";
import { exportPortableProjectData } from "./portableExport";
import GlossaryManager from "./GlossaryManager";
import { loadHistory, type HistoryEntry } from "./history";
import { save } from "@tauri-apps/plugin-dialog";
import { documentDir } from "@tauri-apps/api/path";

type ViewMode = "all" | "untranslated" | "translated"  | "ai-draft" | "search" | "category" | "subcategory";

interface SubcategoryCount {
  subcategory: string;
  total: number;
  untranslated: number;
}
interface CategoryCount {
  category: string;
  total: number;
  untranslated: number;
  subcategories: SubcategoryCount[];
}

const BATCH_SIZE = 100;

function App() {
  const [status, setStatus] = useState("");
  const [count, setCount] = useState<number | null>(null);

  const [currentProject, setCurrentProject] = useState<Project | null>(null);

  const [rows, setRows] = useState<EditorRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [contextPanelOpen, setContextPanelOpen] = useState(true);

  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [subcategoryFilter, setSubcategoryFilter] = useState<string | null>(null);

  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const [selectedRow, setSelectedRow] = useState<EditorRow | null>(null);

  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [overnightCount, setOvernightCount] = useState("5000");
  const stopRequestedRef = useRef(false);

  const [contributorName, setContributorNameState] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");

  const [statusCounts, setStatusCounts] = useState({
    untranslated: 0,
    aiDraft: 0,
    confirmed: 0,
    total: 0,
    outdated: 0,
  });

  const [showWelcome, setShowWelcome] = useState(true);

  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const [showGlossaryManager, setShowGlossaryManager] = useState(false);

  function handleProjectSelected(project: Project) {
    setCurrentProject(project);
    setShowWelcome(false);
  }

  useEffect(() => {
    getContributorName().then(setContributorNameState);
  }, []);

  useEffect(() => {
    if (!currentProject) return;
    refreshCounts();
    loadCategories();
  }, [currentProject]);

  useEffect(() => {
    setShowHistory(false);
    setHistoryEntries([]);
  }, [selectedRow?.key]);

  function adapter() {
    if (!currentProject) return null;
    return GAME_ADAPTERS[currentProject.game_id] ?? null;
  }

  // --- Import ---

  async function importFolder() {
    if (!currentProject) return;
    const gm = adapter();
    if (!gm) return;
    setStatus("Waiting for folder selection...");
    const folderPath = await open({ directory: true, multiple: false, defaultPath: currentProject.install_path ?? undefined });
    if (!folderPath) {
      setStatus("No folder selected.");
      return;
    }
    setStatus("Scanning folder for localization files... (please wait!)");
    const files = await findLocFiles(folderPath as string, currentProject.source_language);
    if (files.length === 0) {
      setStatus(`No _l_${currentProject.source_language}.yml files found in that folder.`);
      return;
    }
    const db = await getDb();
    await db.execute(
      "INSERT OR REPLACE INTO games (game_id, display_name, detected_version) VALUES ($1, $2, $3)",
      [currentProject.game_id, adapter()?.displayName ?? currentProject.game_id, "1.0"]
    );
    let totalStrings = 0;
    for (const filePath of files) {
      setStatus(`Reading ${filePath}...`);
      const content = await readTextFile(filePath);
      const parsed = parseLocFile(content);
      const fileName = filePath.split("\\").pop() ?? filePath;
      const contextLabel = fileName.replace(`_l_${currentProject.source_language}.yml`, "").replace(/_/g, " ");
      const category = gm.extractCategory(filePath);
      const subcategory = gm.extractSubcategory(filePath);
      for (const item of parsed) {
        const hash = String(item.text.length) + "-" + item.text.slice(0, 20);
        await db.execute(
          `INSERT OR REPLACE INTO strings (key, game_id, source_text, source_text_hash, file_path, context_label, category, subcategory)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [item.key, currentProject.game_id, item.text, hash, filePath, contextLabel, category, subcategory]
        );
        totalStrings++;
      }
    }
    const countRows = (await db.select(
      "SELECT COUNT(*) as total FROM strings WHERE game_id = $1",
      [currentProject.game_id]
    )) as { total: number }[];
    setCount(countRows[0].total);
    await refreshCounts();
    await loadCategories();
    setStatus(`Import complete. Processed ${files.length} files, ${totalStrings} strings this run.`);
  }

  // --- Unified page loader ---

  async function loadPage(mode: ViewMode, newOffset: number, category?: string, subcategory?: string) {
    if (!currentProject) return;
    setStatus("Loading...");
    const db = await getDb();
    const gameId = currentProject.game_id;
    const lang = currentProject.target_language;

    const baseSelect = `
      SELECT s.key as key, s.game_id as game_id, s.source_text as source_text,
             s.source_text_hash as source_text_hash,
             s.context_label as context_label, s.file_path as file_path,
             t.translated_text as translated_text, t.status as status,
             t.flagged as flagged, t.translated_by as translated_by, t.updated_at as updated_at,
             t.source_hash_at_translation as source_hash_at_translation
      FROM strings s
      LEFT JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id AND t.target_language = $__lang__
      WHERE s.game_id = $__game__
    `;

    let batch: EditorRow[] = [];

    if (mode === "all") {
      const sql = baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") + " ORDER BY s.file_path, s.key LIMIT $3 OFFSET $4";
      batch = (await db.select(sql, [lang, gameId, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "untranslated") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        " AND (t.status IS NULL OR t.status = 'untranslated') ORDER BY s.file_path, s.key LIMIT $3 OFFSET $4";
      batch = (await db.select(sql, [lang, gameId, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "translated") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        " AND t.status = 'human-confirmed' ORDER BY t.updated_at DESC LIMIT $3 OFFSET $4";
      batch = (await db.select(sql, [lang, gameId, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "aidraft") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        " AND t.status = 'ai-suggested' ORDER BY s.file_path, s.key LIMIT $3 OFFSET $4";
      batch = (await db.select(sql, [lang, gameId, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "search") {
      const likeTerm = `%${searchTerm}%`;
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        " AND (s.key LIKE $3 OR s.source_text LIKE $4 OR t.translated_text LIKE $5) LIMIT $6 OFFSET $7";
      batch = (await db.select(sql, [lang, gameId, likeTerm, likeTerm, likeTerm, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "category") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        " AND s.category = $3 ORDER BY s.file_path, s.key LIMIT $4 OFFSET $5";
      batch = (await db.select(sql, [lang, gameId, category, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "subcategory") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        " AND s.category = $3 AND s.subcategory = $4 ORDER BY s.file_path, s.key LIMIT $5 OFFSET $6";
      batch = (await db.select(sql, [lang, gameId, category, subcategory, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "outdated") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        " AND t.source_hash_at_translation IS NOT NULL AND t.source_hash_at_translation != s.source_text_hash ORDER BY s.file_path, s.key LIMIT $3 OFFSET $4";
      batch = (await db.select(sql, [lang, gameId, BATCH_SIZE, newOffset])) as EditorRow[];
    }

    setRows(batch);
    setOffset(newOffset);
    setViewMode(mode);

    const initialDrafts: Record<string, string> = {};
    for (const row of batch) initialDrafts[row.key] = row.translated_text ?? "";
    setDrafts(initialDrafts);

    setStatus(`Showing ${batch.length} result(s) — view: ${mode}, offset ${newOffset}.`);
  }

  function toggleTranslatedView() {
    if (viewMode === "translated") {
      loadPage("all", 0);
    } else {
      loadPage("translated", 0);
    }
  }

  function isOutdated(row: EditorRow): boolean {
    return (
      row.source_hash_at_translation !== null &&
      row.source_hash_at_translation !== row.source_text_hash
    );
  }
  
  function percentComplete(total: number, untranslated: number): number {
    if (total === 0) return 100;
    return Math.round(((total - untranslated) / total) * 100);
  }

  function runSearch() {
    if (!searchTerm.trim()) return;
    loadPage("search", 0);
  }

  function updateDraft(key: string, value: string) {
    setDrafts((prev) => ({ ...prev, [key]: value }));
  }

  function selectCategory(category: string) {
    setCategoryFilter(category);
    setSubcategoryFilter(null);
    loadPage("category", 0, category);
  }

  function selectSubcategory(category: string, subcategory: string) {
    setCategoryFilter(category);
    setSubcategoryFilter(subcategory);
    loadPage("subcategory", 0, category, subcategory);
  }

  // --- Draft / confirm / flag ---

  async function saveDraft(row: EditorRow) {
    if (!currentProject) return;
    const newText = drafts[row.key] ?? "";
    if (newText === (row.translated_text ?? "")) return;

    const newStatus = newText.trim() === "" ? "untranslated" : "human-draft";
    const db = await getDb();
    const lang = currentProject.target_language;

    await db.execute(
      `INSERT OR REPLACE INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, flagged)
       VALUES ($1, $2, $3, $4, $5, $6, datetime('now'), COALESCE((SELECT flagged FROM translations WHERE string_key = $7 AND game_id = $8 AND target_language = $9), 0))`,
      [row.key, row.game_id, lang, newText, newStatus, contributorName, row.key, row.game_id, lang, row.source_text_hash]
    );

    await db.execute(
      `INSERT INTO translation_history (string_key, game_id, target_language, old_text, new_text, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.key, row.game_id, lang, row.translated_text ?? "", newText, contributorName]
    );

    const updated = { ...row, translated_text: newText, status: newStatus };
    setRows((prev) => prev.map((r) => (r.key === row.key ? updated : r)));
    if (selectedRow?.key === row.key) setSelectedRow(updated);
  }

  async function confirmRow(row: EditorRow) {
    if (!currentProject) return;
    const db = await getDb();
    await db.execute(
      `UPDATE translations SET status = 'human-confirmed', translated_by = $1, updated_at = datetime('now'), source_hash_at_translation = $2
       WHERE string_key = $3 AND game_id = $4 AND target_language = $5`,
      [contributorName, row.source_text_hash, row.key, row.game_id, currentProject.target_language]
    );
    const updated = { ...row, status: "human-confirmed", source_hash_at_translation: row.source_text_hash };
    setRows((prev) => prev.map((r) => (r.key === row.key ? updated : r)));
    setSelectedRow(updated);
    refreshCounts();
  }

  async function toggleFlag(row: EditorRow) {
    if (!currentProject) return;
    const newFlagged = row.flagged ? 0 : 1;
    const db = await getDb();
    await db.execute(
      `INSERT OR REPLACE INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, flagged)
       VALUES ($1, $2, $3, $4, $5, $6, datetime('now'), $7)`,
      [
        row.key,
        row.game_id,
        currentProject.target_language,
        row.translated_text ?? "",
        row.status ?? "untranslated",
        row.translated_by ?? contributorName,
        newFlagged,
      ]
    );
    const updated = { ...row, flagged: newFlagged };
    setRows((prev) => prev.map((r) => (r.key === row.key ? updated : r)));
    if (selectedRow?.key === row.key) setSelectedRow(updated);
  }

  async function loadCategories() {
    if (!currentProject) return;
    const db = await getDb();
    const rows = (await db.select(
      `SELECT s.category as category, s.subcategory as subcategory,
              COUNT(*) as total,
              SUM(CASE WHEN t.status IS NULL OR t.status = 'untranslated' THEN 1 ELSE 0 END) as untranslated
       FROM strings s
       LEFT JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id AND t.target_language = $1
       WHERE s.category IS NOT NULL AND s.game_id = $2
       GROUP BY s.category, s.subcategory
       ORDER BY total DESC`,
      [currentProject.target_language, currentProject.game_id]
    )) as { category: string; subcategory: string | null; total: number; untranslated: number }[];

    const grouped: Record<string, CategoryCount> = {};
    for (const row of rows) {
      if (!grouped[row.category]) {
        grouped[row.category] = { category: row.category, total: 0, untranslated: 0, subcategories: [] };
      }
      grouped[row.category].total += row.total;
      grouped[row.category].untranslated += row.untranslated;
      grouped[row.category].subcategories.push({
        subcategory: row.subcategory ?? "general",
        total: row.total,
        untranslated: row.untranslated,
      });
    }

    setCategories(Object.values(grouped).sort((a, b) => b.total - a.total));
  }

  function toggleCategoryExpanded(category: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  async function handleViewHistory() {
    if (!selectedRow || !currentProject) return;
    const entries = await loadHistory(selectedRow.key, selectedRow.game_id, currentProject.target_language);
    setHistoryEntries(entries);
    setShowHistory(true);
  }

  async function revertToVersion(text: string) {
    if (!selectedRow || !currentProject) return;
    const db = await getDb();
    const lang = currentProject.target_language;

    await db.execute(
      `INSERT OR REPLACE INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, flagged, source_hash_at_translation)
       VALUES ($1, $2, $3, $4, 'human-draft', $5, datetime('now'), COALESCE((SELECT flagged FROM translations WHERE string_key = $6 AND game_id = $7 AND target_language = $8), 0), $9)`,
      [selectedRow.key, selectedRow.game_id, lang, text, contributorName, selectedRow.key, selectedRow.game_id, lang, selectedRow.source_text_hash]
    );

    await db.execute(
      `INSERT INTO translation_history (string_key, game_id, target_language, old_text, new_text, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [selectedRow.key, selectedRow.game_id, lang, selectedRow.translated_text ?? "", text, contributorName]
    );

    await loadPage(viewMode, offset, categoryFilter ?? undefined, subcategoryFilter ?? undefined);
    const entries = await loadHistory(selectedRow.key, selectedRow.game_id, lang);
    setHistoryEntries(entries);
    setStatus(`Reverted ${selectedRow.key} to a previous version.`);
  }

  async function handleBackupNow() {
    const docs = await documentDir();
    const defaultPath = await join(docs, `vertaal-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
    const chosenPath = await save({ defaultPath });
    if (!chosenPath) return;
    setStatus("Backing up database...");
    try {
      await backupDatabase(chosenPath);
      setStatus(`Backup saved: ${chosenPath}`);
    } catch (err) {
      setStatus(`Backup failed: ${err}`);
    }
  }

  async function handleExportData() {
    if (!currentProject) return;
    const docs = await documentDir();
    const defaultPath = await join(docs, `${currentProject.game_id}-${currentProject.target_language}-export.json`);
    const chosenPath = await save({ defaultPath });
    if (!chosenPath) return;
    setStatus("Exporting project data...");
    try {
      await exportPortableProjectData(currentProject, chosenPath);
      setStatus(`Project data exported: ${chosenPath}`);
    } catch (err) {
      setStatus(`Export failed: ${err}`);
    }
  }
  
  // --- Mod export ---

  async function writeTextFileWithBom(path: string, content: string) {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const textBytes = new TextEncoder().encode(content);
    const combined = new Uint8Array(bom.length + textBytes.length);
    combined.set(bom, 0);
    combined.set(textBytes, bom.length);
    await writeFile(path, combined);
  }

  async function exportMod() {
    if (!currentProject) return;
    const gm = adapter();
    if (!gm) return;

    setStatus("Choose a folder to export the mod into...");
        const defaultDest = currentProject.output_path ?? (await gm.detectModPath());
    const destFolder = await open({ directory: true, multiple: false, defaultPath: defaultDest });
    if (!destFolder) {
      setStatus("Export cancelled.");
      return;
    }

    const modRoot = await join(destFolder as string, currentProject.mod_name.toLowerCase().replace(/\s+/g, "-"));

    setStatus("Gathering translated strings...");
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
      setStatus("No confirmed translations to export yet.");
      return;
    }

    const byFile: Record<string, { key: string; translated_text: string }[]> = {};
    for (const row of translated) {
      const relPath = gm.toModRelativePath(row.file_path);
      if (!relPath) continue;
      if (!byFile[relPath]) byFile[relPath] = [];
      byFile[relPath].push({ key: row.key, translated_text: row.translated_text });
    }

    setStatus(`Writing ${Object.keys(byFile).length} localization files...`);

    for (const [relPath, entries] of Object.entries(byFile)) {
      const fullOutputPath = await join(modRoot, relPath);
      const folderPath = fullOutputPath.substring(0, fullOutputPath.lastIndexOf("\\"));
      await mkdir(folderPath, { recursive: true });

      let fileContent = `l_${currentProject.source_language}:\n`;
      for (const entry of entries) {
        const safeText = entry.translated_text.replace(/"/g, '\\"');
        fileContent += ` ${entry.key}: "${safeText}"\n`;
      }
      await writeTextFileWithBom(fullOutputPath, fileContent);
    }

    await mkdir(await join(modRoot, ".metadata"), { recursive: true });
    await writeTextFile(
      await join(modRoot, ".metadata", "metadata.json"),
      JSON.stringify(gm.buildMetadata(currentProject.mod_name, currentProject.target_language), null, 2)
    );

    const placeholderPngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const pngBytes = Uint8Array.from(atob(placeholderPngBase64), (c) => c.charCodeAt(0));
    await writeFile(await join(modRoot, ".metadata", "thumbnail.png"), pngBytes);

    await writeTextFile(await join(modRoot, "descriptor.mod"), gm.buildDescriptor(currentProject.mod_name));
    
        const db2 = await getDb();
    await db2.execute("UPDATE projects SET output_path = $1 WHERE id = $2", [destFolder, currentProject.id]);

    setStatus(`Export complete. Wrote ${translated.length} strings across ${Object.keys(byFile).length} files to ${modRoot}`);
  }

  async function refreshCounts() {
    if (!currentProject) return;
    const db = await getDb();
    const result = (await db.select(
      `SELECT
         (SELECT COUNT(*) FROM strings WHERE game_id = $1) as total,
         (SELECT COUNT(*) FROM translations WHERE status = 'human-confirmed' AND game_id = $1 AND target_language = $2) as confirmed,
         (SELECT COUNT(*) FROM translations WHERE status = 'ai-suggested' AND game_id = $1 AND target_language = $2) as ai_draft,
         (SELECT COUNT(*) FROM translations t JOIN strings s ON t.string_key = s.key AND t.game_id = s.game_id
           WHERE t.game_id = $1 AND t.target_language = $2
           AND t.source_hash_at_translation IS NOT NULL AND t.source_hash_at_translation != s.source_text_hash) as outdated`,
      [currentProject.game_id, currentProject.target_language]
    )) as { total: number; confirmed: number; ai_draft: number; outdated: number }[];

    const r = result[0];
    setStatusCounts({
      total: r.total,
      confirmed: r.confirmed,
      aiDraft: r.ai_draft,
      untranslated: r.total - r.confirmed - r.ai_draft,
      outdated: r.outdated,
    });
  }

  // --- AI translation ---

  async function translateAndSave(key: string, gameId: string, sourceText: string): Promise<boolean> {
    if (!currentProject) return false;
    if (!currentProject.ai_model) return false;
    try {
      const { text: protectedText, tokens } = protectTokens(sourceText);
      const terms = await loadGlossaryTerms(gameId, currentProject.target_language);
      const matchedTerms = matchGlossaryTerms(sourceText, terms);

      let glossaryInstruction = "";
      if (matchedTerms.length > 0) {
        const lines = buildGlossaryInstructions(sourceText, matchedTerms).join("\n");
        glossaryInstruction = `\n\nFollow these mandatory terminology rules:\n${lines}`;
      }

      const prompt =
        `You are a professional English (en) to ${currentProject.target_language} translator. Your goal is to accurately convey the meaning and nuances of the original English text while adhering to grammar, vocabulary, and cultural sensitivities. Produce only the translation, without any additional explanations or commentary.${glossaryInstruction}\n\nPlease translate the following English text:\n\n${protectedText}`;

      const response = await fetch("http://localhost:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: currentProject.ai_model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
        }),
      });

      if (!response.ok) return false;

      const data = await response.json();
      const rawTranslation = data.message.content.trim();

      if (!validateTokensPreserved(rawTranslation, tokens.length)) {
        // Model dropped, duplicated, or mangled a protected code — don't trust
        // this output. Treat it the same as a failed request: no database
        // write, caller sees false and can flag/report accordingly.
        return false;
      }

      const finalTranslation = restoreTokens(rawTranslation, tokens);
      const db = await getDb();

      const currentHashRow = (await db.select(
        "SELECT source_text_hash FROM strings WHERE key = $1 AND game_id = $2",
        [key, gameId]
      )) as { source_text_hash: string }[];
      const currentHash = currentHashRow[0]?.source_text_hash ?? null;

      await db.execute(
        `INSERT OR REPLACE INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, flagged, source_hash_at_translation)
         VALUES ($1, $2, $3, $4, 'ai-suggested', $5, datetime('now'), COALESCE((SELECT flagged FROM translations WHERE string_key = $6 AND game_id = $7 AND target_language = $8), 0), $9)`,
        [key, gameId, currentProject.target_language, finalTranslation, currentProject.ai_model, key, gameId, currentProject.target_language, currentHash]
      );      

      await db.execute(
        `INSERT INTO translation_history (string_key, game_id, target_language, old_text, new_text, changed_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [key, gameId, currentProject.target_language, "", finalTranslation, currentProject.ai_model]
      );

      return true;
    } catch {
      return false;
    }
  }

  async function aiTranslateRow(row: EditorRow) {
    setStatus(`Requesting AI translation for ${row.key}...`);
    const ok = await translateAndSave(row.key, row.game_id, row.source_text);
    if (!ok) {
      setStatus(`AI translation failed or produced invalid output for ${row.key}. Try again or translate manually.`);
      return;
    }
    await loadPage(viewMode, offset, categoryFilter ?? undefined, subcategoryFilter ?? undefined);
    setStatus(`AI translated ${row.key}.`);
  }

  async function batchTranslatePage() {
    const targets = rows.filter((r) => !r.status || r.status === "untranslated");
    if (targets.length === 0) {
      setStatus("No untranslated strings on this page.");
      return;
    }
    setBatchRunning(true);
    stopRequestedRef.current = false;
    setBatchProgress({ done: 0, total: targets.length });

    for (let i = 0; i < targets.length; i++) {
      if (stopRequestedRef.current) break;
      const row = targets[i];
      setStatus(`Translating page: ${i + 1}/${targets.length} — ${row.key}`);
      await translateAndSave(row.key, row.game_id, row.source_text);
      setBatchProgress({ done: i + 1, total: targets.length });
    }

    setBatchRunning(false);
    refreshCounts();
    await loadPage(viewMode, offset, categoryFilter ?? undefined, subcategoryFilter ?? undefined);
    setStatus("Page batch complete.");
  }
  
  async function handleBackupNow() {
    const docs = await documentDir();
    const defaultPath = await join(docs, `vertaal-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
    const chosenPath = await save({ defaultPath });
    if (!chosenPath) return;
    setStatus("Backing up database...");
    try {
      await backupDatabase(chosenPath);
      setStatus(`Backup saved: ${chosenPath}`);
    } catch (err) {
      setStatus(`Backup failed: ${err}`);
    }
  }

  async function batchTranslateOvernight() {
    if (!currentProject) return;
    const targetCount = parseInt(overnightCount, 10);
    if (!targetCount || targetCount <= 0) {
      setStatus("Enter a valid number of strings to translate.");
      return;
    }
    setStatus("Backing up database before starting...");
    try {
      await backupDatabase();
    } catch (err) {
      setStatus(`Warning: backup failed (${err}). Continuing anyway.`);
    }

    setBatchRunning(true);
    stopRequestedRef.current = false;
    setBatchProgress({ done: 0, total: targetCount });

    const db = await getDb();
    let done = 0;
    let consecutiveFailures = 0;

    while (done < targetCount && !stopRequestedRef.current) {
      const next = (await db.select(
        `SELECT s.key as key, s.game_id as game_id, s.source_text as source_text
         FROM strings s
         LEFT JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id AND t.target_language = $1
         WHERE (t.status IS NULL OR t.status = 'untranslated') AND s.game_id = $2
         ORDER BY s.file_path, s.key
         LIMIT 1`,
        [currentProject.target_language, currentProject.game_id]
      )) as { key: string; game_id: string; source_text: string }[];

      if (next.length === 0) {
        setStatus("No more untranslated strings remain — batch finished early.");
        break;
      }

      const row = next[0];
      setStatus(`Overnight batch: ${done + 1}/${targetCount} — ${row.key}`);
      const ok = await translateAndSave(row.key, row.game_id, row.source_text);

      if (ok) {
        consecutiveFailures = 0;
        done++;
        setBatchProgress({ done, total: targetCount });
      } else {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          setStatus("Stopped: 3 translations in a row failed — check that Ollama is running.");
          break;
        }
      }
    }

    setBatchRunning(false);
    refreshCounts();
    await loadPage(viewMode, offset, categoryFilter ?? undefined, subcategoryFilter ?? undefined);
    setStatus(`Overnight batch finished. ${done} strings translated.`);
  }

  async function batchRerunAIUnconfirmed() {
    if (!currentProject) return;
    setBatchRunning(true);
    stopRequestedRef.current = false;

    const db = await getDb();
    const targets = (await db.select(
      `SELECT s.key as key, s.game_id as game_id, s.source_text as source_text
       FROM strings s
       JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id AND t.target_language = $1
       WHERE t.status = 'ai-suggested' AND s.game_id = $2`,
      [currentProject.target_language, currentProject.game_id]
    )) as { key: string; game_id: string; source_text: string }[];

    setBatchProgress({ done: 0, total: targets.length });
    let done = 0;
    let consecutiveFailures = 0;

    for (const row of targets) {
      if (stopRequestedRef.current) break;
      setStatus(`Re-running AI: ${done + 1}/${targets.length} — ${row.key}`);
      const ok = await translateAndSave(row.key, row.game_id, row.source_text);
      if (ok) {
        consecutiveFailures = 0;
        done++;
        setBatchProgress({ done, total: targets.length });
      } else {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          setStatus("Stopped: 3 failures in a row.");
          break;
        }
      }
    }

    setBatchRunning(false);
    refreshCounts();
    await loadPage(viewMode, offset, categoryFilter ?? undefined, subcategoryFilter ?? undefined);
    setStatus(`Re-run complete. ${done} strings re-translated.`);
  }

  function stopBatch() {
    stopRequestedRef.current = true;
    setStatus("Stopping batch after current translation finishes...");
  }

    if (contributorName === null) {
    return (
      <div className="welcome-overlay">
        <div className="welcome-window">
          <h1>Welcome to Vertaal</h1>
          <p style={{ color: "var(--text-dim)" }}>
            What name should be shown against your translations? This is used to credit your work if this project is ever shared or collaborated on.
          </p>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Your name"
            style={{ width: "300px" }}
          />
          <br /><br />
          <button
            className="build-mod-button"
            onClick={async () => {
              if (!nameInput.trim()) return;
              await setContributorName(nameInput.trim());
              setContributorNameState(nameInput.trim());
            }}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (showWelcome || !currentProject) {
    return <WelcomeScreen onProjectSelected={handleProjectSelected} />;
  }

  return (
    <div className="app-shell">
      <div className="title-bar">
        <div className="logo-mark" />
        <span className="app-name">Vertaal</span>
        <span className="project-context">
          — {adapter()?.displayName ?? currentProject.game_id} → {currentProject.target_language}
        </span>
        <div className="title-bar-spacer" />
        <button onClick={() => setShowWelcome(true)}>Projects</button>
        <button className="build-mod-button" onClick={exportMod}>
          Build Mod
        </button>
      </div>

      <div className="toolbar">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch();
          }}
          placeholder="Search by key, English, or translated text..."
          style={{ width: "260px" }}
        />
        <button onClick={runSearch}>Search</button>

        <button onClick={() => setShowGlossaryManager(true)}>Manage Glossary</button>

        <button onClick={batchTranslatePage} disabled={batchRunning}>
          AI-Translate This Page
        </button>

        <input
          type="number"
          value={overnightCount}
          onChange={(e) => setOvernightCount(e.target.value)}
          style={{ width: "80px" }}
          disabled={batchRunning}
        />
        <button onClick={batchTranslateOvernight} disabled={batchRunning}>
          Run Overnight Batch
        </button>
        <button onClick={batchRerunAIUnconfirmed} disabled={batchRunning}>
          Re-run AI on Unconfirmed
        </button>

        {batchRunning && (
          <>
            <span style={{ color: "var(--text-dim)" }}>
              {batchProgress.done}/{batchProgress.total}
            </span>
            <button onClick={stopBatch}>Stop</button>
          </>
        )}

        <div className="toolbar-spacer" />

        <button onClick={handleBackupNow}>Backup Now</button>
        <button onClick={handleExportData}>Export Project Data (JSON)</button>
        <button onClick={importFolder}>Import Folder</button>{" "}
      </div>

      <div className="content-columns">
        <div className="sidebar">
          <div className="sidebar-item" onClick={() => loadPage("all", 0)}>
            <span>All Files</span>
            <span className="sidebar-count">{statusCounts.total.toLocaleString()}</span>
          </div>
          <div className="sidebar-item" onClick={() => loadPage("untranslated", 0)}>
            <span>Untranslated</span>
            <span className="sidebar-count">{statusCounts.untranslated.toLocaleString()}</span>
          </div>
          <div className="sidebar-item" onClick={() => loadPage("aidraft", 0)}>
            <span>AI Draft</span>
            <span className="sidebar-count" style={{ opacity: statusCounts.aiDraft === 0 ? 0.4 : 1 }}>
              {statusCounts.aiDraft.toLocaleString()}
            </span>
          </div>
          <div className="sidebar-item" onClick={toggleTranslatedView}>
            <span>Confirmed</span>
            <span className="sidebar-count">{statusCounts.confirmed.toLocaleString()}</span>
          </div>
          <div className="sidebar-item" onClick={() => loadPage("outdated", 0)}>
            <span>⚠ Patch Changed</span>
            <span className="sidebar-count" style={{ opacity: statusCounts.outdated === 0 ? 0.4 : 1 }}>
              {statusCounts.outdated.toLocaleString()}
            </span>
          </div>

          <div style={{ height: "1px", background: "var(--border)", margin: "0.6rem 0" }} />

          {categories.map((cat) => (
            <div key={cat.category}>
              <div className="sidebar-item" onClick={() => selectCategory(cat.category)}>
                <span onClick={(e) => { e.stopPropagation(); toggleCategoryExpanded(cat.category); }}>
                  {expandedCategories.has(cat.category) ? "▾ " : "▸ "}
                  {cat.category.replace(/_/g, " ")}
                </span>
                <span className="sidebar-count" style={{ opacity: cat.untranslated === 0 ? 0.4 : 1 }}>
                  {cat.untranslated.toLocaleString()} left · {percentComplete(cat.total, cat.untranslated)}%
                </span>
              </div>

              {expandedCategories.has(cat.category) &&
                cat.subcategories.map((sub) => (
                  <div
                    key={sub.subcategory}
                    className="sidebar-item"
                    style={{ paddingLeft: "1.8rem" }}
                    onClick={() => selectSubcategory(cat.category, sub.subcategory)}
                  >
                    <span style={{ fontSize: "0.8rem" }}>{sub.subcategory.replace(/_/g, " ")}</span>
                    <span className="sidebar-count" style={{ opacity: sub.untranslated === 0 ? 0.4 : 1 }}>
                      {sub.untranslated.toLocaleString()} left · {percentComplete(sub.total, sub.untranslated)}%
                    </span>
                  </div>
                ))}
            </div>
          ))}
        </div>

        <div className="editor-column">
          <p style={{ color: "var(--text-dim)" }}>{status}</p>
          {rows.length > 0 && (
            <div style={{ margin: "0.5rem 0" }}>
              <button
                onClick={() =>
                  loadPage(viewMode, Math.max(0, offset - BATCH_SIZE), categoryFilter ?? undefined, subcategoryFilter ?? undefined)
                }
                disabled={offset === 0}
              >
                ← Previous 100
              </button>{" "}
              <button
                onClick={() =>
                  loadPage(viewMode, offset + BATCH_SIZE, categoryFilter ?? undefined, subcategoryFilter ?? undefined)
                }
              >
                Next 100 →
              </button>
            </div>
          )}

          {rows.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              {rows.map((row) => {
                const barColor =
                  row.status === "human-confirmed"
                    ? "var(--status-confirmed)"
                    : row.status === "ai-suggested" || row.status === "human-draft"
                    ? "var(--status-ai-draft)"
                    : "var(--status-untranslated)";
                const outdated = isOutdated(row);
                const isSelected = selectedRow?.key === row.key;

                return (
                  <div
                    key={row.key}
                    onClick={() => setSelectedRow(row)}
                    className={isSelected ? "row-selected" : ""}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 10%) minmax(0, 30%) minmax(0, 50%) minmax(0, 10%)",
                      borderLeft: outdated ? "4px solid #e0a04c" : `4px solid ${barColor}`,
                      borderBottom: "1px solid var(--border)",
                      padding: "0.5rem",
                      gap: "0.5rem",
                    }}
                  >
                    <div style={{ overflowWrap: "break-word", minWidth: 0 }}>
                      <div className="row-key" style={{ overflowWrap: "break-word" }}>{row.key}</div>
                      {outdated && <div style={{ color: "#e0a04c", fontSize: "0.7rem" }}>⚠ source changed</div>}
                      <div style={{ color: "var(--text-dim)", fontSize: "0.75rem" }}>{row.context_label}</div>
                    </div>
                    <div style={{ color: "var(--text-dim)", overflowWrap: "break-word" }}>{row.source_text}</div>
                    <div>
                      <textarea
                        value={drafts[row.key] ?? ""}
                        onChange={(e) => updateDraft(row.key, e.target.value)}
                        onFocus={() => setSelectedRow(row)}
                        onBlur={() => saveDraft(row)}
                        placeholder="— not yet translated —"
                        rows={4}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div className="row-actions">
                      <button
                        className="action-btn"
                        title={currentProject.ai_model ? "AI translate" : "No AI model configured for this project"}
                        disabled={!currentProject.ai_model}
                        onClick={(e) => { e.stopPropagation(); aiTranslateRow(row); }}>
                        AI
                      </button>
                      <button className="action-btn confirm" title="Confirm" onClick={(e) => { e.stopPropagation(); confirmRow(row); }}>
                        ✓
                      </button>
                      <button
                        className={row.flagged ? "action-btn flag flagged" : "action-btn flag"}
                        title="Flag for review"
                        onClick={(e) => { e.stopPropagation(); toggleFlag(row); }}
                      >
                        ⚑
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={contextPanelOpen ? "context-panel" : "context-panel context-panel-collapsed"}>
          {contextPanelOpen && (
            <>
              <button className="collapse-toggle" onClick={() => setContextPanelOpen(false)}>
                Collapse →
              </button>
              {selectedRow ? (
                <>
                  <p className="row-key" style={{ color: "var(--text-main)" }}>{selectedRow.key}</p>
                  <p>
                    <strong>Status:</strong>{" "}
                    {selectedRow.status === "human-confirmed"
                      ? "Confirmed"
                      : selectedRow.status === "ai-suggested"
                      ? "AI draft (unconfirmed)"
                      : selectedRow.status === "human-draft"
                      ? "Draft (unconfirmed)"
                      : "Untranslated"}
                  </p>
                  {selectedRow.source_hash_at_translation !== null &&
                    selectedRow.source_hash_at_translation !== selectedRow.source_text_hash && (
                      <p style={{ color: "#e0a04c" }}>⚠ Source text changed since this was translated</p>
                    )}                  
                  {selectedRow.translated_by && (
                    <p>
                      <strong>Last edited by:</strong> {selectedRow.translated_by}
                    </p>
                  )}
                  {selectedRow.updated_at && (
                    <p>
                      <strong>Last updated:</strong> {selectedRow.updated_at}
                    </p>
                  )}
                  {selectedRow.flagged ? <p style={{ color: "#e05a5a" }}>⚑ Flagged for review</p> : null}
                  <p>
                    <strong>Category:</strong> {categoryFilter ?? "—"}
                  </p>
                  <p style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>
                    <strong>Source file:</strong> {selectedRow.file_path}
                  </p>
                  <button onClick={handleViewHistory} style={{ marginTop: "0.5rem" }}>
                    View History for {selectedRow.key}
                  </button>
                  {showHistory && (
                    <div style={{ marginTop: "0.5rem" }}>
                      {historyEntries.length === 0 && <p style={{ fontSize: "0.8rem" }}>No history yet.</p>}
                      {historyEntries.map((h) => (
                        <div
                          key={h.id}
                          style={{
                            borderTop: "1px solid var(--border)",
                            padding: "0.4rem 0",
                            fontSize: "0.8rem",
                          }}
                        >
                          <div style={{ color: "var(--text-dim)" }}>
                            {h.changed_by ?? "unknown"} — {h.changed_at}
                          </div>
                          <div>{h.new_text || <em>(cleared)</em>}</div>
                          <button onClick={() => revertToVersion(h.new_text)} style={{ marginTop: "0.2rem" }}>
                            Restore this version
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p>Select a row to see details here.</p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="status-bar">
        <span>
          <span className="status-dot" style={{ background: "var(--status-untranslated)" }} />
          {statusCounts.untranslated.toLocaleString()} untranslated
        </span>
        <span>
          <span className="status-dot" style={{ background: "var(--status-ai-draft)" }} />
          {statusCounts.aiDraft.toLocaleString()} AI draft
        </span>
        <span>
          <span className="status-dot" style={{ background: "var(--status-confirmed)" }} />
          {statusCounts.confirmed.toLocaleString()} confirmed
        </span>
        <span>{statusCounts.total.toLocaleString()} total strings</span>
      </div>
      {showGlossaryManager && currentProject && (
        <GlossaryManager
          gameId={currentProject.game_id}
          targetLanguage={currentProject.target_language}
          onClose={() => setShowGlossaryManager(false)}
        />
      )}
    </div>
  );
}

export default App;