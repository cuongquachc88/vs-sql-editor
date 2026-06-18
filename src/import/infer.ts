import type { InferredType } from "./sql-types";

const INT_RE = /^-?\d+$/;
const REAL_RE = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

// Infer a column type by scanning rows. Empty strings are treated as nulls and
// don't constrain the type. As soon as a value doesn't match a tighter type, we
// widen toward `text`.
export function inferTypes(
  rows: string[][],
  opts?: { sampleSize?: number },
): InferredType[] {
  if (rows.length === 0) return [];
  const sample = Math.min(opts?.sampleSize ?? 200, rows.length);
  const ncols = rows[0]?.length ?? 0;
  // `undefined` = no non-null value seen yet; first value takes the type as-is.
  const out: (InferredType | undefined)[] = new Array(ncols).fill(undefined);

  for (let i = 0; i < sample; i++) {
    const r = rows[i];
    for (let c = 0; c < ncols; c++) {
      const v = (r[c] ?? "").trim();
      if (v === "") continue;
      const next = classify(v);
      out[c] = out[c] === undefined ? next : widen(out[c]!, next);
    }
  }
  // Columns that were entirely null/empty fall back to text.
  return out.map((t) => t ?? "text");
}

function classify(v: string): InferredType {
  if (INT_RE.test(v)) return "integer";
  if (REAL_RE.test(v)) return "real";
  const lo = v.toLowerCase();
  if (lo === "true" || lo === "false" || lo === "t" || lo === "f") return "boolean";
  return "text";
}

// Type lattice: integer < real < text; boolean only narrows.
function widen(current: InferredType, next: InferredType): InferredType {
  if (current === next) return current;
  if (current === "text" || next === "text") return "text";
  if (current === "boolean" || next === "boolean") return "text";
  if (current === "integer" && next === "real") return "real";
  if (current === "real" && next === "integer") return "real";
  return "text";
}
