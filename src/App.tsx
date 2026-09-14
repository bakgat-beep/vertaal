import WelcomeScreen from "./WelcomeScreen";
import { importProjectFolder } from "./import";
import { useState, useEffect } from "react";
import logoGlobe from "./assets/logo-globe-white.png";
import { usePanels } from "./hooks/usePanels";
import { useBatchTranslation } from "./hooks/useBatchTranslation";
import { useEditorRows } from "./hooks/useEditorRows";
import { useProjectStats } from "./hooks/useProjectStats";
import { open } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import "./App.css";
import { getDb } from "./db";
import type { EditorRow, Project } from "./types";
import { GAME_ADAPTERS } from "./games";
import { protectTokens } from "./parser";
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
import { translateAndSave } from "./translate";
import { openPath } from "@tauri-apps/plugin-opener";
import ExportSummary, { type ExportPreflight, type ExportOutcome } from "./ExportSummary";

export type ViewMode = "all" | "untranslated" | "translated" | "aidraft" | "outdated" | "issues" | "flagged" | "search" | "category" | "subcategory";

export interface SubcategoryCount {
  subcategory: string;
  total: number;
  untranslated: number;
}
export interface CategoryCount {
  category: string;
  total: number;
  untranslated: number;
  subcategories: SubcategoryCount[];
}

export const BATCH_SIZE = 100;

