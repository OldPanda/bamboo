/** A workspace table and any known columns available for local suggestions. */
export interface SQLTable {
  name: string;
  columns?: string[];
}
/** Tables visible to the current read-only query editor. */
export interface SQLCompletionContext {
  tables: SQLTable[];
}
type Token = {
  text: string;
  start: number;
  end: number;
  kind: "word" | "quoted" | "string" | "symbol";
};
const keywords = [
  "SELECT",
  "FROM",
  "WHERE",
  "ORDER BY",
  "GROUP BY",
  "LIMIT",
  "OFFSET",
  "LEFT JOIN",
  "INNER JOIN",
  "JOIN",
  "ON",
  "AS",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "IS NULL",
  "IS NOT NULL",
  "DISTINCT",
  "HAVING",
  "UNION ALL",
  "UNION",
  "WITH",
  "ASC",
  "DESC",
  "BETWEEN",
  "IN",
  "LIKE",
  "ILIKE",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COALESCE",
  "CAST",
];
const word = /[\p{L}\p{N}_$]/u;
const identifier = (name: string) =>
  /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) &&
  !keywords.includes(name.toUpperCase())
    ? name
    : `"${name.replaceAll('"', '""')}"`;
const normalized = (name: string) => name.toLowerCase();

// Lightweight lexical context, not a SQL validator. Ignore literal/comment contents.
function lex(text: string): {
  tokens: Token[];
  blocked: boolean;
  quote?: number;
} {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    const start = i;
    if (text.startsWith("--", i)) {
      const end = text.indexOf("\n", i + 2);
      if (end < 0) return { tokens, blocked: true };
      i = end + 1;
      continue;
    }
    if (text.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < text.length && depth) {
        if (text.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (text.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth) return { tokens, blocked: true };
      continue;
    }
    const dollar = text.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
    if (dollar) {
      const end = text.indexOf(dollar, i + dollar.length);
      if (end < 0) return { tokens, blocked: true };
      i = end + dollar.length;
      tokens.push({
        text: text.slice(start, i),
        start,
        end: i,
        kind: "string",
      });
      continue;
    }
    if (text[i] === "'" || text[i] === '"') {
      const quote = text[i++];
      let closed = false;
      while (i < text.length) {
        if (text[i] === quote) {
          if (text[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        // Be conservative around escaped string quotes, including E'…'.
        if (quote === "'" && text[i] === "\\") i += 2;
        else i++;
      }
      if (!closed)
        return {
          tokens,
          blocked: quote === "'",
          quote: quote === '"' ? start : undefined,
        };
      tokens.push({
        text: text.slice(start, i),
        start,
        end: i,
        kind: quote === '"' ? "quoted" : "string",
      });
      continue;
    }
    if (word.test(text[i])) {
      while (i < text.length && word.test(text[i])) i++;
      tokens.push({ text: text.slice(start, i), start, end: i, kind: "word" });
      continue;
    }
    tokens.push({ text: text[i], start, end: ++i, kind: "symbol" });
  }
  return { tokens, blocked: false };
}

/** Only a suffix is returned: completion never replaces existing SQL or runs it. */
export function suggestSQL(
  text: string,
  caret: number,
  context: SQLCompletionContext,
): string {
  if (
    caret < 0 ||
    caret > text.length ||
    text.slice(caret).split("\n")[0].trim()
  )
    return "";
  const before = text.slice(0, caret);
  const parsed = lex(before);
  if (parsed.blocked) return "";
  let start = caret;
  const last = parsed.tokens.at(-1);
  if (parsed.quote !== undefined) start = parsed.quote;
  else if (last?.end === caret && last.kind === "word") start = last.start;
  else if (
    last?.end === caret &&
    (last.kind === "quoted" || last.kind === "string")
  )
    return "";
  let fragment = before.slice(start);
  if (/^\d/.test(fragment)) return "";
  let statementStart = -1;
  parsed.tokens.forEach((token, index) => {
    if (token.text === ";") statementStart = index;
  });
  const tokens = parsed.tokens
    .slice(statementStart + 1)
    .filter((t) => t.end <= start);
  let qualifier = "";
  if (
    tokens.at(-1)?.text === "." &&
    ["word", "quoted"].includes(tokens.at(-2)?.kind || "")
  ) {
    const name = tokens.at(-2)!;
    qualifier = name.text;
    fragment = before.slice(name.start);
    tokens.splice(-2);
  }
  const prior = tokens.at(-1)?.text.toUpperCase() || "";
  const tablePosition = ["FROM", "JOIN"].includes(prior);
  const aliases = new Map<string, SQLTable>();
  const referenced = new Set<SQLTable>();
  // Include complete FROM/JOIN references later in the query for SELECT-column hints.
  const fullTokens = lex(text).tokens;
  const nextStatement =
    fullTokens.find((t) => t.start >= caret && t.text === ";")?.start ??
    text.length;
  const boundary = parsed.tokens[statementStart]?.end ?? 0;
  const sourceTokens = fullTokens.filter(
    (t) => t.start >= boundary && t.end <= nextStatement,
  );
  for (let i = 0; i < sourceTokens.length; i++) {
    if (!["FROM", "JOIN"].includes(sourceTokens[i].text.toUpperCase()))
      continue;
    let j = i + 1;
    if (!sourceTokens[j]) continue;
    let name = sourceTokens[j++].text;
    if (sourceTokens[j]?.text === "." && sourceTokens[j + 1]) {
      name += "." + sourceTokens[j + 1].text;
      j += 2;
    }
    const table = context.tables.find(
      (t) => normalized(t.name) === normalized(name),
    );
    if (!table) continue;
    referenced.add(table);
    aliases.set(normalized(name), table);
    if (sourceTokens[j]?.text.toUpperCase() === "AS") j++;
    const alias = sourceTokens[j];
    if (
      alias &&
      ["word", "quoted"].includes(alias.kind) &&
      !keywords.includes(alias.text.toUpperCase().split(" ")[0])
    )
      aliases.set(normalized(alias.text), table);
  }
  let candidates: string[];
  if (tablePosition || normalized(qualifier) === "workspace") {
    candidates = context.tables.map((t) => t.name);
  } else if (qualifier) {
    candidates = (aliases.get(normalized(qualifier))?.columns || []).map(
      (c) => `${qualifier}.${identifier(c)}`,
    );
  } else {
    const tables = referenced.size
      ? [...referenced]
      : context.tables.filter((t) => t.name === "data");
    const columns = [...new Set(tables.flatMap((t) => t.columns || []))].map(
      identifier,
    );
    if (!tokens.length && !fragment) return "";
    if (!tokens.length) candidates = ["SELECT", "WITH"];
    else if (["ORDER", "GROUP"].includes(prior)) candidates = ["BY"];
    else if (!fragment)
      candidates =
        prior === "SELECT"
          ? ["*"]
          : ["WHERE", "AND", "OR", "ON", "BY", ","].includes(prior)
            ? columns
            : [];
    else candidates = [...columns, ...keywords];
    const lower = fragment
      ? fragment === fragment.toLowerCase()
      : /[a-z]/.test(tokens.at(-1)?.text || "");
    candidates = candidates.map((c) =>
      keywords.includes(c) || c === "BY" ? (lower ? c.toLowerCase() : c) : c,
    );
  }
  const candidate = candidates.find((c) => {
    if (
      c.length <= fragment.length ||
      !normalized(c).startsWith(normalized(fragment))
    )
      return false;
    // Quoted workspace paths are object keys, so do not silently change their case.
    const quote = fragment.indexOf('"');
    return (
      !(tablePosition || normalized(qualifier) === "workspace") ||
      quote < 0 ||
      c.slice(quote).startsWith(fragment.slice(quote))
    );
  });
  return candidate?.slice(fragment.length) || "";
}
