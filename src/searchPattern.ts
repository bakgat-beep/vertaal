// Turns what a person types into a search box into a database pattern.
//
// Why not just wrap the text in %...% for LIKE, as the search used to?
//   1. In LIKE, "_" means "any one character" and "%" means "any run of
//      characters". Typing "100%" or "character_name" therefore matched things
//      that don't contain those characters. Here every character is literal.
//   2. LIKE ignores capital letters only for A-Z. Searching "östergötland"
//      did not find "Östergötland", nor "é" find "É" - a real gap for
//      Afrikaans (ê, ë, é, ô, û ...) and for names such as "Östergötland".
//
// Accents are NOT ignored: "sê" and "se" stay different words, which matters in
// Afrikaans. Only capitals are.
//
// Two forms of pattern are produced, because the second is slower on a big game
// (about 2x on 225,000 strings) and is only needed when the term has letters
// outside A-Z:
//   - "like": for LIKE ... ESCAPE '\'   (terms with only ASCII characters)
//   - "glob": for GLOB                  (anything else), with each letter written
//                                       as a set of its capital and small form

export interface SearchPattern {
  operator: "LIKE" | "GLOB";
  pattern: string;
  // SQL to put straight after the operator: LIKE needs its escape character
  // declared, GLOB doesn't.
  suffix: string;
}

// The same escaping nameConfirm.ts uses: makes _ % and \ literal inside LIKE.
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

// Keeps a case-converted form only when it is still one character
// (e.g. "ß".toUpperCase() is "SS", which would change the pattern's length).
function singleCharacter(s: string): string | null {
  return Array.from(s).length === 1 ? s : null;
}

function globCharacter(ch: string): string {
  const options = new Set<string>([ch]);
  const lower = singleCharacter(ch.toLowerCase());
  const upper = singleCharacter(ch.toUpperCase());
  if (lower) options.add(lower);
  if (upper) options.add(upper);

  if (options.size === 1) {
    // GLOB's own special characters are made literal by putting them in a set.
    return ch === "*" || ch === "?" || ch === "[" ? `[${ch}]` : ch;
  }
  return `[${Array.from(options).join("")}]`;
}

export function buildSearchPattern(term: string): SearchPattern {
  const text = term.normalize("NFC");
  // Only plain ASCII: LIKE already ignores capitals correctly, and is faster.
  if (/^[\x00-\x7f]*$/.test(text)) {
    return { operator: "LIKE", pattern: `%${escapeLike(text)}%`, suffix: " ESCAPE '\\'" };
  }
  let body = "";
  for (const ch of text) body += globCharacter(ch);
  return { operator: "GLOB", pattern: `*${body}*`, suffix: "" };
}

// The WHERE-clause piece that searches the given columns for the term:
//   (col1 LIKE $3 ESCAPE '\' OR col2 LIKE $4 ESCAPE '\' ...)   or the GLOB form.
// The pattern is appended to `params` once per column, and the $ numbers
// continue from however many parameters `params` already holds.
export function buildSearchClause(columns: string[], term: string, params: (string | number)[]): string {
  const { operator, pattern, suffix } = buildSearchPattern(term);
  const parts = columns.map((column) => {
    params.push(pattern);
    return `${column} ${operator} $${params.length}${suffix}`;
  });
  return `(${parts.join(" OR ")})`;
}

// The editor's Search view: `selectSql` is the usual "strings + their
// translation" SELECT (with $1 = language and $2 = game already filled in).
// Returns the full query plus its parameters, in order.
export function buildSearchPageQuery(
  selectSql: string,
  term: string,
  language: string,
  gameId: string,
  limit: number,
  offset: number
): { sql: string; params: (string | number)[] } {
  const params: (string | number)[] = [language, gameId];
  const where = buildSearchClause(["s.key", "s.source_text", "t.translated_text"], term, params);
  const sql = `${selectSql} AND ${where} ORDER BY s.file_path, s.key LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  return { sql, params: [...params, limit, offset] };
}
