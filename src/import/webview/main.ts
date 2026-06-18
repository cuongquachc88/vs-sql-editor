import type { HostMessage, ImportColumn, WebviewMessage } from "../protocol";
import type { InferredType } from "../sql-types";

interface VsCodeApi {
  postMessage(m: WebviewMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

const TYPES: InferredType[] = ["integer", "real", "boolean", "text"];

interface State {
  schemas: string[];
  filePath?: string;
  columns: ImportColumn[];
}
const state: State = { schemas: [], columns: [] };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

window.addEventListener("message", (e: MessageEvent<HostMessage>) => handle(e.data));

function handle(m: HostMessage): void {
  if (m.type === "ready") {
    state.schemas = m.schemas;
    $("title").textContent = `Import CSV → ${m.connectionName}`;
    return;
  }
  if (m.type === "preview") {
    state.filePath = m.filePath;
    state.columns = m.inferred.slice();
    $("filename").textContent = m.filename;
    $("rowcount").textContent = `${m.totalRows.toLocaleString()} rows`;
    ($("table-name") as HTMLInputElement).value = m.defaultTableName;
    renderSchemaSelect();
    renderColumnRows(m.headerRow);
    renderPreviewGrid(m.headerRow, m.sampleRows);
    $("drop").style.display = "none";
    $("preview").hidden = false;
    setStatus(null);
    showProgress(false);
    return;
  }
  if (m.type === "progress") {
    showProgress(true);
    setStatus({ kind: "ok", text: `Inserting… ${m.done.toLocaleString()} / ${m.total.toLocaleString()}` });
    $("progress-bar").style.width = `${(m.done / Math.max(1, m.total)) * 100}%`;
    return;
  }
  if (m.type === "done") {
    showProgress(true);
    $("progress-bar").style.width = "100%";
    setStatus({
      kind: "ok",
      text: `✓ Imported ${m.rowsInserted.toLocaleString()} rows into ${
        m.targetSchema ? m.targetSchema + "." : ""
      }${m.targetTable}.`,
    });
    return;
  }
  if (m.type === "error") {
    showProgress(false);
    setStatus({ kind: "err", text: m.message });
    return;
  }
}

function renderSchemaSelect(): void {
  const sel = $("schema-select") as HTMLSelectElement;
  if (state.schemas.length === 0) {
    $("schema-field").hidden = true;
    return;
  }
  $("schema-field").hidden = false;
  sel.innerHTML = state.schemas.map((s) => `<option value="${s}">${s}</option>`).join("");
  if (state.schemas.includes("public")) sel.value = "public";
}

function renderColumnRows(headers: string[]): void {
  const host = $("col-rows");
  host.innerHTML = "";
  headers.forEach((h, i) => {
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = state.columns[i]?.name ?? h;
    nameInput.addEventListener("input", () => (state.columns[i].name = nameInput.value));

    const typeSelect = document.createElement("select");
    typeSelect.innerHTML = TYPES.map(
      (t) => `<option value="${t}">${t}</option>`,
    ).join("");
    typeSelect.value = state.columns[i]?.type ?? "text";
    typeSelect.addEventListener("change", () => {
      state.columns[i].type = typeSelect.value as InferredType;
    });

    host.appendChild(nameInput);
    host.appendChild(typeSelect);
  });
}

function renderPreviewGrid(header: string[], rows: string[][]): void {
  const headHtml = header.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const bodyHtml = rows
    .map(
      (r) => `<tr>${header
        .map((_, i) => `<td>${escapeHtml(r[i] ?? "")}</td>`)
        .join("")}</tr>`,
    )
    .join("");
  $("preview-grid").innerHTML = `<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}

function showProgress(show: boolean): void {
  $("progress-wrap").className = show ? "show" : "";
}

function setStatus(s: { kind: "ok" | "err"; text: string } | null): void {
  const el = $("status");
  if (!s) {
    el.className = "";
    el.textContent = "";
    return;
  }
  el.className = s.kind;
  el.textContent = s.text;
}

// --- drop zone ---

$("drop").addEventListener("click", () => vscode.postMessage({ type: "pickFile" }));
$("change-file").addEventListener("click", () => {
  $("drop").style.display = "";
  $("preview").hidden = true;
  vscode.postMessage({ type: "pickFile" });
});

["dragover", "dragenter"].forEach((ev) =>
  $("drop").addEventListener(ev, (e) => {
    e.preventDefault();
    $("drop").classList.add("over");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  $("drop").addEventListener(ev, (e) => {
    e.preventDefault();
    $("drop").classList.remove("over");
  }),
);

$("cancel").addEventListener("click", () => vscode.postMessage({ type: "cancel" }));
$("import").addEventListener("click", () => {
  const filePath = state.filePath;
  if (!filePath) return;
  const tableName = ($("table-name") as HTMLInputElement).value.trim();
  if (!tableName) {
    setStatus({ kind: "err", text: "Target table name is required." });
    return;
  }
  const targetSchema =
    state.schemas.length > 0 ? ($("schema-select") as HTMLSelectElement).value : undefined;
  vscode.postMessage({
    type: "runImport",
    filePath,
    targetSchema,
    targetTable: tableName,
    columns: state.columns,
  });
});

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

vscode.postMessage({ type: "ready" });
