// Splits a SQL string into individual statements on top-level `;`. Respects:
// - single-quoted strings with `''` escape
// - double-quoted identifiers with `""` escape
// - line comments (`-- ...`)
// - block comments (`/* ... */`)
//
// Trailing whitespace and empty statements are stripped. Returns an array of
// trimmed statement strings (without their terminating `;`).
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  const n = sql.length;
  let inSingle = false;
  let inDouble = false;
  let inLine = false;
  let inBlock = false;

  while (i < n) {
    const c = sql[i];
    const next = i + 1 < n ? sql[i + 1] : "";

    if (inLine) {
      buf += c;
      if (c === "\n") inLine = false;
      i++;
      continue;
    }
    if (inBlock) {
      buf += c;
      if (c === "*" && next === "/") {
        buf += next;
        i += 2;
        inBlock = false;
        continue;
      }
      i++;
      continue;
    }
    if (inSingle) {
      buf += c;
      if (c === "'") {
        if (next === "'") {
          buf += next;
          i += 2;
          continue;
        }
        inSingle = false;
      }
      i++;
      continue;
    }
    if (inDouble) {
      buf += c;
      if (c === '"') {
        if (next === '"') {
          buf += next;
          i += 2;
          continue;
        }
        inDouble = false;
      }
      i++;
      continue;
    }

    // Not inside any quote/comment
    if (c === "-" && next === "-") {
      buf += c + next;
      i += 2;
      inLine = true;
      continue;
    }
    if (c === "/" && next === "*") {
      buf += c + next;
      i += 2;
      inBlock = true;
      continue;
    }
    if (c === "'") {
      buf += c;
      inSingle = true;
      i++;
      continue;
    }
    if (c === '"') {
      buf += c;
      inDouble = true;
      i++;
      continue;
    }
    if (c === ";") {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }

  const last = buf.trim();
  if (last) out.push(last);
  return out;
}
