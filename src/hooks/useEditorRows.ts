import { useEffect, useRef, useState } from "react";
import type { EditorRow, Project } from "../types";
import { type ViewMode, BATCH_SIZE } from "../App";
import { getDb } from "../db";
import { createWriteQueue } from "../writeQueue";
import { SQL_UNTRANSLATED, SQL_OUTDATED, SQL_ISSUES, SQL_DRAFT, SQL_CONFIRMED } from "../statusFilters";
import { buildStatusClause, shrinkingViewClause, buildStillInViewSql } from "../pagination";
import { buildSearchPageQuery } from "../searchPattern";

interface UseEditorRowsParams {
  currentProject: Project | null;
  contributorName: string | null;
  selectedRow: EditorRow | null;
  setSelectedRow: (row: EditorRow | null) => void;
  loadCategories: () => Promise<void>;
  refreshCounts: (options?: { statusOnly?: boolean }) => Promise<void>;
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

  // Which project is open RIGHT NOW (updated on every render). A late reload
  // that belongs to a project you have since left — for instance a batch that
  // finishes after you switched projects — checks this and is dropped, so one
  // project's strings can never appear on another project's screen.
  const openProjectIdRef = useRef<number | null>(null);
  openProjectIdRef.current = currentProject?.id ?? null;

  // True while a list of strings is being loaded (including when a project is
  // first opened). Lets the screen show "nothing here" only when a list really
  // is empty, not while it is still on its way.
  const [pageLoading, setPageLoading] = useState(false);
  const loadsInFlightRef = useRef(0);

  // The numbers in the sidebar (Untranslated / Drafts / Confirmed / ... and the
  // "left" beside each category) are counted from the database, so they have to
  // be re-counted after work that changes them. Doing that after every single
  // edit would be wasteful, so the re-count is put off for a moment and several
  // edits in quick succession share one.
  const countsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFullCountsRef = useRef(false);
  function scheduleCountsRefresh(includeCategories: boolean) {
    const projectId = currentProject?.id ?? null;
    if (includeCategories) pendingFullCountsRef.current = true;
    if (countsTimerRef.current) clearTimeout(countsTimerRef.current);
    countsTimerRef.current = setTimeout(() => {
      countsTimerRef.current = null;
      const full = pendingFullCountsRef.current;
      pendingFullCountsRef.current = false;
      if (projectId === null || projectId !== openProjectIdRef.current) return; // switched projects meanwhile
      refreshCounts({ statusOnly: !full }).catch(() => {});
    }, 400);
  }

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

