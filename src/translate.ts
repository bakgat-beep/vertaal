import { getDb } from "./db";
import type { Project } from "./types";
import { protectTokens, restoreTokens, validateTokensPreserved } from "./parser";
import { loadGlossaryTerms, matchGlossaryTerms, buildGlossaryInstructions, type GlossaryTerm } from "./glossary";
import { getProjectProvider } from "./providers";
import { getProviderCredentials } from "./providers/credentials.ts";
import { GAME_ADAPTERS } from "./games";
import { isPermanentError } from "./providers/errors";
import { restoreOuterSpacing, describeChattyReply } from "./replyCheck";
import { effectiveDelayMs } from "./delaySettings";

// How long to wait for one reply when the provider does not say otherwise.
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

// Runs one provider request that can be cancelled two ways: the person
// pressing Stop (the caller's signal) and a timeout. Either way the request
// itself is told to abort, and this promise settles straight away even if the
// provider ignores that. Returns what the provider returned, or throws:
//   StoppedError  - the person pressed Stop
//   TimeoutError  - no answer in time (treated as a temporary failure)
class StoppedError extends Error {}
class TimeoutError extends Error {}
async function runCancellable<T>(
  start: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  userSignal?: AbortSignal
): Promise<T> {
  if (userSignal?.aborted) throw new StoppedError("Stopped by user.");
  const controller = new AbortController();
  let cleanup = () => {};
  const interruption = new Promise<never>((_, reject) => {
    const onStop = () => {
      controller.abort();
      reject(new StoppedError("Stopped by user."));
    };
    userSignal?.addEventListener("abort", onStop);
    const timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`No answer within ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    cleanup = () => {
      clearTimeout(timer);
      userSignal?.removeEventListener("abort", onStop);
    };
  });
  interruption.catch(() => {}); // never an unhandled rejection if the request wins
  try {
    return await Promise.race([start(controller.signal), interruption]);
  } finally {
    cleanup();
  }
}

// Waits for ms milliseconds, but gives up the moment the signal fires (the
// Stop button). Resolves true if the whole wait was served, false if it was
// cut short by Stop — so a long pause can never keep a stopped batch waiting.
function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const onStop = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onStop);
      resolve(true);
    }, ms);
    signal?.addEventListener("abort", onStop, { once: true });
  });
}

// Marks a string as "needs a human look" after an AI attempt failed — WITHOUT
// touching any translation the string already has. (Previously a failed AI
// attempt overwrote the row with empty text and an "untranslated" status,
// which silently wiped an existing confirmed translation or draft.) If the
// string has no translation row yet, one is created empty and flagged.
async function flagForReview(
  db: Awaited<ReturnType<typeof getDb>>,
  key: string,
  gameId: string,
  targetLanguage: string,
  attribution: string
) {
  await db.execute(
    `INSERT INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, flagged)
     VALUES ($1, $2, $3, '', 'untranslated', $4, datetime('now'), 1)
     ON CONFLICT(string_key, game_id, target_language) DO UPDATE SET flagged = 1`,
    [key, gameId, targetLanguage, attribution]
  );
}

// Sends one string to the project's configured translation provider, protects
// its game syntax, validates the result, and saves it. currentProject is
// accepted as possibly null (rather than required) so call sites don't each
// need their own "is a project loaded" guard — this mirrors how it worked
// when the function lived in App.tsx and closed over the component's state.
export async function translateAndSave(
  currentProject: Project | null,
  key: string,
  gameId: string,
  sourceText: string,
  // When a caller is translating many strings in one run (see
  // useBatchTranslation.ts), it loads the glossary once up front and passes
  // it here — otherwise translateAndSave fetches it fresh itself, which is
  // what the single-row "Translate" button in the editor still does.
  preloadedGlossaryTerms?: GlossaryTerm[],
  // The Google Translate delay exists to stay restrained with request
  // volume against the free unofficial endpoint during a batch run — it
  // should NOT slow down a single manual click of the per-row "AI" button.
  // Defaults to false so single-string translation stays instant; only the
  // batch functions in useBatchTranslation.ts opt in.
  applyGoogleTranslateDelay: boolean = false,
  // Batch runs set this to true. It means: if the string has meanwhile been
  // confirmed, or has text a person typed (a human draft), leave it alone and
  // report "skipped" instead of replacing it with an AI draft. The check is
  // made at the moment of saving, so it also covers a string you confirm
  // while a batch is running. The single-row "AI" button leaves this false,
  // because there you are deliberately asking for a fresh AI draft.
  skipHumanWork: boolean = false,
  // When it fires (the Stop button), a request already waiting for the
  // provider is cancelled at once instead of being waited out.
  signal?: AbortSignal
): Promise<{ ok: boolean; error?: string; skipped?: boolean; permanent?: boolean; stopped?: boolean }> {
  if (!currentProject) return { ok: false, error: "No project loaded." };
  const provider = getProjectProvider(currentProject);
  if (!provider) {
    return {
      ok: false,
      error:
        currentProject.translation_provider_id === "none"
          ? "This project is set to manual translation only. Choose a translation provider in Project Settings to use AI translation."
          : `No translation provider registered for "${currentProject.translation_provider_id}".`,
    };
  }
  if (provider.requiresModel && !currentProject.ai_model) {
    return { ok: false, error: `No model configured for ${provider.displayName} — set one in Project Settings.` };
  }
  try {
    const { text: protectedText, tokens } = protectTokens(sourceText);
    const terms = preloadedGlossaryTerms ?? (await loadGlossaryTerms(gameId, currentProject.target_language));
    const matchedTerms = matchGlossaryTerms(sourceText, terms);
    const glossaryInstruction =
      matchedTerms.length > 0 ? buildGlossaryInstructions(sourceText, matchedTerms).join("\n") : undefined;

    const credentials = await getProviderCredentials(provider.id);

    if (provider.id === "google-translate" && applyGoogleTranslateDelay) {
      // Stop ends this wait at once; the request after it is then never sent.
      const waited = await sleep(effectiveDelayMs(currentProject.google_translate_delay_ms, 500), signal);
      if (!waited) return { ok: false, error: "Stopped by user.", stopped: true };
    }

    let rawTranslation: string;
    try {
      const result = await runCancellable(
        (requestSignal) =>
          provider.translate(
            {
              text: protectedText,
              sourceLanguage: currentProject.source_language_code_override?.trim() || currentProject.source_language,
              targetLanguage: currentProject.target_language_code_override?.trim() || currentProject.target_language,
              glossaryInstruction,
            },
            {
              providerId: provider.id,
              model: currentProject.ai_model,
              apiKey: credentials.apiKey,
              baseUrl: credentials.baseUrl,
              signal: requestSignal,
            }
          ),
        provider.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        signal
      );
      rawTranslation = result.translatedText.trim();
    } catch (err) {
      if (err instanceof StoppedError) return { ok: false, error: "Stopped by user.", stopped: true };
      if (err instanceof TimeoutError) return { ok: false, error: `Provider error: ${err.message}` };
      return {
        ok: false,
        error: `Provider error: ${err instanceof Error ? err.message : err}`,
        permanent: isPermanentError(err) || undefined,
      };
    }

    // A chat model that answers with chatter around the translation ("Here is
    // the translation: ...", a code block, ...) must not have that chatter
    // saved as game text. Treated as a failed attempt, so it is retried and,
    // if it keeps happening, flagged for a person to look at.
    if (provider.isLlm) {
      const chatty = describeChattyReply(protectedText, rawTranslation);
      if (chatty) return { ok: false, error: `Rejected: ${chatty}.` };
    }
    // An empty reply is not a translation. Saved as it is, it would put a blank
    // "AI draft" into the string (and, from the single-row button, wipe the text
    // that was there). Treated as a failed attempt: retried, and flagged for a
    // person if it keeps happening. A source that is itself blank is left out of
    // this, since there is nothing to translate.
    if (rawTranslation === "" && sourceText.trim() !== "") {
      return { ok: false, error: "The translation provider returned an empty reply." };
    }

    const gm = GAME_ADAPTERS[currentProject.parent_game_id];
    if (gm?.forbiddenCharacters) {
      for (const [bad, good] of Object.entries(gm.forbiddenCharacters)) {
        rawTranslation = rawTranslation.split(bad).join(good);
      }
    }

    const db = await getDb();
    const attribution = currentProject.ai_model ?? provider.displayName;

    if (!validateTokensPreserved(rawTranslation, tokens.length)) {
      await flagForReview(db, key, gameId, currentProject.target_language, attribution);
      return { ok: false, error: "AI response did not preserve required game codes/tokens — flagged for manual review." };
    }

    // Spaces a string started or ended with are kept exactly as in the source.
    const finalTranslation = restoreOuterSpacing(sourceText, restoreTokens(rawTranslation, tokens));

    // Remember what was there before, so History shows a true before/after.
    const previous = (await db.select(
      "SELECT translated_text, status FROM translations WHERE string_key = $1 AND game_id = $2 AND target_language = $3",
      [key, gameId, currentProject.target_language]
    )) as { translated_text: string | null; status: string | null }[];
    const previousText = previous[0]?.translated_text ?? "";

    if (skipHumanWork && (previous[0]?.status === "human-confirmed" || previous[0]?.status === "human-draft")) {
      return { ok: true, skipped: true };
    }

    // ONE statement does the checking and the saving, so there is no gap in
    // which a string you confirm (or start typing) can be replaced: the
    // "WHERE" part is judged by the database at the very moment of writing.
    //  - In a batch run (skipHumanWork), a confirmed or hand-typed row is left
    //    exactly as it is, and the database reports 0 rows changed.
    //  - The flag already on the string is not in the list of things changed,
    //    so it stays.
    // (Unlike the old INSERT OR REPLACE, this also keeps the row's id.)
    const saveResult = await db.execute(
      `INSERT INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, flagged, source_text_at_translation)
       VALUES ($1, $2, $3, $4, 'ai-suggested', $5, datetime('now'), 0, $6)
       ON CONFLICT(string_key, game_id, target_language) DO UPDATE SET
         translated_text = excluded.translated_text,
         status = 'ai-suggested',
         translated_by = excluded.translated_by,
         updated_at = excluded.updated_at,
         source_hash_at_translation = NULL,
         source_text_at_translation = excluded.source_text_at_translation
       WHERE $7 = 0 OR translations.status NOT IN ('human-confirmed', 'human-draft')`,
      // The exact source text that was just translated is recorded, so any
      // later change to it — however small — is noticed.
      [key, gameId, currentProject.target_language, finalTranslation, attribution, sourceText, skipHumanWork ? 1 : 0]
    );
    if (saveResult && saveResult.rowsAffected === 0) {
      // Someone's own work was there at the moment of saving: kept, and nothing
      // is logged as changed because nothing changed.
      return { ok: true, skipped: true };
    }

    await db.execute(
      `INSERT INTO translation_history (string_key, game_id, target_language, old_text, new_text, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [key, gameId, currentProject.target_language, previousText, finalTranslation, attribution]
    );

    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Unexpected error: ${err}` };
  }
}

// Retries translateAndSave up to maxAttempts times with a delay in between,
// so one transient failure (a slow response, a network blip) doesn't
// immediately flag a string for manual review. shouldStop replaces the
// direct stopRequestedRef.current read this used when it lived in
// App.tsx — the caller decides how "stop requested" is tracked (App.tsx
// uses a ref tied to its Stop button).
export async function translateWithRetry(
  currentProject: Project | null,
  key: string,
  gameId: string,
  sourceText: string,
  shouldStop: () => boolean,
  preloadedGlossaryTerms?: GlossaryTerm[],
  maxAttempts: number = 3,
  retryDelayMs?: number,
  // Passed straight through to translateAndSave — true for every batch
  // caller in useBatchTranslation.ts, since that's the only case the
  // Google Translate delay is meant to apply to.
  applyGoogleTranslateDelay: boolean = false,
  // Passed straight through to translateAndSave. Every batch caller sets it
  // to true so a run can never replace confirmed or hand-typed work.
  skipHumanWork: boolean = false,
  signal?: AbortSignal
): Promise<{ ok: boolean; error?: string; attempts: number; skipped?: boolean; permanent?: boolean; stopped?: boolean }> {
  const delay = effectiveDelayMs(retryDelayMs ?? currentProject?.retry_delay_ms, 2000);
  let lastResult: { ok: boolean; error?: string; skipped?: boolean; permanent?: boolean; stopped?: boolean } = {
    ok: false,
    error: "No attempts made.",
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (shouldStop()) {
      return { ok: false, error: "Stopped by user.", attempts: attempt - 1 };
    }
    lastResult = await translateAndSave(currentProject, key, gameId, sourceText, preloadedGlossaryTerms, applyGoogleTranslateDelay, skipHumanWork, signal);
    if (lastResult.ok) {
      return { ok: true, attempts: attempt, skipped: lastResult.skipped };
    }
    // The person pressed Stop: not a failure of this string, so nothing is flagged.
    if (lastResult.stopped) {
      return { ok: false, error: "Stopped by user.", attempts: attempt, stopped: true };
    }
    // Trying again cannot help (wrong key, no quota, bad address...), and the
    // string is not at fault, so don't retry and don't flag it - the problem
    // is in the settings and needs fixing there.
    if (lastResult.permanent) {
      return { ok: false, error: lastResult.error ?? "unknown error", attempts: attempt, permanent: true };
    }
    if (attempt < maxAttempts) {
      // Stop ends the wait between attempts at once, and nothing is flagged:
      // the string was not at fault, the person just stopped the run.
      const waited = await sleep(delay, signal);
      if (!waited) return { ok: false, error: "Stopped by user.", attempts: attempt, stopped: true };
    }
  }

  if (currentProject) {
    try {
      const db = await getDb();
      await flagForReview(db, key, gameId, currentProject.target_language, currentProject.ai_model ?? "");
    } catch {
    }
  }

  return { ok: false, error: `Failed after ${maxAttempts} attempts: ${lastResult.error ?? "unknown error"}`, attempts: maxAttempts };
}