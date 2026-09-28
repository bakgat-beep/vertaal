import { protectTokens } from "./parser";

// One protected code (a variable like $NAME$, an icon, a colour code, a line
// break, ...) that appears a different number of times in the translation
// than in the source text — either dropped, or duplicated by mistake.
export interface TokenIntegrityIssue {
  token: string;
  expectedCount: number;
  foundCount: number;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    count++;
    pos = idx + needle.length;
  }
  return count;
}

// Compares a confirmed translation against its source text using the same
// token detector the AI pipeline uses (protectTokens, see parser.ts): every
// protected code found in the source must appear in the translation exactly
// as many times. Returns one issue per code that doesn't match; an empty
// array means the translation is clean. Order is not checked — word order
// legitimately changes between languages.
export function checkTokenIntegrity(sourceText: string, translatedText: string): TokenIntegrityIssue[] {
  const { tokens } = protectTokens(sourceText);
  if (tokens.length === 0) return [];

  const expectedCounts = new Map<string, number>();
  for (const token of tokens) {
    expectedCounts.set(token, (expectedCounts.get(token) ?? 0) + 1);
  }

  const issues: TokenIntegrityIssue[] = [];
  for (const [token, expectedCount] of expectedCounts) {
    const foundCount = countOccurrences(translatedText, token);
    if (foundCount !== expectedCount) {
      issues.push({ token, expectedCount, foundCount });
    }
  }
  return issues;
}