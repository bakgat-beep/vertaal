import { useState } from "react";
import type { EditorRow, Project } from "../types";
import { type ViewMode, BATCH_SIZE } from "../App";
import { getDb } from "../db";

interface UseEditorRowsParams {
  currentProject: Project | null;
  contributorName: string | null;
  selectedRow: EditorRow | null;
  setSelectedRow: (row: EditorRow | null) => void;
  loadCategories: () => Promise<void>;
  refreshCounts: () => Promise<void>;
  setStatus: (status: string) => void;
}

// Holds the row list itself, pagination, in-progress drafts, the current
// view/search/category filters, and the row-level mutations (save/confirm/
// flag) that all read and write that same state. Doesn't own selectedRow —
// that stays in App.tsx since panels (history) and other non-row UI also
// depend on it.
export function useEditorRows({
  currentProject,
  contributorName,
  selectedRow,
  setSelectedRow,
  loadCategories,
  refreshCounts,
  setStatus,
}: UseEditorRowsParams) {
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [subcategoryFilter, setSubcategoryFilter] = useState<string | null>(null);

  const [categoryStatusFilter, setCategoryStatusFilter] = useState<Set<string>>(
    new Set(["untranslated", "ai-suggested", "human-confirmed"])
  );

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
    } else if (mode === "flagged") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        " AND t.flagged = 1 ORDER BY s.file_path, s.key LIMIT $3 OFFSET $4";
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

  return {
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
  };
}