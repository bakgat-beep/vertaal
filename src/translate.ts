import { getDb } from "./db";
import type { Project } from "./types";
import { protectTokens, restoreTokens, validateTokensPreserved } from "./parser";
import { loadGlossaryTerms, matchGlossaryTerms, buildGlossaryInstructions, type GlossaryTerm } from "./glossary";
import { getProjectProvider } from "./providers";
import { getProviderCredentials } from "./providers/credentials.ts";
import { GAME_ADAPTERS } from "./games";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  preloadedGlossaryTerms?: GlossaryTerm[]
): Promise<{ ok: boolean; error?: string }> {
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

    if (provider.id === "google-translate") {
      await sleep(currentProject.google_translate_delay_ms ?? 500);
    }

    let rawTranslation: string;
    try {
      const result = await provider.translate(
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
        }
      );
      rawTranslation = result.translatedText.trim();
    } catch (err) {
      return { ok: false, error: `Provider error: ${err}` };
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

    const finalTranslation = restoreTokens(rawTranslation, tokens);

    // Remember what was there before, so History shows a true before/after.
    const previous = (await db.select(
      "SELECT translated_text FROM translations WHERE string_key = $1 AND game_id = $2 AND target_language = $3",
      [key, gameId, currentProject.target_language]
    )) as { translated_text: string | null }[];
    const previousText = previous[0]?.translated_text ?? "";

    await db.execute(
      `INSERT OR REPLACE INTO translations (string_key, game_id, target_language, translated_text, status, translated_by, updated_at, flagged, source_text_at_translation)
       VALUES ($1, $2, $3, $4, 'ai-suggested', $5, datetime('now'), COALESCE((SELECT flagged FROM translations WHERE string_key = $6 AND game_id = $7 AND target_language = $8), 0), $9)`,
      // The exact source text that was just translated is recorded, so any
      // later change to it — however small — is noticed.
      [key, gameId, currentProject.target_language, finalTranslation, attribution, key, gameId, currentProject.target_language, sourceText]
    );

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
  retryDelayMs?: number
): Promise<{ ok: boolean; error?: string; attempts: number }> {
  const delay = retryDelayMs ?? currentProject?.retry_delay_ms ?? 2000;
  let lastResult: { ok: boolean; error?: string } = { ok: false, error: "No attempts made." };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (shouldStop()) {
      return { ok: false, error: "Stopped by user.", attempts: attempt - 1 };
    }
    lastResult = await translateAndSave(currentProject, key, gameId, sourceText, preloadedGlossaryTerms);
    if (lastResult.ok) {
      return { ok: true, attempts: attempt };
    }
    if (attempt < maxAttempts) {
      await sleep(delay);
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