import { useRef, useState } from "react";
import type { EditorRow, Project } from "../types";
import { type ViewMode, BATCH_SIZE } from "../App";
import { getDb } from "../db";
import { createWriteQueue } from "../writeQueue";
import { SQL_UNTRANSLATED, SQL_DRAFT, SQL_CONFIRMED, SQL_OUTDATED, SQL_ISSUES } from "../statusFilters";

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
const VIEW_LABELS: Record<ViewMode, string> = {
  all: "All strings",
  untranslated: "Untranslated",
  translated: "Confirmed",
  draft: "Drafts",
  outdated: "Patch changed",
  issues: "Check for issues",
  flagged: "Flagged",
  search: "Search results",
  category: "Category",
  subcategory: "Subcategory",
};

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

  // Row saves/confirms/flags all go through one queue so they always finish in
  // the order they were requested (see writeQueue.ts for why). The two refs
  // below always hold the very latest rows/drafts, even in the instant before
  // React re-renders — so a save or confirm never acts on out-of-date text.
  const queueRef = useRef(createWriteQueue());
  const rowsRef = useRef<EditorRow[]>([]);
  const draftsRef = useRef<Record<string, string>>({});

  function patchRow(key: string, patch: Partial<EditorRow>): EditorRow | undefined {
    rowsRef.current = rowsRef.current.map((r) => (r.key === key ? { ...r, ...patch } : r));
    setRows(rowsRef.current);
    return rowsRef.current.find((r) => r.key === key);
  }
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [subcategoryFilter, setSubcategoryFilter] = useState<string | null>(null);

  const [categoryStatusFilter, setCategoryStatusFilter] = useState<Set<string>>(
    new Set(["untranslated", "draft", "human-confirmed"])
  );

  function buildStatusClause(filter: Set<string>): string {
    const clauses: string[] = [];
    if (filter.has("untranslated")) clauses.push(SQL_UNTRANSLATED);
    if (filter.has("draft")) clauses.push(SQL_DRAFT);
    if (filter.has("human-confirmed")) clauses.push(SQL_CONFIRMED);
    if (clauses.length === 0) return "1=0";
    return `(${clauses.join(" OR ")})`;
  }

  async function loadPage(
    mode: ViewMode,
    newOffset: number,
    category?: string,
    subcategory?: string,
    statusFilterOverride?: Set<string>,
    // Lets a caller (e.g. "view occurrences" from the Glossary Manager)
    // search for a specific term immediately, without the stale-closure
    // problem of calling setSearchTerm() then loadPage() back to back —
    // React batches the state update, so loadPage would otherwise still
    // see the OLD searchTerm on this same call. Falls back to the current
    // searchTerm state for the normal search-box/button flow.
    searchTermOverride?: string
  ) {
    if (!currentProject) return;
    setStatus("Loading...");
    // Make sure any save that is still in flight (e.g. the box you just
    // clicked out of) has landed before we read the database again.
    await queueRef.current.flush();
    const db = await getDb();
    const gameId = currentProject.game_id;
    const lang = currentProject.target_language;
    const statusFilter = statusFilterOverride ?? categoryStatusFilter;

    const baseSelect = `
      SELECT s.key as key, s.game_id as game_id, s.source_text as source_text,
             s.source_text_hash as source_text_hash,
             s.context_label as context_label, s.file_path as file_path,
             s.category as category, s.subcategory as subcategory,
             t.translated_text as translated_text, t.status as status,
             t.flagged as flagged, t.translated_by as translated_by, t.updated_at as updated_at,
             t.source_text_at_translation as source_text_at_translation
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
        ` AND ${SQL_UNTRANSLATED} ORDER BY s.file_path, s.key LIMIT $3 OFFSET $4`;
      batch = (await db.select(sql, [lang, gameId, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "translated") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        ` AND ${SQL_CONFIRMED} ORDER BY t.updated_at DESC LIMIT $3 OFFSET $4`;
      batch = (await db.select(sql, [lang, gameId, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "draft") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        ` AND ${SQL_DRAFT} ORDER BY s.file_path, s.key LIMIT $3 OFFSET $4`;
      batch = (await db.select(sql, [lang, gameId, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "search") {
      const effectiveSearchTerm = searchTermOverride ?? searchTerm;
      const likeTerm = `%${effectiveSearchTerm}%`;
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        " AND (s.key LIKE $3 OR s.source_text LIKE $4 OR t.translated_text LIKE $5) ORDER BY s.file_path, s.key LIMIT $6 OFFSET $7";
      batch = (await db.select(sql, [lang, gameId, likeTerm, likeTerm, likeTerm, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "category") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        ` AND s.category = $3 AND ${buildStatusClause(statusFilter)} ORDER BY s.file_path, s.key LIMIT $4 OFFSET $5`;
      batch = (await db.select(sql, [lang, gameId, category, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "subcategory") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        ` AND s.category = $3 AND COALESCE(s.subcategory, 'general') = $4 AND ${buildStatusClause(statusFilter)} ORDER BY s.file_path, s.key LIMIT $5 OFFSET $6`;
      batch = (await db.select(sql, [lang, gameId, category, subcategory, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "outdated") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        ` AND ${SQL_OUTDATED} ORDER BY s.file_path, s.key LIMIT $3 OFFSET $4`;
      batch = (await db.select(sql, [lang, gameId, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "issues") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        ` AND ${SQL_ISSUES} ORDER BY s.file_path, s.key LIMIT $3 OFFSET $4`;
      batch = (await db.select(sql, [lang, gameId, BATCH_SIZE, newOffset])) as EditorRow[];
    } else if (mode === "flagged") {
      const sql =
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2") +
        " AND t.flagged = 1 ORDER BY s.file_path, s.key LIMIT $3 OFFSET $4";
      batch = (await db.select(sql, [lang, gameId, BATCH_SIZE, newOffset])) as EditorRow[];
    }

    rowsRef.current = batch;
    setRows(batch);
    setOffset(newOffset);
    setViewMode(mode);

    const initialDrafts: Record<string, string> = {};
    for (const row of batch) initialDrafts[row.key] = row.translated_text ?? "";
    draftsRef.current = initialDrafts;
    setDrafts(initialDrafts);

    await loadCategories();
    setStatus(
      batch.length === 0
        ? "No strings to show here."
        : `Showing strings ${newOffset + 1}–${newOffset + batch.length} · ${VIEW_LABELS[mode]}`
    );
  }

  function runSearch() {
    if (!searchTerm.trim()) return;
    loadPage("search", 0);
  }

  // Searches for an exact term immediately — used by "view occurrences"
  // from the Glossary Manager, where the term comes from outside the
  // search box rather than from the user typing into it.
  function searchFor(term: string) {
    setSearchTerm(term);
    loadPage("search", 0, undefined, undefined, undefined, term);
  }

  function updateDraft(key: string, value: string) {
    draftsRef.current = { ...draftsRef.current, [key]: value };
    setDrafts(draftsRef.current);
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

  function saveDraft(row: EditorRow) {
    return queueRef.current.enqueue(async () => {
      if (!currentProject) return;
      const latest = rowsRef.current.find((r) => r.key === row.key) ?? row;
      const newText = draftsRef.current[row.key] ?? "";
      if (newText === (latest.translated_text ?? "")) return;

      const newStatus = newText.trim() === "" ? "untranslated" : "human-draft";
      const db = await getDb();
      const lang = currentProject.target_language;

      // An "upsert": update only the text/status/author/time of an existing
      // row, so its flag and its "translated against this source text"
      // fingerprint survive. (Before, this replaced the whole row, which
      // silently reset that fingerprint.) A brand-new row records the
      // current source fingerprint.
      await db.execute(
        `INSERT INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, source_text_at_translation)
         VALUES ($1, $2, $3, $4, $5, $6, datetime('now'), $7)
         ON CONFLICT(string_key, game_id, target_language) DO UPDATE SET
           translated_text = excluded.translated_text,
           status = excluded.status,
           translated_by = excluded.translated_by,
           updated_at = excluded.updated_at,
           source_text_at_translation = COALESCE(translations.source_text_at_translation, excluded.source_text_at_translation)`,
        [row.key, row.game_id, lang, newText, newStatus, contributorName, latest.source_text]
      );

      await db.execute(
        `INSERT INTO translation_history (string_key, game_id, target_language, old_text, new_text, changed_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.key, row.game_id, lang, latest.translated_text ?? "", newText, contributorName]
      );

      const updated = patchRow(row.key, { translated_text: newText, status: newStatus });
      if (updated && selectedRow?.key === row.key) setSelectedRow(updated);
    });
  }

  function confirmRow(row: EditorRow) {
    return queueRef.current.enqueue(async () => {
      if (!currentProject) return;
      const db = await getDb();
      const lang = currentProject.target_language;
      const latest = rowsRef.current.find((r) => r.key === row.key) ?? row;

      // Use what is in the box RIGHT NOW (the latest draft), not whatever
      // the row looked like at the last screen refresh. If the box is empty,
      // the original source text is confirmed as-is — this is how strings
      // that should not be translated (names, codes) get marked done.
      const typed = draftsRef.current[row.key] ?? latest.translated_text ?? "";
      const finalText = typed.trim() !== "" ? typed : latest.source_text;

      await db.execute(
        `INSERT INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, source_text_at_translation)
         VALUES ($1, $2, $3, $4, 'human-confirmed', $5, datetime('now'), $6)
         ON CONFLICT(string_key, game_id, target_language) DO UPDATE SET
           translated_text = excluded.translated_text,
           status = 'human-confirmed',
           translated_by = excluded.translated_by,
           updated_at = excluded.updated_at,
           source_text_at_translation = excluded.source_text_at_translation`,
        // Confirming means "I've checked this against the source as it is now",
        // so the current source text becomes the new reference point.
        [row.key, row.game_id, lang, finalText, contributorName, latest.source_text]
      );

      // Confirming can itself change the text (empty box -> source text), so
      // record that in History too, otherwise there'd be nothing to restore.
      if (finalText !== (latest.translated_text ?? "")) {
        await db.execute(
          `INSERT INTO translation_history (string_key, game_id, target_language, old_text, new_text, changed_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [row.key, row.game_id, lang, latest.translated_text ?? "", finalText, contributorName]
        );
      }

      // Show the confirmed text in the box (it used to stay visibly empty
      // after confirming an empty row with its source text).
      draftsRef.current = { ...draftsRef.current, [row.key]: finalText };
      setDrafts(draftsRef.current);

      const updated = patchRow(row.key, {
        translated_text: finalText,
        status: "human-confirmed",
        source_text_at_translation: latest.source_text,
      });
      if (updated) setSelectedRow(updated);
      refreshCounts();
    });
  }

  function toggleFlag(row: EditorRow) {
    return queueRef.current.enqueue(async () => {
      if (!currentProject) return;
      const latest = rowsRef.current.find((r) => r.key === row.key) ?? row;
      const newFlagged = latest.flagged ? 0 : 1;
      const db = await getDb();

      // Only the flag changes. (Before, this replaced the whole row, which
      // silently erased the "translated against this source text"
      // fingerprint of a confirmed string, so it could never show up as
      // "Patch Changed" again.) A string with no row yet gets an empty,
      // untranslated one just to carry the flag.
      await db.execute(
        `INSERT INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, flagged)
         VALUES ($1, $2, $3, '', 'untranslated', $4, datetime('now'), $5)
         ON CONFLICT(string_key, game_id, target_language) DO UPDATE SET flagged = excluded.flagged`,
        [row.key, row.game_id, currentProject.target_language, contributorName, newFlagged]
      );

      const updated = patchRow(row.key, { flagged: newFlagged });
      if (updated && selectedRow?.key === row.key) setSelectedRow(updated);
    });
  }

  // Resolves once every queued save/confirm/flag has finished. Bulk actions
  // that read the database themselves call this first.
  function flushWrites() {
    return queueRef.current.flush();
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
    runSearch,
    searchFor,
    updateDraft,
    selectCategory,
    selectSubcategory,
    saveDraft,
    confirmRow,
    toggleFlag,
    flushWrites,
  };
}