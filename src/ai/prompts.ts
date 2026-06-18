import type { EngineId, SchemaModel } from "../drivers/types";

const MAX_SCHEMA_CHARS = 30_000;

// Compact schema digest: `schema.table (col type pk, col type, … FK→other(x))`.
export function buildSchemaDigest(model: SchemaModel | undefined): string {
  if (!model) return "(no schema available)";
  const lines: string[] = [];
  for (const db of model.databases) {
    for (const sc of db.schemas) {
      for (const t of sc.tables) {
        const cols = t.columns
          .map((c) => `${c.name} ${c.type}${t.primaryKey.includes(c.name) ? " pk" : ""}`)
          .join(", ");
        const fks = t.foreignKeys
          .map(
            (fk) =>
              ` FK ${fk.columns.join(",")}->${fk.refSchema ? fk.refSchema + "." : ""}${fk.refTable}(${fk.refColumns.join(",")})`,
          )
          .join("");
        const kind = t.isView ? "view " : "";
        lines.push(`${kind}${sc.name}.${t.name}(${cols})${fks}`);
      }
    }
  }
  return lines.join("\n");
}

// When the digest is too large, keep only tables whose names appear in the
// user query, plus a small leading sample. Token-based, case-insensitive.
export function pickRelevantDigest(model: SchemaModel | undefined, query: string): string {
  const full = buildSchemaDigest(model);
  if (full.length <= MAX_SCHEMA_CHARS) return full;
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 3);
  const lines = full.split("\n");
  const kept: string[] = [];
  let totalLen = 0;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (terms.some((t) => lower.includes(t))) {
      kept.push(line);
      totalLen += line.length + 1;
      if (totalLen > MAX_SCHEMA_CHARS) break;
    }
  }
  if (kept.length === 0) {
    // Last resort: truncate the head.
    return full.slice(0, MAX_SCHEMA_CHARS) + "\n(… truncated)";
  }
  return kept.join("\n") + "\n(filtered to relevant tables)";
}

const ENGINE_NOTES: Record<EngineId, string> = {
  postgres:
    "PostgreSQL. Identifiers in double quotes. Use `SELECT` with explicit column lists. Snake_case is conventional.",
  pglite:
    "PostgreSQL (PGlite, in-process). Identifiers in double quotes. Snake_case is conventional.",
  mysql:
    "MySQL. Identifiers in backticks. Single quotes for strings. Avoid CTEs older than 8.0 if relevant.",
  sqlite: "SQLite. Identifiers in double quotes. Single quotes for strings. Pragmatic and permissive.",
  clickhouse:
    "ClickHouse. Identifiers in double quotes. Be aware of MergeTree engines and column-oriented patterns.",
};

export interface PromptInputs {
  engine: EngineId;
  schemaDigest: string;
  question: string;
}

export function buildNlToSqlPrompt(p: PromptInputs): { system: string; user: string } {
  const system = `You convert natural-language questions into a single SQL query for the user.
${ENGINE_NOTES[p.engine]}

Rules:
- Return only the SQL, with no markdown code fences and no explanation.
- One statement only. End with a semicolon.
- If the question is ambiguous, make the most likely interpretation and proceed.
- Use the schema below; do not invent table or column names.

Schema:
${p.schemaDigest}`;
  const user = p.question;
  return { system, user };
}

export interface ExplainInputs {
  engine: EngineId;
  schemaDigest: string;
  sql: string;
}

export function buildExplainPrompt(p: ExplainInputs): { system: string; user: string } {
  const system = `You explain SQL queries in plain English to a developer.
${ENGINE_NOTES[p.engine]}
Use short paragraphs. Mention what tables are touched, the filters applied, and any joins or aggregations.

Schema (for context, do not regurgitate):
${p.schemaDigest}`;
  const user = `Explain this query:\n\n${p.sql}`;
  return { system, user };
}

export interface FixInputs {
  engine: EngineId;
  schemaDigest: string;
  sql: string;
  errorMessage: string;
}

export function buildFixPrompt(p: FixInputs): { system: string; user: string } {
  const system = `You fix a broken SQL query, given the error message the engine returned.
${ENGINE_NOTES[p.engine]}

Rules:
- Return only the corrected SQL, with no markdown code fences and no explanation.
- One statement only.
- Do not change the user's intent; the smallest fix that compiles is best.

Schema:
${p.schemaDigest}`;
  const user = `The query was:\n${p.sql}\n\nThe error was:\n${p.errorMessage}`;
  return { system, user };
}

export interface CompletionInputs {
  engine: EngineId;
  schemaDigest: string;
  contextBefore: string;
}

export function buildCompletionPrompt(p: CompletionInputs): { system: string; user: string } {
  const system = `You complete the SQL the user is currently typing in their editor.
${ENGINE_NOTES[p.engine]}

Rules:
- Return only the next 1-3 lines that should follow the user's cursor.
- No code fences, no explanation, no greeting.
- Stop at a natural line break or semicolon.
- Use the schema below.

Schema:
${p.schemaDigest}`;
  const user = `Continue this SQL:\n\n${p.contextBefore}`;
  return { system, user };
}