  async function loadPageNow(
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
    if (currentProject.id !== openProjectIdRef.current) return; // a late call from a project that is no longer open
    setStatus("Loading...");
    // Make sure any save that is still in flight (e.g. the box you just
    // clicked out of) has landed before we read the database again.
    await queueRef.current.flush();
    const db = await getDb();
    const gameId = currentProject.game_id;
    const lang = currentProject.target_language;
    const statusFilter = statusFilterOverride ?? categoryStatusFilter;

    // "Next" (same list, exactly one page further on). In lists where strings
    // drop out as you work (Untranslated, Drafts, ...), the strings you have
    // just finished on this page no longer count, so jumping a full page ahead
    // would skip strings you haven't seen. Only the strings on this page that
    // are still in the list are stepped over. See pagination.ts.
    if (mode === viewMode && newOffset === offset + BATCH_SIZE) {
      const clause = shrinkingViewClause(mode, statusFilter);
      const keys = rowsRef.current.map((r) => r.key);
      if (clause && keys.length > 0) {
        try {
          const stillThere = (await db.select(buildStillInViewSql(clause, keys.length), [lang, gameId, ...keys])) as {
            n: number;
          }[];
          newOffset = offset + Number(stillThere[0]?.n ?? BATCH_SIZE);
        } catch {
          // If the check fails for any reason, fall back to the plain next page.
        }
      }
    }

    const baseSelect = `
      SELECT s.key as key, s.game_id as game_id, s.source_text as source_text,
             s.source_text_hash as source_text_hash,
             s.context_label as context_label, s.file_path as file_path,
             s.category as category, s.subcategory as subcategory, s.removed_at as removed_at,
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
      // What was typed is searched for literally (a "_" or "%" is just that
      // character) and capitals are ignored in every alphabet - see searchPattern.ts.
      const { sql, params } = buildSearchPageQuery(
        baseSelect.replace("$__lang__", "$1").replace("$__game__", "$2"),
        effectiveSearchTerm,
        lang,
        gameId,
        BATCH_SIZE,
        newOffset
      );
      batch = (await db.select(sql, params)) as EditorRow[];
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

    // You may have switched projects while this was loading.
    if (currentProject.id !== openProjectIdRef.current) return;

    rowsRef.current = batch;
    setRows(batch);
    setOffset(newOffset);
    setViewMode(mode);

    const initialDrafts: Record<string, string> = {};
    for (const row of batch) initialDrafts[row.key] = row.translated_text ?? "";
    draftsRef.current = initialDrafts;
    setDrafts(initialDrafts);

    await loadCategories();
    scheduleCountsRefresh(false); // the numbers at the top of the sidebar too
    setStatus(
      batch.length === 0
        ? "No strings to show here."
        : `Showing strings ${newOffset + 1}–${newOffset + batch.length} · ${VIEW_LABELS[mode]}`
    );
  }

  // The public version of loadPage: same thing, but keeps `pageLoading` true
  // for exactly as long as any load is running (even if one throws).
  async function loadPage(
    mode: ViewMode,
    newOffset: number,
    category?: string,
    subcategory?: string,
    statusFilterOverride?: Set<string>,
    searchTermOverride?: string
  ) {
    loadsInFlightRef.current += 1;
    setPageLoading(true);
    try {
      await loadPageNow(mode, newOffset, category, subcategory, statusFilterOverride, searchTermOverride);
    } finally {
      loadsInFlightRef.current -= 1;
      if (loadsInFlightRef.current === 0) setPageLoading(false);
    }
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

  // Opening a DIFFERENT project starts from a clean slate and shows All
  // strings, unfiltered. (Before, the editor opened blank until you clicked
  // something, and after switching projects it kept showing the previous
  // project's strings — edits made there would have been saved into the wrong
  // project.) Saves still waiting from the previous project are finished first,
  // and only then is anything cleared, so no typed text is lost.
  useEffect(() => {
    if (!currentProject) return;
    let cancelled = false;
    // A recount that was waiting for the previous project is no longer wanted.
    if (countsTimerRef.current) clearTimeout(countsTimerRef.current);
    countsTimerRef.current = null;
    pendingFullCountsRef.current = false;
    loadsInFlightRef.current += 1;
    setPageLoading(true);
    (async () => {
      try {
        await queueRef.current.flush();
        if (cancelled) return;
        rowsRef.current = [];
        draftsRef.current = {};
        setRows([]);
        setDrafts({});
        setOffset(0);
        setViewMode("all");
        setSearchTerm("");
        setCategoryFilter(null);
        setSubcategoryFilter(null);
        setCategoryStatusFilter(new Set(["untranslated", "draft", "human-confirmed"]));
        setSelectedRow(null);
        await loadPage("all", 0);
      } catch (err) {
        setStatus(`Could not load the strings: ${err}`);
      } finally {
        loadsInFlightRef.current -= 1;
        if (loadsInFlightRef.current === 0) setPageLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentProject?.id]);

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
      scheduleCountsRefresh(true); // a draft moves a string out of "untranslated"
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
        `INSERT INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, source_text_at_translation, flagged)
         VALUES ($1, $2, $3, $4, 'human-confirmed', $5, datetime('now'), $6, 0)
         ON CONFLICT(string_key, game_id, target_language) DO UPDATE SET
           translated_text = excluded.translated_text,
           status = 'human-confirmed',
           translated_by = excluded.translated_by,
           updated_at = excluded.updated_at,
           source_text_at_translation = excluded.source_text_at_translation,
           flagged = 0`,
        // Confirming means "I've checked this against the source as it is now",
        // so the current source text becomes the new reference point. It also
        // clears any flag — confirming IS the follow-up the flag was asking for.
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
        flagged: 0,
      });
      if (updated) setSelectedRow(updated);
      scheduleCountsRefresh(true);
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
      scheduleCountsRefresh(false); // only the Flagged number changes
    });
  }

  // Resolves once every queued save/confirm/flag has finished. Bulk actions
  // that read the database themselves call this first.
  function flushWrites() {
    return queueRef.current.flush();
  }

  return {
    rows,
    pageLoading,
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