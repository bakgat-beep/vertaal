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