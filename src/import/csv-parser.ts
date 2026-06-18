// Minimal RFC 4180 CSV parser — no dep. Handles:
//  - quoted fields (with embedded delimiter, newline, CR, double-quoted escape "")
//  - configurable delimiter (default ',')
//  - LF / CRLF line endings
//  - leading UTF-8 BOM
//  - trailing empty row from a final newline
export function parseCsv(text: string, opts?: { delimiter?: string }): string[][] {
  const delim = opts?.delimiter ?? ",";
  if (delim.length !== 1) throw new Error("delimiter must be a single character");
  // Strip leading UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let i = 0;
  let inQuotes = false;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === delim) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      // CR or CRLF — treat both as end-of-row
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      if (text[i] === "\n") i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush the last field/row only if there's any content (to drop empty trailing newlines).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
