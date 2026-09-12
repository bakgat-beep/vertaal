export interface ParsedString {
  key: string;
  text: string;
}

export function parseLocFile(content: string): ParsedString[] {
  const results: ParsedString[] = [];
  const lines = content.split("\n");
  const linePattern = /^\s*([A-Za-z0-9_.]+):\d*\s*"(.*?)"\s*(#.*)?$/;
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
    result = result.replace(`__TOKEN_${i}__`, token);
  });
  return result;
}

export function escapeForLocExport(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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