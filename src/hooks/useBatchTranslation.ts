import { useRef, useState } from "react";
import type { EditorRow, Project } from "../types";
import type { ViewMode } from "../App";
import { getDb } from "../db";
import { translateWithRetry } from "../translate";
import { loadGlossaryTerms } from "../glossary";
import { isCodeOnly, isBlank, needsNoTranslation, shouldConfirmAsIs } from "../codeOnly";
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
      (r) =>
        (!r.status || r.status === "untranslated" || r.status === "ai-suggested") &&
        !r.flagged &&
        !needsNoTranslation(r.source_text) // nothing to translate — "Confirm code-only / blank strings" handle those
    );
    if (targets.length === 0) {
      setStatus("No untranslated or AI-suggested strings on this page.");
      return;
    }
    setBatchRunning(true);
    stopRequestedRef.current = false;
    setBatchProgress({ done: 0, total: targets.length });

    // Wrapped so an unexpected error (not a handled per-string failure —
    // something in the surrounding setup, like the glossary load) can never
    // leave batchRunning stuck at true, which would grey out every batch
    // button for the rest of the session with no way to recover but
    // restarting the app.
    try {
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
          glossaryTerms,
          undefined,
          undefined,
          true // batch context: the Google Translate delay is meant for batch runs
        );
        if (result.ok) succeeded++;
        else lastError = result.error ?? "unknown error";
        setBatchProgress({ done: i + 1, total: targets.length });
      }

      await reloadCurrentPage();
      setStatus(
        succeeded === targets.length
          ? `Page batch complete. ${succeeded} translated.`
          : `Page batch finished: ${succeeded}/${targets.length} translated. Last error: ${lastError}`
      );
    } catch (err) {
      setStatus(`Page batch stopped unexpectedly: ${err}`);
    } finally {
      setBatchRunning(false);
      refreshCounts();
    }
  }

  // Confirms, exactly as they are, every string that needs no translation:
  // the original text becomes the confirmed translation. Covers untranslated
  // strings, plus strings an earlier version of this action left as drafts
  // that are just a copy of the source. Never touches flagged strings, or a
  // draft with text you typed yourself.
  async function confirmSourceAsIs(
    kind: "code-only" | "blank",
    qualifies: (sourceText: string) => boolean,
    label: string,
    describe: string
  ) {
    if (!currentProject) return;
    const db = await getDb();
    const gameId = currentProject.game_id;
    const lang = currentProject.target_language;

    const candidates = (await db.select(
      `SELECT s.key as key, s.source_text as source_text, t.status as status,
              t.translated_text as translated_text, t.translated_by as translated_by
       FROM strings s
       LEFT JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id AND t.target_language = $1
       WHERE s.game_id = $2
         AND (t.flagged IS NULL OR t.flagged = 0)
         AND (t.status IS NULL OR t.status IN ('untranslated', 'ai-suggested'))`,
      [lang, gameId]
    )) as {
      key: string;
      source_text: string;
      status: string | null;
      translated_text: string | null;
      translated_by: string | null;
    }[];

    const matches = candidates.filter((c) => shouldConfirmAsIs(c, qualifies));

    if (matches.length === 0) {
      setStatus(`No ${label} found that still need confirming.`);
      return;
    }

    const proceed = window.confirm(
      `Found ${matches.length} string(s) ${describe}. Confirm them all exactly as they are (the original text becomes the confirmed translation)?`
    );
    if (!proceed) return;

    setStatus(`Confirming ${matches.length} strings...`);
    for (const m of matches) {
      await db.execute(
        `INSERT INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, source_text_at_translation)
         VALUES ($1, $2, $3, $4, 'human-confirmed', $5, datetime('now'), $6)
         ON CONFLICT(string_key, game_id, target_language) DO UPDATE SET
           translated_text = excluded.translated_text,
           status = 'human-confirmed',
           translated_by = excluded.translated_by,
           updated_at = excluded.updated_at,
           source_text_at_translation = excluded.source_text_at_translation`,
        [m.key, gameId, lang, m.source_text, `auto (${kind})`, m.source_text]
      );
    }

    refreshCounts();
    await reloadCurrentPage();
    setStatus(`Confirmed ${matches.length} strings as they are.`);
  }

  // Strings made only of game code (icons, variables, functions): nothing to translate.
  function batchConfirmCodeOnly() {
    return confirmSourceAsIs(
      "code-only",
      isCodeOnly,
      "code-only strings",
      "made up entirely of game code (icons, variables, functions) with no words to translate"
    );
  }

  // Strings that are empty or only spaces / line breaks.
  function batchConfirmBlank() {
    return confirmSourceAsIs("blank", isBlank, "blank strings", "that are empty or contain only spaces or line breaks");
  }

  async function batchTranslateOvernight() {
    if (!currentProject) return;
    const project = currentProject; // narrowed once, for the closure below
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

    try {
      let distinctFailureStreak = 0;

      // Same one-time-load approach as batchTranslatePage — see the comment
      // there. For an overnight run this matters even more, since it can
      // otherwise mean thousands of repeated identical glossary queries.
      const glossaryTerms = await loadGlossaryTerms(project.game_id, project.target_language);

      // A code-only or blank string (nothing for the AI to translate — see
      // "Confirm code-only/blank strings" instead) is filtered out in
      // JavaScript, not SQL, since that check needs the token-protection
      // logic in parser.ts. A queue, refilled a page at a time as it runs
      // low, means such a string is skipped without ever being re-selected —
      // fetching it one row at a time with the same WHERE clause would just
      // find that same untranslated, still-code-only row again forever.
      const queue: { key: string; game_id: string; source_text: string }[] = [];
      let queueExhausted = false;
      // Keyset ("cursor") pagination — where the last page left off — rather
      // than excluding every code-only/blank key seen so far by listing them
      // all in the query: a project with many such strings would otherwise
      // make each refill's query grow without bound over a long run.
      let cursor: { filePath: string; key: string } | null = null;
      const PAGE_SIZE = 200;

      async function refillQueue() {
        if (queueExhausted) return;
        const cursorClause = cursor ? "AND (s.file_path, s.key) > ($3, $4)" : "";
        const params: unknown[] = [project.target_language, project.game_id];
        if (cursor) params.push(cursor.filePath, cursor.key);
        const page = (await db.select(
          `SELECT s.key as key, s.game_id as game_id, s.source_text as source_text, s.file_path as file_path
           FROM strings s
           LEFT JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id AND t.target_language = $1
           WHERE (t.status IS NULL OR t.status = 'untranslated') AND (t.flagged IS NULL OR t.flagged = 0) AND s.game_id = $2
           ${cursorClause}
           ORDER BY s.file_path, s.key
           LIMIT ${PAGE_SIZE}`,
          params
        )) as { key: string; game_id: string; source_text: string; file_path: string }[];
        if (page.length < PAGE_SIZE) queueExhausted = true;
        for (const row of page) {
          cursor = { filePath: row.file_path, key: row.key };
          if (!needsNoTranslation(row.source_text)) queue.push(row);
        }
      }

      await refillQueue();

      while (done < targetCount && !stopRequestedRef.current) {
        if (queue.length === 0) {
          if (queueExhausted) {
            setStatus("No more untranslated strings remain — batch finished early.");
            break;
          }
          await refillQueue();
          if (queue.length === 0 && queueExhausted) {
            setStatus("No more untranslated strings remain — batch finished early.");
            break;
          }
          continue;
        }

        const row = queue.shift()!;
        setStatus(`Overnight batch: ${done + 1}/${targetCount} — ${row.key}`);
        const result = await translateWithRetry(
          project,
          row.key,
          row.game_id,
          row.source_text,
          () => stopRequestedRef.current,
          glossaryTerms,
          undefined,
          undefined,
          true // batch context: the Google Translate delay is meant for batch runs
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

        if (queue.length < 10) await refillQueue();
      }

      await reloadCurrentPage();
      setStatus(`Overnight batch finished. ${done} strings translated.`);
    } catch (err) {
      setStatus(`Overnight batch stopped unexpectedly after ${done} translated: ${err}`);
    } finally {
      setBatchRunning(false);
      refreshCounts();
    }
  }

  async function batchRerunAIUnconfirmed() {
    if (!currentProject) return;
    setBatchRunning(true);
    stopRequestedRef.current = false;
    let done = 0;

    try {
      const db = await getDb();
      const allAiDrafts = (await db.select(
        `SELECT s.key as key, s.game_id as game_id, s.source_text as source_text
         FROM strings s
         JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id AND t.target_language = $1
         WHERE t.status = 'ai-suggested' AND s.game_id = $2`,
        [currentProject.target_language, currentProject.game_id]
      )) as { key: string; game_id: string; source_text: string }[];
      // Code-only and blank strings have nothing for an AI to translate, so
      // they're left out of a re-run.
      const targets = allAiDrafts.filter((r) => !needsNoTranslation(r.source_text));

      setBatchProgress({ done: 0, total: targets.length });
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
          glossaryTerms,
          undefined,
          undefined,
          true // batch context: the Google Translate delay is meant for batch runs
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

      await reloadCurrentPage();
      setStatus(`Re-run complete. ${done} strings re-translated.`);
    } catch (err) {
      setStatus(`Re-run stopped unexpectedly after ${done} translated: ${err}`);
    } finally {
      setBatchRunning(false);
      refreshCounts();
    }
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
    batchConfirmCodeOnly,
    batchConfirmBlank,
    batchTranslateOvernight,
    batchRerunAIUnconfirmed,
    stopBatch,
  };
}