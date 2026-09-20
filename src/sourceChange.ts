// Everything about noticing — and showing — that a game's source text changed
// after a string was translated.
//
// How it works: a translation records the source text it was made against
// (translations.source_text_at_translation), but ONLY once that text has
// changed — until then the column is empty (NULL), meaning "made against the
// current source text", so nothing is stored twice. When a re-import changes a
// string's source text, the database itself (migration 0020) moves the old
// wording into that column for every translation that was up to date with it.
// A string then counts as "changed" while the stored wording differs from the
// current source text. It is a comparison of the real text — not a shortened
// fingerprint — so a single swapped digit, an added comma, or an extra space
// all count, and the editor can show exactly what changed.
//
// It applies to confirmed and draft translations alike, and it compares each
// translation with the wording it was made against — not with the very first
// import. Confirming a translation again (after checking it against the
// current text) clears the flag.

// Stored instead of real text for translations that the OLD length-plus-first-
// 20-characters check had already flagged as changed, before the earlier
// wording was recorded anywhere. It never equals a real source text, so those
// strings stay flagged; the editor just can't show what the old wording was.
// This exact text is also written by migration 0019 — keep them in sync.
export const SOURCE_TEXT_UNKNOWN = "[[vertaal:older-source-not-recorded]]";

// Shape needed to decide whether a string's source has changed.
export interface SourceChangeInput {
  source_text: string;
  source_text_at_translation: string | null;
  // 'untranslated' (or none) = a placeholder with no translation
  status: string | null;
}

// Must stay identical to SQL_OUTDATED in statusFilters.ts (that is what the
// sidebar counts and lists use); this is the same rule for one row on screen.
export function isSourceChanged(row: SourceChangeInput): boolean {
  if (row.source_text_at_translation === null) return false; // made against the current text
  if (row.status === null || row.status === "untranslated") return false; // no translation to be out of date
  return row.source_text_at_translation !== row.source_text;
}

// The OLD fingerprint (length + first 20 characters). No longer used to detect
// changes; kept only to read exports made by older versions of Vertaal, which
// carry that fingerprint instead of the real text.
export function legacySourceHash(text: string): string {
  return String(text.length) + "-" + text.slice(0, 20);
}

// ---- Showing what changed ----

export interface DiffPart {
  text: string;
  kind: "same" | "removed" | "added";
}

// Word-by-word comparison (spaces and line breaks count as their own pieces,
// so a change in spacing is visible too). Joining the "same" and "removed"
// parts gives back `before` exactly; joining "same" and "added" gives `after`.
export function diffWords(before: string, after: string): DiffPart[] {
  const a = before.match(/\s+|\S+/g) ?? [];
  const b = after.match(/\s+|\S+/g) ?? [];

  // Game strings are short, but guard against a pathological giant one: fall
  // back to "everything replaced" rather than freezing the screen.
  if (a.length * b.length > 250_000) {
    return [
      { text: before, kind: "removed" },
      { text: after, kind: "added" },
    ];
  }

  // Longest-common-subsequence table.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const push = (text: string, kind: DiffPart["kind"]) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ text, kind });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(a[i], "same");
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push(a[i], "removed");
      i++;
    } else {
      push(b[j], "added");
      j++;
    }
  }
  while (i < a.length) push(a[i++], "removed");
  while (j < b.length) push(b[j++], "added");
  return parts;
}

// True when the two texts differ only in spacing / line breaks — worth saying
// out loud, because such a change is otherwise nearly invisible on screen.
export function isWhitespaceOnlyChange(before: string, after: string): boolean {
  if (before === after) return false;
  return before.replace(/\s+/g, " ").trim() === after.replace(/\s+/g, " ").trim();
}

// ---- Merging translations from another machine ----

export interface ImportedTranslationSource {
  // The exporter's CURRENT source text for the string.
  source_text?: string;
  // Format 2+: the source text the translation was made against, written only
  // when it differs from source_text (absent/null = they are the same).
  source_text_at_translation?: string | null;
  // Format 1 (older Vertaal): the old length-plus-20-characters fingerprint of
  // the source text the translation was made against.
  source_text_hash?: string | null;
}

// Decides what "translated against" text to record for a translation merged in
// from a shared file, so change detection keeps working across collaborators:
//  - new files state it exactly;
//  - old files only carry the old fingerprint, which is matched against the
//    exporter's text and this machine's text to recover the real wording where
//    possible, and otherwise leaves the string flagged as changed;
//  - with nothing to go on, the current local text is used from now on.
export function baselineForImportedTranslation(
  incoming: ImportedTranslationSource,
  localSourceText: string,
  formatVersion: number
): string {
  if (formatVersion >= 2) {
    return incoming.source_text_at_translation ?? incoming.source_text ?? localSourceText;
  }

  const hash = incoming.source_text_hash;
  if (hash === null || hash === undefined) return localSourceText;
  if (incoming.source_text !== undefined && hash === legacySourceHash(incoming.source_text)) return incoming.source_text;
  if (hash === legacySourceHash(localSourceText)) return localSourceText;
  return SOURCE_TEXT_UNKNOWN;
}