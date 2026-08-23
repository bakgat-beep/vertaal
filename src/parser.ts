export interface ParsedString {
  key: string;
  text: string;
}

export function parseLocFile(content: string): ParsedString[] {
  const results: ParsedString[] = [];
  const lines = content.split("\n");
  const linePattern = /^\s*([A-Za-z0-9_.]+):\d*\s*"(.*)"\s*$/;
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
  const tokenPattern = /#!|#[A-Za-z_][A-Za-z0-9_]*|\$[^$]+\$|\[[^\]]+\]|@\S+!/g;
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

// Confirms the translation didn't drop, duplicate, or mangle any protected
// token placeholders — the one automated check that catches a model breaking
// game-critical syntax like $VAR$ or [Function] codes.
export function validateTokensPreserved(translatedText: string, tokenCount: number): boolean {
  const matches = translatedText.match(/__TOKEN_\d+__/g) ?? [];
  if (matches.length !== tokenCount) return false;

  const seen = new Set(matches);
  return seen.size === tokenCount; // catches duplicated tokens too, not just wrong count
}