import WelcomeScreen from "./WelcomeScreen";
import { importProjectFolder } from "./import";
import { useState, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import "./App.css";
import { getDb } from "./db";
import type { EditorRow, Project } from "./types";
import { protectTokens } from "./parser";
import { GAME_ADAPTERS } from "./games";
import { getContributorName, setContributorName } from "./settings";
import { backupDatabase } from "./backup";
import { exportPortableProjectData } from "./portableExport";
import { importPortableProjectData } from "./mergeImport";
import GlossaryManager from "./GlossaryManager";
import { loadHistory, type HistoryEntry } from "./history";
import { save } from "@tauri-apps/plugin-dialog";
import { documentDir } from "@tauri-apps/api/path";
import CollaborationPanel from "./CollaborationPanel";
import { TRANSLATION_PROVIDERS } from "./providers";
import ProjectSettings from "./ProjectSettings";
import { exportMod } from "./export";
import { translateAndSave, translateWithRetry } from "./translate";
import { openPath } from "@tauri-apps/plugin-opener";
import ExportSummary, { type ExportPreflight, type ExportOutcome } from "./ExportSummary";

type ViewMode = "all" | "untranslated" | "translated" | "aidraft" | "outdated" | "issues" | "search" | "category" | "subcategory";

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
    issues: 0,
  });

  const [categoryStatusFilter, setCategoryStatusFilter] = useState<Set<string>>(
    new Set(["untranslated", "ai-suggested", "human-confirmed"])
  );

  const [showWelcome, setShowWelcome] = useState(true);

  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const [showGlossaryManager, setShowGlossaryManager] = useState(false);

  const [showCollaboration, setShowCollaboration] = useState(false);

  const [showProjectSettings, setShowProjectSettings] = useState(false);

  const [showExportSummary, setShowExportSummary] = useState(false);
  const [exportPreflight, setExportPreflight] = useState<ExportPreflight | null>(null);

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
  }, [currentProject]);

  useEffect(() => {
    setShowHistory(false);
    setHistoryEntries([]);
  }, [selectedRow?.key]);

  function adapter() {
    if (!currentProject) return null;
    return GAME_ADAPTERS[currentProject.parent_game_id] ?? null;
  }

  // --- Import ---

  async function importFolder() {
    if (!currentProject) return;
    const gm = adapter();
    if (!gm) return;
    const outcome = await importProjectFolder(currentProject, gm, setStatus);
    if (outcome.status === "cancelled") {
      setStatus("No folder selected.");
      return;
    }
    if (outcome.status === "no-files-found") {
      setStatus(`No _l_${currentProject.source_language}.yml files found in that folder.`);
      return;
    }
    if (outcome.status === "error") {
      setStatus(`Import failed: ${outcome.error}`);
      return;
    }
    await refreshCounts();
    setStatus(`Import complete. Processed ${outcome.filesProcessed} files, ${outcome.stringsProcessed} strings this run.`);
  }
  
   function buildStatusClause(filter: Set<string>): string {
    const clauses: string[] = [];
    if (filter.has("untranslated")) clauses.push("(t.status IS NULL OR t.status IN ('untranslated', 'human-draft'))");
    if (filter.has("ai-suggested")) clauses.push("t.status = 'ai-suggested'");
    if (filter.has("human-confirmed")) clauses.push("t.status = 'human-confirmed'");
    if (clauses.length === 0) return "1=0";
    return `(${clauses.join(" OR ")})`;
  }

  async function loadPage(
    mode: ViewMode,
    newOffset: number,
    category?: string,
    subcategory?: string,
    statusFilterOverride?: Set<string>
  ) {
    if (!currentProject) return;
    setStatus("Loading...");
    const db = await getDb();
    const gameId = currentProject.game_id;
    const lang = currentProject.target_language;
    const statusFilter = statusFilterOverride ?? categoryStatusFilter;

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
        ` AND s.category = $3 AND ${buildStatusClause(statusFilter)} ORDER BY s.file_path, s.key LIMIT $4 OFFSET $5`;
      batch = (await db.select(sql, [lang, gameId, category, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "subcategory") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        ` AND s.category = $3 AND s.subcategory = $4 AND ${buildStatusClause(statusFilter)} ORDER BY s.file_path, s.key LIMIT $5 OFFSET $6`;
      batch = (await db.select(sql, [lang, gameId, category, subcategory, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "outdated") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        " AND t.source_hash_at_translation IS NOT NULL AND t.source_hash_at_translation != s.source_text_hash ORDER BY s.file_path, s.key LIMIT $3 OFFSET $4";
      batch = (await db.select(sql, [lang, gameId, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "issues") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        ` AND t.status IN ('human-confirmed', 'ai-suggested', 'human-draft') AND (t.translated_text IS NULL OR TRIM(t.translated_text) = '')
          ORDER BY s.file_path, s.key LIMIT $3 OFFSET $4`;
      batch = (await db.select(sql, [lang, gameId, BATCH_SIZE, newOffset])) as EditorRow[];
    }

    setRows(batch);
    setOffset(newOffset);
    setViewMode(mode);

    const initialDrafts: Record<string, string> = {};
    for (const row of batch) initialDrafts[row.key] = row.translated_text ?? "";
    setDrafts(initialDrafts);

    await loadCategories();
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
    const lang = currentProject.target_language;
    const finalText = (row.translated_text ?? "").trim() !== "" ? row.translated_text! : row.source_text;

    await db.execute(
      `INSERT OR REPLACE INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, source_hash_at_translation, flagged)
       VALUES ($1, $2, $3, $4, 'human-confirmed', $5, datetime('now'), $6, COALESCE((SELECT flagged FROM translations WHERE string_key = $7 AND game_id = $8 AND target_language = $9), 0))`,
      [row.key, row.game_id, lang, finalText, contributorName, row.source_text_hash, row.key, row.game_id, lang]
    );
    const updated = { ...row, translated_text: finalText, status: "human-confirmed", source_hash_at_translation: row.source_text_hash };
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
  
  async function handleImportData() {
    if (!currentProject) return;
    const filePath = await open({ multiple: false, filters: [{ name: "Vertaal export", extensions: ["json"] }] });
    if (!filePath) return;
    setStatus("Importing project data...");
    try {
      const summary = await importPortableProjectData(currentProject, filePath as string);
      setStatus(
        `Import complete: ${summary.applied} applied, ${summary.skippedLocalNewer} skipped (your version was newer), ` +
          `${summary.skippedNoLocalString} skipped (string not found locally), ${summary.glossaryAdded} glossary term(s) added, ${summary.glossaryUpdated} updated.`
      );
      await refreshCounts();
      await loadPage(viewMode, offset, categoryFilter ?? undefined, subcategoryFilter ?? undefined);
    } catch (err) {
      setStatus(`Import failed: ${err}`);
    }
  }

  // --- Mod export ---

  async function openOutputFolder() {
    if (!currentProject?.output_path) return;
    try {
      await openPath(currentProject.output_path);
    } catch (err) {
      setStatus(`Couldn't open folder: ${err}`);
    }
  }

  async function openExportModal() {
    if (!currentProject) return;
    const db = await getDb();
    const result = (await db.select(
      `SELECT
         (SELECT COUNT(*) FROM strings WHERE game_id = $1) as total,
         (SELECT COUNT(*) FROM translations WHERE status = 'human-confirmed' AND translated_text IS NOT NULL
           AND translated_text != '' AND game_id = $1 AND target_language = $2) as confirmed,
         (SELECT COUNT(*) FROM translations t JOIN strings s ON t.string_key = s.key AND t.game_id = s.game_id
           WHERE t.status = 'human-confirmed' AND t.game_id = $1 AND t.target_language = $2
           AND t.source_hash_at_translation IS NOT NULL AND t.source_hash_at_translation != s.source_text_hash) as outdated,
         (SELECT COUNT(*) FROM translations WHERE flagged = 1 AND game_id = $1 AND target_language = $2) as flagged`,
      [currentProject.game_id, currentProject.target_language]
    )) as ExportPreflight[];
    setExportPreflight(result[0]);
    setShowExportSummary(true);
  }

  async function handleExportMod(): Promise<ExportOutcome> {
    if (!currentProject) return { status: "error", error: "No project loaded." };
    return exportMod(currentProject, setStatus);
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
           AND t.source_hash_at_translation IS NOT NULL AND t.source_hash_at_translation != s.source_text_hash) as outdated,
         (SELECT COUNT(*) FROM translations WHERE game_id = $1 AND target_language = $2
           AND status IN ('human-confirmed', 'ai-suggested', 'human-draft')
           AND (translated_text IS NULL OR TRIM(translated_text) = '')) as issues`,
      [currentProject.game_id, currentProject.target_language]
    )) as { total: number; confirmed: number; ai_draft: number; outdated: number; issues: number }[];

    const r = result[0];
    setStatusCounts({
      total: r.total,
      confirmed: r.confirmed,
      aiDraft: r.ai_draft,
      untranslated: r.total - r.confirmed - r.ai_draft,
      outdated: r.outdated,
      issues: r.issues,
    });
    await loadCategories();
  }

  // --- AI translation ---

  async function aiTranslateRow(row: EditorRow) {
    setStatus(`Requesting AI translation for ${row.key}...`);
    const result = await translateAndSave(currentProject, row.key, row.game_id, row.source_text);
    if (!result.ok) {
      setStatus(`AI translation failed for ${row.key}: ${result.error ?? "unknown error"}`);
      return;
    }
    await loadPage(viewMode, offset, categoryFilter ?? undefined, subcategoryFilter ?? undefined);
    setStatus(`AI translated ${row.key}.`);
  }

  async function batchTranslatePage() {
    const targets = rows.filter(
      (r) => (!r.status || r.status === "untranslated" || r.status === "ai-suggested") && !r.flagged
    );
    if (targets.length === 0) {
      setStatus("No untranslated or AI-suggested strings on this page.");
      return;
    }
    setBatchRunning(true);
    stopRequestedRef.current = false;
    setBatchProgress({ done: 0, total: targets.length });

    let succeeded = 0;
    let lastError = "";

    for (let i = 0; i < targets.length; i++) {
      if (stopRequestedRef.current) break;
      const row = targets[i];
      setStatus(`Translating page: ${i + 1}/${targets.length} — ${row.key}`);
      const result = await translateWithRetry(currentProject, row.key, row.game_id, row.source_text, () => stopRequestedRef.current);
      if (result.ok) succeeded++;
      else lastError = result.error ?? "unknown error";
      setBatchProgress({ done: i + 1, total: targets.length });
    }

    setBatchRunning(false);
    refreshCounts();
    await loadPage(viewMode, offset, categoryFilter ?? undefined, subcategoryFilter ?? undefined);
    setStatus(
      succeeded === targets.length
        ? `Page batch complete. ${succeeded} translated.`
        : `Page batch finished: ${succeeded}/${targets.length} translated. Last error: ${lastError}`
    );
  }

  async function confirmAllOnPage() {
    if (!currentProject) return;
    const targets = rows.filter(
      (r) => (r.status !== "human-confirmed" || (r.translated_text ?? "").trim() === "") && !r.flagged
    );
    if (targets.length === 0) {
      setStatus("Nothing to confirm on this page.");
      return;
    }
    const proceed = window.confirm(
      `Confirm all ${targets.length} string(s) on this page? Any row with no translation yet will be confirmed using its original source text as-is.`
    );
    if (!proceed) return;

    setStatus(`Confirming ${targets.length} strings...`);
    const db = await getDb();
    const lang = currentProject.target_language;

    for (const row of targets) {
      const finalText = (row.translated_text ?? "").trim() !== "" ? row.translated_text : row.source_text;
      await db.execute(
        `INSERT OR REPLACE INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, source_hash_at_translation, flagged)
         VALUES ($1, $2, $3, $4, 'human-confirmed', $5, datetime('now'), $6, COALESCE((SELECT flagged FROM translations WHERE string_key = $7 AND game_id = $8 AND target_language = $9), 0))`,
        [row.key, row.game_id, lang, finalText, contributorName, row.source_text_hash, row.key, row.game_id, lang]
      );
    }

    refreshCounts();
    await loadPage(viewMode, offset, categoryFilter ?? undefined, subcategoryFilter ?? undefined);
    setStatus(`Confirmed ${targets.length} strings on this page.`);
  }

    async function copySourceText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied source text to clipboard.");
    } catch (err) {
      setStatus(`Couldn't copy to clipboard: ${err}`);
    }
  }

  function estimateRows(text: string): number {
    if (!text) return 4;
    const explicitLines = (text.match(/\n/g) ?? []).length + 1;
    const wrapLines = Math.ceil(text.length / 55);
    return Math.min(16, Math.max(4, Math.max(explicitLines, wrapLines) + 1));
  }

    async function batchAutoAcceptProtectedOnly() {
    if (!currentProject) return;
    const db = await getDb();
    const gameId = currentProject.game_id;
    const lang = currentProject.target_language;

    const candidates = (await db.select(
      `SELECT s.key as key, s.source_text as source_text, s.source_text_hash as source_text_hash
       FROM strings s
       LEFT JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id AND t.target_language = $1
       WHERE s.game_id = $2 AND (t.status IS NULL OR t.status = 'untranslated') AND (t.flagged IS NULL OR t.flagged = 0)`,
      [lang, gameId]
    )) as { key: string; source_text: string; source_text_hash: string }[];

    const matches = candidates.filter((c) => {
      const { text } = protectTokens(c.source_text);
      return text.replace(/__TOKEN_\d+__/g, "").trim() === "";
    });

    if (matches.length === 0) {
      setStatus("No fully-protected (code-only) strings found among untranslated strings.");
      return;
    }

    const proceed = window.confirm(
      `Found ${matches.length} untranslated string(s) made up entirely of functions/icons/variables, with no actual translatable text. Mark them all as AI draft using the source text as-is?`
    );
    if (!proceed) return;

    setStatus(`Marking ${matches.length} code-only strings as AI draft...`);
    for (const m of matches) {
      await db.execute(
        `INSERT OR REPLACE INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, flagged, source_hash_at_translation)
         VALUES ($1, $2, $3, $4, 'ai-suggested', $5, datetime('now'), COALESCE((SELECT flagged FROM translations WHERE string_key = $6 AND game_id = $7 AND target_language = $8), 0), $9)`,
        [m.key, gameId, lang, m.source_text, "auto (code-only)", m.key, gameId, lang, m.source_text_hash]
      );
    }

    refreshCounts();
    await loadPage(viewMode, offset, categoryFilter ?? undefined, subcategoryFilter ?? undefined);
    setStatus(`Marked ${matches.length} code-only strings as AI draft.`);
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
    let distinctFailureStreak = 0;

    while (done < targetCount && !stopRequestedRef.current) {
      const next = (await db.select(
        `SELECT s.key as key, s.game_id as game_id, s.source_text as source_text
         FROM strings s
         LEFT JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id AND t.target_language = $1
         WHERE (t.status IS NULL OR t.status = 'untranslated') AND (t.flagged IS NULL OR t.flagged = 0) AND s.game_id = $2
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
      const result = await translateWithRetry(currentProject, row.key, row.game_id, row.source_text, () => stopRequestedRef.current);

      if (result.ok) {
        distinctFailureStreak = 0;
        done++;
        setBatchProgress({ done, total: targetCount });
      } else {
        distinctFailureStreak++;
        if (distinctFailureStreak >= 3) {
          setStatus(`Stopped: 3 different strings failed after retries. Last error: ${result.error ?? "unknown"}`);
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
      const result = await translateWithRetry(currentProject, row.key, row.game_id, row.source_text, () => stopRequestedRef.current);
      if (result.ok) {
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

  const currentProviderRequiresModel =
    TRANSLATION_PROVIDERS[currentProject.translation_provider_id ?? "ollama"]?.requiresModel ?? true;

  return (
    <div className="app-shell">
      <div className="title-bar">
        <div className="logo-mark" />
        <span className="app-name">Vertaal</span>
        <span className="project-context">
          — {adapter()?.displayName ?? currentProject.parent_game_id}
          {currentProject.project_type === "mod" ? ` — Mod: ${currentProject.source_mod_name ?? "?"}` : ""} →{" "}
          {currentProject.target_language}
        </span>
        <div className="title-bar-spacer" />
        <button onClick={() => setShowWelcome(true)}>Projects</button>
        <button
          onClick={openOutputFolder}
          disabled={!currentProject.output_path}
          title={
            currentProject.output_path
              ? "Open this project's last export folder in File Explorer"
              : "Export this project at least once (Build Mod) before there's a folder to open"
          }
        >
          Open Output Folder
        </button>
        <button onClick={() => setShowProjectSettings(true)}>Project Settings</button>
        <button className="build-mod-button" onClick={openExportModal}>
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
          placeholder="Search..."
          title="Search by key, source text, or translated text"
          style={{ width: "180px" }}
        />
        <button onClick={runSearch} title="Run the search above">
          Search
        </button>

        <button onClick={() => setShowGlossaryManager(true)} title="View and edit your saved glossary terms">
          Glossary
        </button>

        <button
          onClick={batchTranslatePage}
          disabled={batchRunning}
          title="AI-translate every untranslated or AI-suggested string on this page, using the current provider"
        >
          AI: Page
        </button>
        <button
          onClick={batchAutoAcceptProtectedOnly}
          disabled={batchRunning}
          title="Find untranslated strings made entirely of tokens/icons/variables (no real text) across the whole project, and mark them AI draft using the source text as-is"
        >
          Auto-Accept Code
        </button>
        <button
          onClick={confirmAllOnPage}
          disabled={batchRunning}
          title="Confirm every non-flagged string on this page; anything with no translation yet is confirmed using the source text as-is"
        >
          Confirm Page
        </button>

        <input
          type="number"
          value={overnightCount}
          onChange={(e) => setOvernightCount(e.target.value)}
          style={{ width: "70px" }}
          disabled={batchRunning}
          title="How many strings to translate in the overnight batch below"
        />
        <button
          onClick={batchTranslateOvernight}
          disabled={batchRunning}
          title="AI-translate untranslated strings across the whole project, up to the count above"
        >
          Run Batch
        </button>
        <button
          onClick={batchRerunAIUnconfirmed}
          disabled={batchRunning}
          title="Re-run AI translation on every AI-suggested (unconfirmed) string across the whole project, using the current provider — useful after switching providers"
        >
          Retry AI: All
        </button>

        {batchRunning && (
          <>
            <span style={{ color: "var(--text-dim)" }}>
              {batchProgress.done}/{batchProgress.total}
            </span>
            <button onClick={stopBatch} title="Stop the batch operation currently running">
              Stop
            </button>
          </>
        )}

        <div className="toolbar-spacer" />

        <button onClick={handleBackupNow} title="Backs up the ENTIRE app database — every project, every game, not just this one">
          Backup App
        </button>
        <button
          onClick={handleExportData}
          title="Export this project's translations + glossary as a shareable JSON file — for sending progress to a collaborator without Git, or moving to another computer. (Backup Now saves the whole app database instead; Collaboration does this automatically via GitHub.)"
        >
          Export JSON
        </button>
                <button
          onClick={handleImportData}
          title="Import a JSON file exported from another Vertaal install (via Export JSON) and merge its translations into this project"
        >
          Import JSON
        </button>
        <button onClick={importFolder} title="Import a localisation folder from the game install">
          Import
        </button>{" "}
        <button onClick={() => setShowCollaboration(true)} title="Git/GitHub collaboration: sync, pull, and merge with teammates">
          Collab
        </button>
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
          <div className="sidebar-item" onClick={() => loadPage("issues", 0)} title="Rows marked confirmed/AI-suggested/drafted with no actual text saved">
            <span>⚠ Check for Issues</span>
            <span className="sidebar-count" style={{ opacity: statusCounts.issues === 0 ? 0.4 : 1 }}>
              {statusCounts.issues.toLocaleString()}
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
          {(viewMode === "category" || viewMode === "subcategory") && (
            <div style={{ display: "flex", gap: "0.5rem", margin: "0.5rem 0", alignItems: "center" }}>
              <span style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>Show:</span>
              {(
                [
                  { key: "untranslated", label: "Untranslated" },
                  { key: "ai-suggested", label: "AI Draft" },
                  { key: "human-confirmed", label: "Confirmed" },
                ] as const
              ).map((bucket) => {
                const active = categoryStatusFilter.has(bucket.key);
                return (
                  <button
                    key={bucket.key}
                    onClick={() => {
                      const next = new Set(categoryStatusFilter);
                      if (active) {
                        if (next.size === 1) return; // keep at least one bucket selected
                        next.delete(bucket.key);
                      } else {
                        next.add(bucket.key);
                      }
                      setCategoryStatusFilter(next);
                      loadPage(viewMode, 0, categoryFilter ?? undefined, subcategoryFilter ?? undefined, next);
                    }}
                    style={{ opacity: active ? 1 : 0.5 }}
                  >
                    {active ? "✓ " : ""}
                    {bucket.label}
                  </button>
                );
              })}
            </div>
          )}

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
                    <div
                      style={{ color: "var(--text-dim)", overflowWrap: "break-word", cursor: "pointer" }}
                      title="Click to copy source text"
                      onClick={(e) => { e.stopPropagation(); copySourceText(row.source_text); }}
                    >
                      {row.source_text}
                    </div>
                    <div>
                      <textarea
                        value={drafts[row.key] ?? ""}
                        onChange={(e) => updateDraft(row.key, e.target.value)}
                        onFocus={() => setSelectedRow(row)}
                        onBlur={() => saveDraft(row)}
                        placeholder="— not yet translated —"
                        rows={estimateRows(drafts[row.key] ?? "")}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div className="row-actions">
                      <button
                        className="action-btn"
                        title={
                          currentProviderRequiresModel && !currentProject.ai_model
                            ? "No model configured for this provider — set one in Project Settings"
                            : "AI translate"
                        }
                        disabled={currentProviderRequiresModel && !currentProject.ai_model}
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
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status}</span>
        <div style={{ display: "flex", gap: "1.2rem", flexShrink: 0 }}>
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
      </div>
      {showGlossaryManager && currentProject && (
        <GlossaryManager
          gameId={currentProject.game_id}
          targetLanguage={currentProject.target_language}
          onClose={() => setShowGlossaryManager(false)}
        />
      )}
      {showCollaboration && currentProject && (
        <CollaborationPanel
          project={currentProject}
          onProjectUpdated={(p) => setCurrentProject(p)}
          onDataChanged={async () => {
            await refreshCounts();
            await loadPage(viewMode, offset, categoryFilter ?? undefined, subcategoryFilter ?? undefined);
          }}
          onClose={() => setShowCollaboration(false)}
        />
      )}
      {showProjectSettings && currentProject && (
        <ProjectSettings
          project={currentProject}
          onProjectUpdated={(p) => setCurrentProject(p)}
          onClose={() => setShowProjectSettings(false)}
        />
      )}
      {showExportSummary && exportPreflight && currentProject && (
        <ExportSummary
          preflight={exportPreflight}
          isMod={currentProject.project_type === "mod"}
          sourceModName={currentProject.source_mod_name}
          outputModName={currentProject.mod_name}
          liveStatus={status}
          onProceed={handleExportMod}
          onClose={() => setShowExportSummary(false)}
        />
      )}
    </div>
  );
}

export default App;