function App() {
  const [status, setStatus] = useState("");

  const [currentProject, setCurrentProject] = useState<Project | null>(null);

  const [contextPanelOpen, setContextPanelOpen] = useState(true);

  const [selectedRow, setSelectedRow] = useState<EditorRow | null>(null);

  const [contributorName, setContributorNameState] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");

  const {
    statusCounts,
    categories,
    expandedCategories,
    refreshCounts,
    loadCategories,
    toggleCategoryExpanded,
  } = useProjectStats(currentProject);

  const {
    rows,
    offset,
    drafts,
    viewMode,
    searchTerm,
    setSearchTerm,
    categoryFilter,
    subcategoryFilter,
    categoryStatusFilter,
    setCategoryStatusFilter,
    loadPage,
    toggleTranslatedView,
    runSearch,
    updateDraft,
    selectCategory,
    selectSubcategory,
    saveDraft,
    confirmRow,
    toggleFlag,
  } = useEditorRows({
    currentProject,
    contributorName,
    selectedRow,
    setSelectedRow,
    loadCategories,
    refreshCounts,
    setStatus,
  });

  const {
    batchRunning,
    batchProgress,
    overnightCount,
    setOvernightCount,
    batchTranslatePage,
    batchAutoAcceptProtectedOnly,
    batchTranslateOvernight,
    batchRerunAIUnconfirmed,
    stopBatch,
  } = useBatchTranslation({
    currentProject,
    rows,
    viewMode,
    offset,
    categoryFilter,
    subcategoryFilter,
    loadPage,
    refreshCounts,
    setStatus,
  });

  const [showWelcome, setShowWelcome] = useState(true);

  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const { panels, openPanel, closePanel } = usePanels();
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

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
    closePanel("history");
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

  function statusMeta(row: EditorRow): { label: string; className: string; barColor: string } {
    if (row.status === "human-confirmed") {
      return { label: "confirmed", className: "status-chip-confirmed", barColor: "var(--status-confirmed)" };
    }
    if (row.status === "ai-suggested" || row.status === "human-draft") {
      return { label: row.status === "ai-suggested" ? "ai draft" : "draft", className: "status-chip-aidraft", barColor: "var(--status-ai-draft)" };
    }
    return { label: "untranslated", className: "status-chip-untranslated", barColor: "var(--status-untranslated)" };
  }

  // Renders source text with protected tokens/variables/icons visually
  // highlighted, using the same token pattern the translation pipeline
  // protects before sending text to an AI provider.
  function renderHighlightedSource(sourceText: string) {
    const { text, tokens } = protectTokens(sourceText);
    return text.split(/(__TOKEN_\d+__)/g).map((part, i) => {
      const match = part.match(/^__TOKEN_(\d+)__$/);
      if (!match) return part;
      return (
        <span key={i} className="protected-token">
          {tokens[parseInt(match[1], 10)]}
        </span>
      );
    });
  }


  async function handleViewHistory() {
    if (!selectedRow || !currentProject) return;
    const entries = await loadHistory(selectedRow.key, selectedRow.game_id, currentProject.target_language);
    setHistoryEntries(entries);
    openPanel("history");
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
    openPanel("exportSummary");
  }

  async function handleExportMod(): Promise<ExportOutcome> {
    if (!currentProject) return { status: "error", error: "No project loaded." };
    return exportMod(currentProject, setStatus);
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

  async function confirmAndNext(row: EditorRow, index: number) {
    await confirmRow(row);
    const next = rows[index + 1];
    if (next) setSelectedRow(next);
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
        <img src={logoGlobe} alt="" className="logo-mark" />
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
        <button onClick={() => openPanel("projectSettings")}>Project Settings</button>
        <button className="build-mod-button" onClick={openExportModal}>
          Build Mod
        </button>
      </div>

      <div className="toolbar">
        <div className="toolbar-group">
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
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button onClick={() => openPanel("glossary")} title="View and edit your saved glossary terms">
            Glossary
          </button>
          <button
            className="btn-accent-soft"
            onClick={confirmAllOnPage}
            disabled={batchRunning}
            title="Confirm every non-flagged string on this page; anything with no translation yet is confirmed using the source text as-is"
          >
            Confirm Page
          </button>
        </div>

        {batchRunning && (
          <>
            <div className="toolbar-divider" />
            <span style={{ color: "var(--text-dim)" }}>
              {batchProgress.done}/{batchProgress.total}
            </span>
            <button onClick={stopBatch} title="Stop the batch operation currently running">
              Stop
            </button>
          </>
        )}

        <div className="toolbar-spacer" />

        <div className="more-menu">
          <button onClick={() => setMoreMenuOpen((v) => !v)} title="Less-frequent actions: batch/AI, backup, import/export, collaboration">
            More actions ▾
          </button>
          {moreMenuOpen && (
            <div className="more-menu-dropdown">
              <div className="more-menu-section-label">Batch / AI</div>
              <button
                onClick={() => { batchTranslatePage(); setMoreMenuOpen(false); }}
                disabled={batchRunning}
                title="AI-translate every untranslated or AI-suggested string on this page, using the current provider"
              >
                AI: Page
              </button>
              <button
                onClick={() => { batchAutoAcceptProtectedOnly(); setMoreMenuOpen(false); }}
                disabled={batchRunning}
                title="Find untranslated strings made entirely of tokens/icons/variables (no real text) across the whole project, and mark them AI draft using the source text as-is"
              >
                Auto-Accept Code
              </button>
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <input
                  type="number"
                  value={overnightCount}
                  onChange={(e) => setOvernightCount(e.target.value)}
                  style={{ width: "70px" }}
                  disabled={batchRunning}
                  title="How many strings to translate in the overnight batch below"
                />
                <button
                  onClick={() => { batchTranslateOvernight(); setMoreMenuOpen(false); }}
                  disabled={batchRunning}
                  title="AI-translate untranslated strings across the whole project, up to the count above"
                  style={{ flex: 1 }}
                >
                  Run Batch
                </button>
              </div>
              <button
                onClick={() => { batchRerunAIUnconfirmed(); setMoreMenuOpen(false); }}
                disabled={batchRunning}
                title="Re-run AI translation on every AI-suggested (unconfirmed) string across the whole project, using the current provider — useful after switching providers"
              >
                Retry AI: All
              </button>

              <div className="more-menu-section-label">Data &amp; collaboration</div>
              <button onClick={() => { handleBackupNow(); setMoreMenuOpen(false); }} title="Backs up the ENTIRE app database — every project, every game, not just this one">
                Backup App
              </button>
              <button
                onClick={() => { handleExportData(); setMoreMenuOpen(false); }}
                title="Export this project's translations + glossary as a shareable JSON file — for sending progress to a collaborator without Git, or moving to another computer. (Backup Now saves the whole app database instead; Collaboration does this automatically via GitHub.)"
              >
                Export JSON
              </button>
              <button
                onClick={() => { handleImportData(); setMoreMenuOpen(false); }}
                title="Import a JSON file exported from another Vertaal install (via Export JSON) and merge its translations into this project"
              >
                Import JSON
              </button>
              <button onClick={() => { importFolder(); setMoreMenuOpen(false); }} title="Import a localisation folder from the game install">
                Import
              </button>
              <button onClick={() => { openPanel("collaboration"); setMoreMenuOpen(false); }} title="Git/GitHub collaboration: sync, pull, and merge with teammates">
                Collab
              </button>
            </div>
          )}
        </div>
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
          <div className="sidebar-item" onClick={() => loadPage("flagged", 0)} title="Strings you've flagged for follow-up">
            <span>🚩 Flagged</span>
            <span className="sidebar-count" style={{ opacity: statusCounts.flagged === 0 ? 0.4 : 1 }}>
              {statusCounts.flagged.toLocaleString()}
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
                  {cat.untranslated.toLocaleString()} left
                </span>
              </div>
              <div className="progress-track" style={{ margin: "0 1rem 0.4rem", opacity: cat.untranslated === 0 ? 0.4 : 1 }}>
                <div className="progress-fill" style={{ width: `${percentComplete(cat.total, cat.untranslated)}%` }} />
              </div>

              {expandedCategories.has(cat.category) &&
                cat.subcategories.map((sub) => (
                  <div key={sub.subcategory}>
                    <div
                      className="sidebar-item"
                      style={{ paddingLeft: "1.8rem" }}
                      onClick={() => selectSubcategory(cat.category, sub.subcategory)}
                    >
                      <span style={{ fontSize: "0.8rem" }}>{sub.subcategory.replace(/_/g, " ")}</span>
                      <span className="sidebar-count" style={{ opacity: sub.untranslated === 0 ? 0.4 : 1 }}>
                        {sub.untranslated.toLocaleString()} left
                      </span>
                    </div>
                    <div
                      className="progress-track"
                      style={{ margin: "0 1rem 0.4rem 1.8rem", opacity: sub.untranslated === 0 ? 0.4 : 1 }}
                    >
                      <div className="progress-fill" style={{ width: `${percentComplete(sub.total, sub.untranslated)}%` }} />
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>

        <div className="editor-column">
          <div className="editor-column-header">
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", margin: "0.5rem 0", flexWrap: "wrap" }}>
            {rows.length > 0 && (
              <div>
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

            {(viewMode === "category" || viewMode === "subcategory") && (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
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
          </div>
          </div>

          <div className="editor-row-list">
          {rows.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              {rows.map((row, index) => {
                const meta = statusMeta(row);
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
                      borderLeft: outdated ? "4px solid #e0a04c" : `4px solid ${meta.barColor}`,
                      borderBottom: "1px solid var(--border)",
                      padding: "0.5rem",
                      gap: "0.5rem",
                    }}
                  >
                    <div style={{ overflowWrap: "break-word", minWidth: 0 }}>
                      <div className="row-key" style={{ overflowWrap: "break-word" }}>{row.key}</div>
                      <span className={`status-chip ${meta.className}`}>{meta.label}</span>
                      {outdated && <div style={{ color: "#e0a04c", fontSize: "0.7rem" }}>⚠ source changed</div>}
                      <div style={{ color: "var(--text-dim)", fontSize: "0.75rem" }}>{row.context_label}</div>
                    </div>
                    <div
                      style={{ color: "var(--text-dim)", overflowWrap: "break-word", cursor: "pointer" }}
                      title="Click to copy source text"
                      onClick={(e) => { e.stopPropagation(); copySourceText(row.source_text); }}
                    >
                      {renderHighlightedSource(row.source_text)}
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
                        className="action-btn confirm"
                        title="Confirm and move to the next row"
                        onClick={(e) => { e.stopPropagation(); confirmAndNext(row, index); }}
                      >
                        ⏭
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
        </div>

        <div className={contextPanelOpen ? "context-panel" : "context-panel context-panel-collapsed"}>
          {contextPanelOpen && (
            <>
              <button className="collapse-toggle" onClick={() => setContextPanelOpen(false)}>
                Collapse →
              </button>
              {selectedRow ? (
                <>
                  <div className="context-field">
                    <div className="context-field-label">Key</div>
                    <p className="row-key" style={{ color: "var(--text-main)", margin: 0 }}>{selectedRow.key}</p>
                  </div>

                  <div className="context-field">
                    <div className="context-field-label">Status</div>
                    <span className={`status-chip ${statusMeta(selectedRow).className}`}>
                      {selectedRow.status === "human-confirmed"
                        ? "Confirmed"
                        : selectedRow.status === "ai-suggested"
                        ? "AI draft (unconfirmed)"
                        : selectedRow.status === "human-draft"
                        ? "Draft (unconfirmed)"
                        : "Untranslated"}
                    </span>
                  </div>

                  {selectedRow.source_hash_at_translation !== null &&
                    selectedRow.source_hash_at_translation !== selectedRow.source_text_hash && (
                      <div className="context-alert context-alert-warning">⚠ Source text changed since this was translated</div>
                    )}
                  {selectedRow.flagged ? <div className="context-alert context-alert-flag">⚑ Flagged for review</div> : null}

                  {selectedRow.translated_by && (
                    <div className="context-field">
                      <div className="context-field-label">Last edited by</div>
                      <div>{selectedRow.translated_by}</div>
                    </div>
                  )}
                  {selectedRow.updated_at && (
                    <div className="context-field">
                      <div className="context-field-label">Last updated</div>
                      <div>{selectedRow.updated_at}</div>
                    </div>
                  )}

                  <div className="context-divider" />

                  <div className="context-field">
                    <div className="context-field-label">Category</div>
                    <div>{categoryFilter ?? "—"}</div>
                  </div>
                  <div className="context-field">
                    <div className="context-field-label">Source file</div>
                    <div style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>{selectedRow.file_path}</div>
                  </div>

                  <button
                    onClick={handleViewHistory}
                    style={{ marginTop: "0.5rem", width: "100%", wordBreak: "break-all" }}
                  >
                    View History for {selectedRow.key}
                  </button>
                  {panels.history && (
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
      {panels.glossary && currentProject && (
        <GlossaryManager
          gameId={currentProject.game_id}
          targetLanguage={currentProject.target_language}
          onClose={() => closePanel("glossary")}
        />
      )}
      {panels.collaboration && currentProject && (
        <CollaborationPanel
          project={currentProject}
          onProjectUpdated={(p) => setCurrentProject(p)}
          onDataChanged={async () => {
            await refreshCounts();
            await loadPage(viewMode, offset, categoryFilter ?? undefined, subcategoryFilter ?? undefined);
          }}
          onClose={() => closePanel("collaboration")}
        />
      )}
      {panels.projectSettings && currentProject && (
        <ProjectSettings
          project={currentProject}
          onProjectUpdated={(p) => setCurrentProject(p)}
          onClose={() => closePanel("projectSettings")}
        />
      )}
      {panels.exportSummary && exportPreflight && currentProject && (
        <ExportSummary
          preflight={exportPreflight}
          isMod={currentProject.project_type === "mod"}
          sourceModName={currentProject.source_mod_name}
          outputModName={currentProject.mod_name}
          liveStatus={status}
          onProceed={handleExportMod}
          onClose={() => closePanel("exportSummary")}
        />
      )}
    </div>
  );
}

export default App;