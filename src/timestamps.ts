// A timestamp saved locally (a confirm, a draft save, a flag) comes from
// SQLite's datetime('now'): "YYYY-MM-DD HH:MM:SS", UTC, with no timezone
// marker. A timestamp that arrived via a merged/imported file instead uses a
// full ISO 8601 string ("...T...Z", see portableExport.ts). Both mean UTC;
// only their spelling differs.
//
// Parsing SQLite's bare format directly is unreliable — some JavaScript
// engines read "YYYY-MM-DD HH:MM:SS" as UTC, others as local time, so the
// same stored moment could display differently depending on where Vertaal is
// running. Converting it to an unambiguous ISO UTC string first (and leaving
// an already-ISO string alone) makes every timestamp parse the same way
// everywhere, so what's shown is always converted to the viewer's own local
// time correctly.
function toIsoUtc(rawTimestamp: string): string {
  const trimmed = rawTimestamp.trim();
  return trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}Z`;
}

export function formatLocalTimestamp(rawTimestamp: string): string {
  const date = new Date(toIsoUtc(rawTimestamp));
  if (isNaN(date.getTime())) return rawTimestamp; // fall back to the raw value rather than showing "Invalid Date"
  return date.toLocaleString();
}

// Compares two saved timestamps that may be in EITHER format (see the
// comment above) by the actual moment they represent, not as plain text.
// Comparing the raw strings directly is a real bug, not just a style
// choice: SQLite's format uses a space before the time ("2026-01-15
// 23:59:59") and the ISO format uses "T" ("2026-01-15T00:00:01.000Z") — and
// a space sorts before "T" in plain text, so a SQLite-formatted timestamp
// always compares as "earlier" than an ISO one for the same day, EVEN WHEN
// the SQLite time is actually later in the day. Used when deciding whether
// a local translation is newer than one arriving from a merge/import.
export function isAtLeastAsNew(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const timeA = new Date(toIsoUtc(a)).getTime();
  const timeB = new Date(toIsoUtc(b)).getTime();
  if (isNaN(timeA) || isNaN(timeB)) return a >= b; // fall back to the old behaviour rather than throw
  return timeA >= timeB;
}