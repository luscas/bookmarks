/**
 * Replace control characters (including NUL) with spaces. SQLite's FTS5 `MATCH`
 * parser rejects them outright, which would otherwise surface as a 500.
 */
function stripControlCharacters(input: string): string {
  let result = "";
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    result += code < 0x20 || code === 0x7f ? " " : char;
  }
  return result;
}

/**
 * Sanitize user input into a safe FTS5 `MATCH` expression.
 *
 * Every whitespace-separated term is wrapped in double quotes so FTS5 treats it
 * as a literal phrase; embedded quotes are dropped. Terms are joined by spaces,
 * which FTS5 interprets as an implicit AND. Returns an empty string when
 * nothing usable remains, in which case callers skip the search filter.
 */
export function buildFtsQuery(input: string): string {
  const terms: string[] = [];
  for (const raw of stripControlCharacters(input).split(/\s+/)) {
    const term = raw.replace(/"/g, "").trim();
    if (term.length > 0) {
      terms.push(`"${term}"`);
    }
  }
  return terms.join(" ");
}
