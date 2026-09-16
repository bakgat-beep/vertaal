import { useRef, useState } from "react";
import type { EditorRow, Project } from "../types";
import type { ViewMode } from "../App";
import { getDb } from "../db";
import { translateWithRetry } from "../translate";
import { loadGlossaryTerms } from "../glossary";
import { protectTokens } from "../parser";
import { backupDatabase } from "../backup";

interface UseBatchTranslationParams {
  currentProject: Project | null;
  rows: EditorRow[];
  viewMode: ViewMode;
  offset: number;
  categoryFilter: string | null;
  subcategoryFilter: string | null;
  loadPage: (mode: ViewMode, newOffset: number, category?: string, subcategory?: string) => Promise<void>;
  refreshCounts: () => Promise<void>;
  setStatus: (status: string) => void;
}

// Holds batchRunning/batchProgress/overnightCount plus the four bulk AI
// operations that share them (page batch, code-only auto-accept, overnight
// batch, retry-unconfirmed). confirmAllOnPage is NOT here — it doesn't use
// batchRunning/batchProgress, so it stays in App.tsx as a plain bulk action.
export function useBatchTranslation({
  currentProject,
  rows,
  viewMode,
  offset,
  categoryFilter,
  subcategoryFilter,
  loadPage,
  refreshCounts,
  setStatus,
}: UseBatchTranslationParams) {
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [overnightCount, setOvernightCount] = useState("5000");
  const stopRequestedRef = useRef(false);

  function reloadCurrentPage() {
    return loadPage(viewMode, offset, categoryFilter ?? undefined, subcategoryFilter ?? undefined);
  }

  async function batchTranslatePage() {
    if (!currentProject) return;
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

    // Loaded once for the whole run rather than per-string — matching this
    // batch's glossary snapshot to the strings it translates. If you edit
    // the glossary while a run is in progress, the change won't be picked
    // up until the next run.
    const glossaryTerms = await loadGlossaryTerms(currentProject.game_id, currentProject.target_language);

    let succeeded = 0;
    let lastError = "";

    for (let i = 0; i < targets.length; i++) {
      if (stopRequestedRef.current) break;
      const row = targets[i];
      setStatus(`Translating page: ${i + 1}/${targets.length} — ${row.key}`);
      const result = await translateWithRetry(
        currentProject,
        row.key,
        row.game_id,
        row.source_text,
        () => stopRequestedRef.current,
        glossaryTerms
      );
      if (result.ok) succeeded++;
      else lastError = result.error ?? "unknown error";
      setBatchProgress({ done: i + 1, total: targets.length });
    }

    setBatchRunning(false);
    refreshCounts();
    await reloadCurrentPage();
    setStatus(
      succeeded === targets.length
        ? `Page batch complete. ${succeeded} translated.`
        : `Page batch finished: ${succeeded}/${targets.length} translated. Last error: ${lastError}`
    );
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
    await reloadCurrentPage();
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

    // Same one-time-load approach as batchTranslatePage — see the comment
    // there. For an overnight run this matters even more, since it can
    // otherwise mean thousands of repeated identical glossary queries.
    const glossaryTerms = await loadGlossaryTerms(currentProject.game_id, currentProject.target_language);

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
      const result = await translateWithRetry(
        currentProject,
        row.key,
        row.game_id,
        row.source_text,
        () => stopRequestedRef.current,
        glossaryTerms
      );

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
    await reloadCurrentPage();
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

    // Same one-time-load approach as the other two batch functions above.
    const glossaryTerms = await loadGlossaryTerms(currentProject.game_id, currentProject.target_language);

    for (const row of targets) {
      if (stopRequestedRef.current) break;
      setStatus(`Re-running AI: ${done + 1}/${targets.length} — ${row.key}`);
      const result = await translateWithRetry(
        currentProject,
        row.key,
        row.game_id,
        row.source_text,
        () => stopRequestedRef.current,
        glossaryTerms
      );
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
    await reloadCurrentPage();
    setStatus(`Re-run complete. ${done} strings re-translated.`);
  }

  function stopBatch() {
    stopRequestedRef.current = true;
    setStatus("Stopping batch after current translation finishes...");
  }

  return {
    batchRunning,
    batchProgress,
    overnightCount,
    setOvernightCount,
    batchTranslatePage,
    batchAutoAcceptProtectedOnly,
    batchTranslateOvernight,
    batchRerunAIUnconfirmed,
    stopBatch,
  };
}