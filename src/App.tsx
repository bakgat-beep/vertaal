import WelcomeScreen from "./WelcomeScreen";
import { importProjectFolder } from "./import";
import { useState, useEffect, useRef } from "react";
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
import ConfirmNamesPanel from "./ConfirmNamesPanel";
import SourceDiff from "./SourceDiff";
import { isSourceChanged } from "./sourceChange";
import { loadHistory, type HistoryEntry } from "./history";
import { save } from "@tauri-apps/plugin-dialog";
import { documentDir } from "@tauri-apps/api/path";
import CollaborationPanel from "./CollaborationPanel";
import { getProjectProvider } from "./providers";
import AppSettings from "./AppSettings";
import ProjectSettings from "./ProjectSettings";
import { exportMod, getExportPreflight } from "./export";
import { translateAndSave } from "./translate";
import { openPath } from "@tauri-apps/plugin-opener";
import ExportSummary, { type ExportPreflight, type ExportOutcome } from "./ExportSummary";

export type ViewMode = "all" | "untranslated" | "translated" | "draft" | "outdated" | "issues" | "flagged" | "search" | "category" | "subcategory";

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
    runSearch,
    searchFor,
    updateDraft,
    selectCategory,
    selectSubcategory,
    saveDraft,
    confirmRow,
    toggleFlag,
    flushWrites,
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
    batchConfirmCodeOnly,
    batchConfirmBlank,
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

  // Jump back to the top of the list whenever a different page/view is shown
  // (it used to stay scrolled down where the previous page ended).
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [viewMode, offset, categoryFilter, subcategoryFilter, viewMode === "search" ? searchTerm : ""]);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [showAppSettings, setShowAppSettings] = useState(false);
  // False until the project's string counts have been read, so the "nothing
  // imported yet" message can't flash up while they are still loading.
  const [countsReady, setCountsReady] = useState(false);

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
    setCountsReady(false);
    refreshCounts().then(() => setCountsReady(true));
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
  
  // True when the game's source text is not exactly what this translation was
  // made against (any difference at all counts) — see sourceChange.ts.
  function isOutdated(row: EditorRow): boolean {
    return isSourceChanged(row);
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
      // Upsert: restores the old text as a draft, while the row's flag and its
      // "translated against this source text" record are left as they were
      // (an old wording can't tell us which source it was written for).
      `INSERT INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, source_text_at_translation)
       VALUES ($1, $2, $3, $4, 'human-draft', $5, datetime('now'), $6)
       ON CONFLICT(string_key, game_id, target_language) DO UPDATE SET
         translated_text = excluded.translated_text,
         status = 'human-draft',
         translated_by = excluded.translated_by,
         updated_at = excluded.updated_at,
         source_text_at_translation = COALESCE(translations.source_text_at_translation, excluded.source_text_at_translation)`,
      [selectedRow.key, selectedRow.game_id, lang, text, contributorName, selectedRow.source_text]
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
    const defaultPath = await join(docs, `${currentProject.game_id}-${currentProject.target_language}-export.json`.replace(/[<>:"/\\|?*]/g, "_"));
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
    await flushWrites();
    setExportPreflight(await getExportPreflight(currentProject));
    openPanel("exportSummary");
  }

  async function handleExportMod(): Promise<ExportOutcome> {
    if (!currentProject) return { status: "error", error: "No project loaded." };
    return exportMod(currentProject, setStatus);
  }

  // --- AI translation ---

  async function aiTranslateRow(row: EditorRow) {
    await flushWrites();
    // Ask first if the box holds something a person wrote or confirmed —
    // but not when it only holds an untouched AI draft (that's fine to redo).
    const boxText = (drafts[row.key] ?? row.translated_text ?? "").trim();
    const isUntouchedAiDraft = row.status === "ai-suggested" && boxText === (row.translated_text ?? "").trim();
    if (boxText !== "" && !isUntouchedAiDraft) {
      const proceed = window.confirm(
        "This string already has your own translation. Replace it with a new AI draft?\n\n" +
          "The current text is kept in this string's History, so you can restore it."
      );
      if (!proceed) return;
    }
    setStatus(`Requesting AI translation for ${row.key}...`);
    const result = await translateAndSave(currentProject, row.key, row.game_id, row.source_text);
    if (!result.ok) {
      setStatus(`AI translation failed for ${row.key}: ${result.error ?? "unknown error"}`);
      return;
    }
    await loadPage(viewMode, offset, categoryFilter ?? undefined, subcategoryFilter ?? undefined);
    setStatus(`AI translated ${row.key}.`);
  }

  async function confirmAllOnPage() {
    if (!currentProject) return;
    await flushWrites();
    // What counts as "the translation" for each row is whatever is in its box
    // right now (its latest draft), falling back to the saved text.
    const textFor = (r: EditorRow) => drafts[r.key] ?? r.translated_text ?? "";
    const targets = rows.filter(
      (r) =>
        (r.status !== "human-confirmed" || (textFor(r).trim() === "" && r.source_text.trim() !== "")) && !r.flagged
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
      const typed = textFor(row);
      const finalText = typed.trim() !== "" ? typed : row.source_text;
      // Upsert: only the text/status/author/time/fingerprint change, so a
      // row's flag is never disturbed.
      await db.execute(
        `INSERT INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, source_text_at_translation)
         VALUES ($1, $2, $3, $4, 'human-confirmed', $5, datetime('now'), $6)
         ON CONFLICT(string_key, game_id, target_language) DO UPDATE SET
           translated_text = excluded.translated_text,
           status = 'human-confirmed',
           translated_by = excluded.translated_by,
           updated_at = excluded.updated_at,
           source_text_at_translation = excluded.source_text_at_translation`,
        [row.key, row.game_id, lang, finalText, contributorName, row.source_text]
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
    return (
      <>
        <WelcomeScreen onProjectSelected={handleProjectSelected} onOpenAppSettings={() => setShowAppSettings(true)} />
        {showAppSettings && (
          <AppSettings
            contributorName={contributorName}
            onSaved={setContributorNameState}
            onClose={() => setShowAppSettings(false)}
          />
        )}
      </>
    );
  }

  // The project's AI provider, or null when it is set to manual translation
  // only — in which case every AI button and batch action is hidden.
  const provider = getProjectProvider(currentProject);
  const aiEnabled = provider !== null;
  const currentProviderRequiresModel = provider?.requiresModel ?? false;

  // Highlights the sidebar entry for the list you're currently looking at.
  function sidebarClass(active: boolean) {
    return active ? "sidebar-item sidebar-item-active" : "sidebar-item";
  }

  // The Previous/Next buttons, shown above and below the list. "Next" is
  // greyed out when this page isn't full (there's nothing after it), and the
  // buttons stay on screen even when a page comes up empty so you're never
  // stranded.
  const pager =
    rows.length > 0 || offset > 0 ? (
      <div className="pager">
        <button
          onClick={() =>
            loadPage(viewMode, Math.max(0, offset - BATCH_SIZE), categoryFilter ?? undefined, subcategoryFilter ?? undefined)
          }
          disabled={offset === 0}
        >
          ← Previous {BATCH_SIZE}
        </button>
        <span className="pager-range">
          {rows.length > 0 ? `Strings ${offset + 1}–${offset + rows.length}` : "No more strings here"}
        </span>
        <button
          onClick={() =>
            loadPage(viewMode, offset + BATCH_SIZE, categoryFilter ?? undefined, subcategoryFilter ?? undefined)
          }
          disabled={rows.length < BATCH_SIZE}
        >
          Next {BATCH_SIZE} →
        </button>
      </div>
    ) : null;

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
        <button onClick={() => setShowWelcome(true)} title="Back to the list of your projects (your work is saved automatically)">
          ← Projects
        </button>
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
        <button
          onClick={() => openPanel("projectSettings")}
          title="This project's translation provider, exported mod name and other settings"
        >
          Project Settings
        </button>
        <button
          className="build-mod-button"
          onClick={openExportModal}
          title="Package your confirmed translations into a mod folder you can enable in the game's launcher. Shows a summary first."
        >
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
          <button onClick={() => setMoreMenuOpen((v) => !v)} title="Less-frequent actions: AI batches, importing game files, sharing, backups, app settings">
            More actions ▾
          </button>
          {moreMenuOpen && (
            <div className="more-menu-dropdown">
              {aiEnabled && (
                <>
                  <div className="more-menu-section-label">AI translation</div>
                  <button
                    onClick={() => { batchTranslatePage(); setMoreMenuOpen(false); }}
                    disabled={batchRunning}
                    title="AI-translate every string on this page that is untranslated or still an AI draft. Strings you've typed or confirmed are never touched."
                  >
                    Translate this page
                  </button>
                  <div className="more-menu-caption">Whole project — how many untranslated strings to translate:</div>
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    <input
                      type="number"
                      value={overnightCount}
                      onChange={(e) => setOvernightCount(e.target.value)}
                      style={{ width: "70px" }}
                      disabled={batchRunning}
                      title="How many strings to translate in this run"
                    />
                    <button
                      onClick={() => { batchTranslateOvernight(); setMoreMenuOpen(false); }}
                      disabled={batchRunning}
                      title="AI-translate that many untranslated strings, working from the start of the project (not just this page). Handy to leave running overnight; Stop appears in the toolbar."
                      style={{ flex: 1 }}
                    >
                      Start
                    </button>
                  </div>
                  <button
                    onClick={() => { batchRerunAIUnconfirmed(); setMoreMenuOpen(false); }}
                    disabled={batchRunning}
                    title="Re-runs the AI on every string in the whole project that is currently an AI draft, replacing those drafts — useful after switching provider or model. Text you typed or confirmed is never touched."
                  >
                    Redo all AI drafts
                  </button>
                </>
              )}

              <div className="more-menu-section-label">Strings that need no translation</div>
              <button
                onClick={() => { batchConfirmCodeOnly(); setMoreMenuOpen(false); }}
                disabled={batchRunning}
                title="Finds strings made up only of game code (icons, variables, functions — no words) anywhere in the project and CONFIRMS them exactly as they are, so nobody has to review them. In most languages that is the right result. AI translation skips these strings."
              >
                Confirm code-only strings
              </button>
              <button
                onClick={() => { batchConfirmBlank(); setMoreMenuOpen(false); }}
                disabled={batchRunning}
                title="Finds strings that are empty or contain only spaces or line breaks, anywhere in the project, and CONFIRMS them as they are. There is nothing to translate in them."
              >
                Confirm empty &amp; blank strings
              </button>
              <button
                onClick={() => { openPanel("confirmNames"); setMoreMenuOpen(false); }}
                disabled={batchRunning}
                title="Pick strings by part of their key or by source file — for example character or location names that the game localises itself — and confirm them exactly as they are."
              >
                Confirm names/locations as-is…
              </button>

              <div className="more-menu-section-label">Game files</div>
              <button
                onClick={() => { importFolder(); setMoreMenuOpen(false); }}
                title="Read the game's (or mod's) localisation files into this project. Do this once to begin, and again after a game patch: your translations are kept, and strings whose original text changed appear under Patch Changed."
              >
                Import / update from game files…
              </button>

              <div className="more-menu-section-label">Share &amp; back up</div>
              <button
                onClick={() => { handleExportData(); setMoreMenuOpen(false); }}
                title="Save this project's translations and glossary to a .json file you can send to a collaborator, or move to another computer."
              >
                Save translations to a file…
              </button>
              <button
                onClick={() => { handleImportData(); setMoreMenuOpen(false); }}
                title="Merge translations from a .json file made with 'Save translations to a file' (same game and language). Only strings you already have are affected; your more recent edits are kept."
              >
                Merge translations from a file…
              </button>
              <button
                onClick={() => { openPanel("collaboration"); setMoreMenuOpen(false); }}
                title="Share progress with teammates through GitHub: upload your work and download theirs, with everything merged automatically."
              >
                GitHub collaboration…
              </button>
              <button
                onClick={() => { handleBackupNow(); setMoreMenuOpen(false); }}
                title="Saves a copy of the ENTIRE app database — every project and game, not just this one."
              >
                Back up all app data…
              </button>

              <div className="more-menu-section-label">App</div>
              <button
                onClick={() => { setShowAppSettings(true); setMoreMenuOpen(false); }}
                title="Your name and other settings that apply to the whole app"
              >
                App settings…
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="content-columns">
        <div className="sidebar">
          <div
            className={sidebarClass(viewMode === "all")}
            onClick={() => loadPage("all", 0)}
            title="Every string in this project"
          >
            <span>All Strings</span>
            <span className="sidebar-count">{statusCounts.total.toLocaleString()}</span>
          </div>
          <div
            className={sidebarClass(viewMode === "untranslated")}
            onClick={() => loadPage("untranslated", 0)}
            title="Strings with no translation yet"
          >
            <span>Untranslated</span>
            <span className="sidebar-count">{statusCounts.untranslated.toLocaleString()}</span>
          </div>
          <div
            className={sidebarClass(viewMode === "draft")}
            onClick={() => loadPage("draft", 0)}
            title="Strings that have text but aren't confirmed yet — AI suggestions and anything you've typed. Confirm them to include them in the exported mod."
          >
            <span>Drafts</span>
            <span className="sidebar-count" style={{ opacity: statusCounts.drafts === 0 ? 0.4 : 1 }}>
              {statusCounts.drafts.toLocaleString()}
            </span>
          </div>
          <div
            className={sidebarClass(viewMode === "translated")}
            onClick={() => loadPage("translated", 0)}
            title="Strings you've confirmed — these are what go into the exported mod (unless flagged)"
          >
            <span>Confirmed</span>
            <span className="sidebar-count">{statusCounts.confirmed.toLocaleString()}</span>
          </div>
          <div
            className={sidebarClass(viewMode === "outdated")}
            onClick={() => loadPage("outdated", 0)}
            title="Translations (confirmed or draft) that were made against an EARLIER version of the original text — the game changed the text after you translated it, usually in a patch. Select one to see exactly what changed. Confirming it again clears the warning."
          >
            <span>⚠ Patch Changed</span>
            <span className="sidebar-count" style={{ opacity: statusCounts.outdated === 0 ? 0.4 : 1 }}>
              {statusCounts.outdated.toLocaleString()}
            </span>
          </div>
          {(statusCounts.issues > 0 || viewMode === "issues") && (
            <div
              className={sidebarClass(viewMode === "issues")}
              onClick={() => loadPage("issues", 0)}
              title="Strings marked as drafted or confirmed but with no actual text saved"
            >
              <span>⚠ Check for Issues</span>
              <span className="sidebar-count">{statusCounts.issues.toLocaleString()}</span>
            </div>
          )}
          <div
            className={sidebarClass(viewMode === "flagged")}
            onClick={() => loadPage("flagged", 0)}
            title="Strings you've flagged for follow-up. Flagged strings are left out of the exported mod until you clear the flag."
          >
            <span>🚩 Flagged</span>
            <span className="sidebar-count" style={{ opacity: statusCounts.flagged === 0 ? 0.4 : 1 }}>
              {statusCounts.flagged.toLocaleString()}
            </span>
          </div>

          <div style={{ height: "1px", background: "var(--border)", margin: "0.6rem 0" }} />

          {categories.map((cat) => (
            <div key={cat.category}>
              <div
                className={sidebarClass(viewMode === "category" && categoryFilter === cat.category)}
                onClick={() => selectCategory(cat.category)}
                title="Show this category. The number is how many of its strings are still untranslated."
              >
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
                      className={sidebarClass(
                        viewMode === "subcategory" &&
                          categoryFilter === cat.category &&
                          subcategoryFilter === sub.subcategory
                      )}
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
            {pager}

            {(viewMode === "category" || viewMode === "subcategory") && (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>Show:</span>
                {(
                  [
                    { key: "untranslated", label: "Untranslated" },
                    { key: "draft", label: "Drafts" },
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

          <div className="editor-row-list" ref={listRef}>
          {rows.length === 0 && offset === 0 && countsReady && (
            <div className="empty-state">
              {statusCounts.total === 0 ? (
                <>
                  <h3>No strings yet</h3>
                  <p>
                    Vertaal hasn't read this project's {currentProject.project_type === "mod" ? "mod" : "game"} files
                    yet. Import them to start translating.
                  </p>
                  <button className="build-mod-button" onClick={importFolder}>
                    Import localisation files
                  </button>
                  <p className="empty-state-hint">
                    You'll be asked to choose a folder — it opens where you told Vertaal the{" "}
                    {currentProject.project_type === "mod" ? "mod" : "game"} lives. Pick the folder that contains the{" "}
                    <code>_l_{currentProject.source_language}.yml</code> files (usually inside a folder called
                    "localization"); subfolders are searched too.
                  </p>
                </>
              ) : (
                <p>{viewMode === "search" ? "No strings match your search." : "No strings in this list."}</p>
              )}
            </div>
          )}
          {rows.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              {rows.map((row) => {
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
                      {aiEnabled && (
                        <button
                          className="action-btn"
                          title={
                            currentProviderRequiresModel && !currentProject.ai_model
                              ? "No model configured for this provider — set one in Project Settings"
                              : "Translate this string with AI. The result replaces what's in the box as an AI draft (you'll be asked first if the box holds your own text)."
                          }
                          disabled={currentProviderRequiresModel && !currentProject.ai_model}
                          onClick={(e) => { e.stopPropagation(); aiTranslateRow(row); }}>
                          AI
                        </button>
                      )}
                      <button className="action-btn confirm" title="Confirm this translation. If the box is empty, the original text is confirmed as-is (for names and codes that shouldn't be translated)." onClick={(e) => { e.stopPropagation(); confirmRow(row); }}>
                        ✓
                      </button>
                      <button
                        className={row.flagged ? "action-btn flag flagged" : "action-btn flag"}
                        title={row.flagged ? "Remove the flag" : "Flag for review — flagged strings are left out of the exported mod until you remove the flag"}
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

          {pager && <div style={{ margin: "0.5rem 0" }}>{pager}</div>}
          </div>
        </div>

        <div className={contextPanelOpen ? "context-panel" : "context-panel context-panel-collapsed"}>
          {contextPanelOpen && (
            <>
              <button
                className="collapse-toggle"
                onClick={() => setContextPanelOpen(false)}
                title="Hide this panel to give the strings more room. A 'Details' tab appears on the right edge to bring it back."
              >
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

                  {isOutdated(selectedRow) && (
                    <>
                      <div className="context-alert context-alert-warning">
                        ⚠ The original text changed since this was translated
                      </div>
                      <SourceDiff before={selectedRow.source_text_at_translation ?? ""} after={selectedRow.source_text} />
                    </>
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
                    <div>
                      {selectedRow.category
                        ? selectedRow.category.replace(/_/g, " ") +
                          (selectedRow.subcategory && selectedRow.subcategory !== "general"
                            ? ` › ${selectedRow.subcategory.replace(/_/g, " ")}`
                            : "")
                        : "—"}
                    </div>
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

        {!contextPanelOpen && (
          <button
            className="context-panel-reopen"
            onClick={() => setContextPanelOpen(true)}
            title="Show the details panel again"
          >
            ◀ Details
          </button>
        )}
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
            {statusCounts.drafts.toLocaleString()} drafts
          </span>
          <span>
            <span className="status-dot" style={{ background: "var(--status-confirmed)" }} />
            {statusCounts.confirmed.toLocaleString()} confirmed
          </span>
          <span>{statusCounts.total.toLocaleString()} total strings</span>
        </div>
      </div>
      {showAppSettings && (
        <AppSettings
          contributorName={contributorName}
          onSaved={setContributorNameState}
          onClose={() => setShowAppSettings(false)}
        />
      )}
      {panels.glossary && currentProject && (
        <GlossaryManager
          gameId={currentProject.game_id}
          targetLanguage={currentProject.target_language}
          isModProject={currentProject.project_type === "mod"}
          providerName={provider ? provider.displayName : null}
          providerSupportsGlossary={provider?.supportsGlossary ?? false}
          onClose={() => closePanel("glossary")}
          onViewOccurrences={(term) => {
            closePanel("glossary");
            searchFor(term);
          }}
        />
      )}
      {panels.confirmNames && currentProject && (
        <ConfirmNamesPanel
          gameId={currentProject.game_id}
          targetLanguage={currentProject.target_language}
          translatedBy={contributorName}
          onConfirmed={async () => {
            await refreshCounts();
            await loadPage(viewMode, offset, categoryFilter ?? undefined, subcategoryFilter ?? undefined);
          }}
          onClose={() => closePanel("confirmNames")}
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