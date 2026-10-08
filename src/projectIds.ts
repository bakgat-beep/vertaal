// The internal "game id" a project's source strings are stored under.
//
// All the source texts of one game id live together: a string is identified
// by its key plus the game id. Texts read from the game's English files and
// texts read from its French files are DIFFERENT texts, so they must never
// share a game id - otherwise importing the French files would overwrite the
// English wording of every string that exists in both. So:
//
//   - a project reading the game's default source language keeps the plain
//     id it has always had ("eu5", or "eu5:mod:my-mod" for a mod), which is
//     why every existing project keeps working untouched;
//   - a project reading any other source language gets ":src:<language>"
//     added ("eu5:src:french"), giving it its own separate set of strings.
//
// (This is also what keeps each project's game-specific glossary and shared
// export files separate between source languages.)
export function buildProjectGameId(options: {
  gameId: string;
  modSlug?: string | null; // set for a mod project
  sourceLanguage: string;
  defaultSourceLanguage: string;
}): string {
  const base = options.modSlug ? `${options.gameId}:mod:${options.modSlug}` : options.gameId;
  const source = options.sourceLanguage.trim().toLowerCase();
  if (source === "" || source === options.defaultSourceLanguage.trim().toLowerCase()) return base;
  return `${base}:src:${source}`;
}