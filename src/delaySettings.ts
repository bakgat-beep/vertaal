// The two "wait a bit" settings in Project Settings: the pause between retry
// attempts, and the pause before each Google Translate request in a batch.
// Both are in milliseconds (1000 ms = 1 second).

// The longest pause allowed: one minute. Anything longer is almost certainly a
// typo (an extra zero turns 2 seconds into 20), and would make a batch look
// frozen.
export const MAX_DELAY_MS = 60_000;

export type DelayParse = { ok: true; value: number } | { ok: false; message: string };

// Checks what was typed into a delay box: a whole number from 0 to MAX_DELAY_MS.
// (parseInt alone would quietly accept "12abc" as 12, so the whole text is checked.)
export function parseDelayMs(text: string, label: string): DelayParse {
  const trimmed = text.trim();
  const value = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  if (!Number.isSafeInteger(value) || value > MAX_DELAY_MS) {
    return {
      ok: false,
      message: `${label} must be a whole number of milliseconds from 0 to ${MAX_DELAY_MS} (${MAX_DELAY_MS / 1000} seconds at most).`,
    };
  }
  return { ok: true, value };
}

// What to actually wait, when reading a value saved earlier. A project saved
// before the limit existed (or edited by hand) may hold a huge or odd number;
// that is capped here instead of being trusted.
export function effectiveDelayMs(saved: number | null | undefined, fallback: number): number {
  if (typeof saved !== "number" || !Number.isFinite(saved) || saved < 0) return fallback;
  return Math.min(Math.floor(saved), MAX_DELAY_MS);
}