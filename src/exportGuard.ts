import { checkTokenIntegrity } from "./tokenIntegrity";

// The last safety net before a string goes into the exported mod. Every
// confirmed string is compared once more with its source text, using the very
// same game-code check as the Verify button (see tokenIntegrity.ts): each
// protected code in the source ($VARIABLES$, [functions], icons, colour codes,
// line breaks ...) must appear in the translation exactly as many times.
//
// A string can be confirmed and still fail this - it may have been confirmed
// by an older version of Vertaal, edited later, or arrived through a merge. The
// ones that fail are HELD BACK: left out of the export, never changed in the
// database, and counted so the person can see it happened.
export function splitByGameCodes<T extends { source_text: string; translated_text: string }>(
  rows: T[]
): { clean: T[]; heldBack: T[] } {
  const clean: T[] = [];
  const heldBack: T[] = [];
  for (const row of rows) {
    if (checkTokenIntegrity(row.source_text, row.translated_text).length > 0) heldBack.push(row);
    else clean.push(row);
  }
  return { clean, heldBack };
}