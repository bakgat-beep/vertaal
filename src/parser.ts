export interface ParsedString {
  key: string;
  text: string;
}

export function parseLocFile(content: string): ParsedString[] {
  const results: ParsedString[] = [];
  // Split on Windows (\r\n) and Unix (\n) line endings alike. Splitting on
  // "\n" alone left a stray \r at the end of each Windows line, and a line
  // with a trailing "# comment" then failed to match and was silently skipped.
  const lines = content.split(/\r?\n/);
  // Keys are usually letters, numbers, underscores and dots, but a hyphen is
  // also a legal character in a Paradox loc key and does appear in some
  // mods/games — excluding it meant that whole line was silently skipped on
  // import, with no warning that anything had been left out.
  //
  // The text between the quotes is read as: an escaped pair (\" or \\ and so
  // on) taken as a unit, a bare quote (the game tolerates these), or any
  // other character. Taking \" as a unit matters: previously a line such as
  //   k: "He said \"#bold hi#!\" ok"
  // was cut short at the escaped quote, because what followed it looked like
  // a trailing "# comment", so the translatable text was silently truncated.
  const linePattern = /^\s*([A-Za-z0-9_.-]+):\d*\s*"((?:\\.|[^\\])*?)"\s*(#.*)?$/;
  for (const line of lines) {
    const match = line.match(linePattern);
    if (match) results.push({ key: match[1], text: match[2] });
  }
  return results;
}

export interface ProtectedText {
  text: string;
  tokens: string[];
}

export function protectTokens(source: string): ProtectedText {
const tokenPattern =
    /#!|#tooltippable;tooltip:\S+|#tooltip:\S+|#[A-Za-z_][A-Za-z0-9_]*(:\d+)?(;[A-Za-z_][A-Za-z0-9_]*(:\d+)?)*|§!|§[A-Za-z0-9_]|£[^£]+£|£\S+|\$\$|\$[^$]+\$|\[[^\]]+\]|@[A-Z]{2,4}\b|@\S+!|\\n|\\t/g;
  const tokens: string[] = [];
  const text = source.replace(tokenPattern, (match) => {
    tokens.push(match);
    return `__TOKEN_${tokens.length - 1}__`;
  });
  return { text, tokens };
}

export function restoreTokens(translatedText: string, tokens: string[]): string {
  let result = translatedText;
  tokens.forEach((token, i) => {
    // The replacement is given as a function, NOT as plain text: JavaScript
    // treats a "$" inside replacement text as a special instruction ("$$"
    // becomes "$", "$'" pastes in the text after the match, and so on), which
    // silently corrupted game codes such as HOI4's "$$" or "[GetX('a$')]".
    // A function's return value is always used exactly as it is.
    result = result.replace(`__TOKEN_${i}__`, () => token);
  });
  return result;
}

// Prepares a translation to be written between the quotes of a loc file line.
//
// The text Vertaal stores is the game's own file text: line breaks are already
// the two characters \n, and quotes inside the text may already be \" — they
// were imported exactly as written. So only what is NOT already a valid
// escape needs fixing:
//   - a valid escape pair (\n  \t  \"  \\) is left exactly as it is;
//   - a bare quote " becomes \";
//   - a bare backslash (not part of a valid escape) becomes \\;
//   - a real line break (someone pressing Enter in the text box) becomes \n,
//     because a loc entry must stay on ONE line.
// (Doubling every backslash, as an earlier version did, turned every \n line
// break into \\n, which the game shows as the letters "\n".)
export function escapeForLocExport(text: string): string {
  return text
    .replace(/\\[nt"\\]|["\\]/g, (m) => (m.length === 2 ? m : "\\" + m))
    .replace(/\r\n|\r|\n/g, "\\n");
}

export function validateTokensPreserved(translatedText: string, tokenCount: number): boolean {
  const matches = translatedText.match(/__TOKEN_(\d+)__/g) ?? [];
  if (matches.length !== tokenCount) return false;

  const seenIndices = new Set<number>();
  for (const match of matches) {
    const index = Number(match.match(/\d+/)![0]);
    if (index < 0 || index >= tokenCount) return false; // invented/out-of-range token
    seenIndices.add(index);
  }
  return seenIndices.size === tokenCount; // every expected index appears exactly once
}