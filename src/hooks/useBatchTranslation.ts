import { useRef, useState } from "react";
import type { EditorRow, Project } from "../types";
import type { ViewMode } from "../App";
import { getDb } from "../db";
import { translateWithRetry } from "../translate";
import { loadGlossaryTerms } from "../glossary";
import { isCodeOnly, isBlank, needsNoTranslation, shouldConfirmAsIs } from "../codeOnly";
import { backupDatabase } from "../backup";
import { confirm } from "../confirm";

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
  // True while a text box on the screen holds typing that has not been saved
  // yet. A batch that finishes then leaves the list alone rather than
  // redrawing it over that typing.
  hasUnsavedEdits?: () => boolean;
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
  hasUnsavedEdits,
}: UseBatchTranslationParams) {
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [overnightCount, setOvernightCount] = useState("5000");
  const stopRequestedRef = useRef(false);
  // Cancels a request that is already waiting for the translation provider
  // when Stop is pressed (see stopBatch), instead of waiting for its reply.
  const abortRef = useRef<AbortController | null>(null);
  // True from the moment any batch action starts until it has completely
  // finished (backup and set-up included). A ref, not screen state, because it
  // has to be right immediately: a second click a moment after the first sees
  // it at once, whereas screen state only changes on the next redraw.
  const busyRef = useRef(false);

  // Claims the "one batch at a time" slot. Returns false (and says why) if a
  // batch action is already in progress.
  function claimBatchSlot(): boolean {
    if (busyRef.current) {
      setStatus("A batch is already running - press Stop first, or wait for it to finish.");
      return false;
    }
    busyRef.current = true;
    return true;
  }

  function beginRun() {
    stopRequestedRef.current = false;
    abortRef.current = new AbortController();
    return abortRef.current.signal;
  }

  // Said when the provider reports a problem that retrying cannot fix.
  function permanentProblemMessage(error: string | undefined) {
    return `Stopped: ${error ?? "the translation service refused the request"}. Nothing was changed on the strings - fix this in Project Settings, then run again.`;
  }

  // What is on screen RIGHT NOW. A batch can run for hours, and the functions
  // below were created when it started, so they would otherwise remember the
  // page that was showing back then. This always holds the newest values.
  const latestRef = useRef({ viewMode, offset, categoryFilter, subcategoryFilter, loadPage, hasUnsavedEdits });
  latestRef.current = { viewMode, offset, categoryFilter, subcategoryFilter, loadPage, hasUnsavedEdits };

  function currentViewKey() {
    const v = latestRef.current;
    return `${v.viewMode}|${v.offset}|${v.categoryFilter ?? ""}|${v.subcategoryFilter ?? ""}`;
  }

  // Redraws the list after a batch so the new drafts show - but only when that
  // is safe. If you moved to another page or view while the batch ran, or have
  // typing that is not saved yet, the list is left alone (redrawing would throw
  // you back to where the batch started, or wipe what you typed). Returns a
  // sentence to add to the final message when the list was not redrawn.
  async function refreshAfterBatch(startedAtView: string): Promise<string> {
    const v = latestRef.current;
    if (currentViewKey() !== startedAtView) {
      return " The list on screen was not refreshed because you moved to another page - open the page again to see the new results.";
    }
    if (v.hasUnsavedEdits?.()) {
      return " The list on screen was not refreshed because you have typing that is not saved yet - click out of the box, then open the page again to see the new results.";
    }
    await v.loadPage(v.viewMode, v.offset, v.categoryFilter ?? undefined, v.subcategoryFilter ?? undefined);
    return "";
  }

  // Makes the safety backup that comes before a big run. If it fails, the
  // person decides: carrying on without a backup must be a choice, not
  // something that happens while a warning flashes past unread. Returns false
  // when the run should not go ahead.
  async function backupBeforeRun(): Promise<boolean> {
    setStatus("Backing up database before starting...");
    try {
      await backupDatabase();
      return true;
    } catch (err) {
      const carryOn = await confirm(
        `The safety backup could not be made (${err instanceof Error ? err.message : err}).\n\n` +
          "Carry on WITHOUT a backup? If you are unsure, choose Cancel and make a backup yourself first " +
          "(Welcome screen, Backup now).",
        { confirmLabel: "Carry on without a backup", cancelLabel: "Cancel" }
      );
      if (!carryOn) setStatus("Cancelled - the backup failed, so nothing was changed.");
      return carryOn;
    }
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
    if (!claimBatchSlot()) return;
    setBatchRunning(true);
    const signal = beginRun();
    const startedAtView = currentViewKey();
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
      let skipped = 0;
      let lastError = "";
      let consecutiveFailures = 0;
      let stoppedMessage = ""; // why the run ended early, shown once the list has been redrawn

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
          true, // batch context: the Google Translate delay is meant for batch runs
          true, // never replace a confirmed or hand-typed translation
          signal
        );
        if (result.ok && !result.skipped) {
          succeeded++;
          consecutiveFailures = 0;
        } else if (result.skipped) {
          skipped++;
        } else if (result.stopped) {
          break;
        } else {
          lastError = result.error ?? "unknown error";
          if (result.permanent) {
            stoppedMessage = permanentProblemMessage(result.error);
            break;
          }
          if (++consecutiveFailures >= 3) {
            stoppedMessage = `Stopped: 3 strings in a row failed. Last error: ${lastError}`;
            break;
          }
        }
        setBatchProgress({ done: i + 1, total: targets.length });
      }

      // The list is redrawn first, and the final message set AFTER it: redrawing
      // writes its own "Showing strings..." message, which used to wipe out the
      // reason a run had stopped.
      const note = await refreshAfterBatch(startedAtView);
      setStatus(
        (stoppedMessage ||
          (succeeded + skipped === targets.length
            ? `Page batch complete. ${succeeded} translated${skipped ? `, ${skipped} left alone because you had already confirmed or typed them` : ""}.`
            : `Page batch finished: ${succeeded}/${targets.length} translated${skipped ? `, ${skipped} left alone (already confirmed or typed)` : ""}. Last error: ${lastError}`)) + note
      );
    } catch (err) {
      setStatus(`Page batch stopped unexpectedly: ${err}`);
    } finally {
      busyRef.current = false;
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
    if (!claimBatchSlot()) return;
    const startedAtView = currentViewKey();
    try {
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

      const proceed = await confirm(
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
      const note = await refreshAfterBatch(startedAtView);
      setStatus(`Confirmed ${matches.length} strings as they are.${note}`);
    } catch (err) {
      setStatus(`Confirming ${label} failed: ${err instanceof Error ? err.message : err}`);
      refreshCounts();
    } finally {
      busyRef.current = false;
    }
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
    if (!claimBatchSlot()) return;
    // The run is marked as running BEFORE the backup, which can take a while on
    // a big database: a second click, or Stop, during the backup must already
    // count. (Before, a second click started a second run, and Stop was lost
    // when the run began.)
    setBatchRunning(true);
    const signal = beginRun();
    const startedAtView = currentViewKey();
    setBatchProgress({ done: 0, total: targetCount });
    let done = 0;

    try {
      if (!(await backupBeforeRun())) return; // cancelled; "finally" below frees the buttons
      if (stopRequestedRef.current) {
        setStatus("Stopped before the run began.");
        return; // Stop was pressed while the backup ran
      }

      // Inside the try, so a database that cannot be opened ends the run with a
      // message and releases the buttons, rather than leaving them stuck.
      const db = await getDb();

      let distinctFailureStreak = 0;
      let stoppedMessage = "";

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
          true, // batch context: the Google Translate delay is meant for batch runs
          true, // never replace a confirmed or hand-typed translation
          signal
        );

        if (result.ok) {
          distinctFailureStreak = 0;
          if (!result.skipped) done++;
          setBatchProgress({ done, total: targetCount });
        } else if (result.stopped) {
          break;
        } else if (result.permanent) {
          stoppedMessage = permanentProblemMessage(result.error);
          break;
        } else {
          distinctFailureStreak++;
          if (distinctFailureStreak >= 3) {
            stoppedMessage = `Stopped: 3 different strings failed after retries. Last error: ${result.error ?? "unknown"}`;
            break;
          }
        }

        if (queue.length < 10) await refillQueue();
      }

      const note = await refreshAfterBatch(startedAtView);
      setStatus((stoppedMessage ? `${stoppedMessage} (${done} translated before that.)` : `Overnight batch finished. ${done} strings translated.`) + note);
    } catch (err) {
      setStatus(`Overnight batch stopped unexpectedly after ${done} translated: ${err}`);
    } finally {
      busyRef.current = false;
      setBatchRunning(false);
      refreshCounts();
    }
  }

  async function batchRerunAIUnconfirmed() {
    if (!currentProject) return;
    if (!claimBatchSlot()) return;
    setBatchRunning(true);
    const signal = beginRun();
    const startedAtView = currentViewKey();
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

      if (targets.length === 0) {
        setStatus("There are no AI drafts to re-run.");
        return;
      }
      // This replaces every AI draft in the project, so say so and ask first,
      // then take a backup (the overnight batch does the same).
      const proceed = await confirm(
        `Re-run the AI on ${targets.length} AI draft(s) across the whole project? Each current AI draft will be replaced by a new one. ` +
          "Text you typed or confirmed is not touched. A backup is made first."
      );
      if (!proceed) {
        setStatus("Re-run cancelled.");
        return;
      }
      if (!(await backupBeforeRun())) return; // cancelled; "finally" below frees the buttons
      if (stopRequestedRef.current) {
        setStatus("Stopped before the run began.");
        return; // Stop was pressed while the backup ran
      }

      setBatchProgress({ done: 0, total: targets.length });
      let consecutiveFailures = 0;
      let stoppedMessage = "";

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
          true, // batch context: the Google Translate delay is meant for batch runs
          true, // never replace a confirmed or hand-typed translation
          signal
        );
        if (result.ok) {
          consecutiveFailures = 0;
          if (!result.skipped) done++;
          setBatchProgress({ done, total: targets.length });
        } else if (result.stopped) {
          break;
        } else if (result.permanent) {
          stoppedMessage = permanentProblemMessage(result.error);
          break;
        } else {
          consecutiveFailures++;
          if (consecutiveFailures >= 3) {
            stoppedMessage = `Stopped: 3 failures in a row. Last error: ${result.error ?? "unknown"}`;
            break;
          }
        }
      }

      const note = await refreshAfterBatch(startedAtView);
      setStatus((stoppedMessage ? `${stoppedMessage} (${done} re-translated before that.)` : `Re-run complete. ${done} strings re-translated.`) + note);
    } catch (err) {
      setStatus(`Re-run stopped unexpectedly after ${done} translated: ${err}`);
    } finally {
      busyRef.current = false;
      setBatchRunning(false);
      refreshCounts();
    }
  }

  function stopBatch() {
    stopRequestedRef.current = true;
    abortRef.current?.abort(); // cancels a request still waiting for the provider
    setStatus("Stopping batch...");
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