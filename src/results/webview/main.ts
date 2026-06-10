import type { EditMeta, HostMessage, WebviewMessage } from "../protocol";
import type { ResultSet } from "../../drivers/types";

interface VsCodeApi {
  postMessage(m: WebviewMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

let currentPage = 0;
let current: ResultSet | undefined;
let edit: EditMeta | undefined;

const $ = (id: string) => document.getElementById(id)!;

function render(msg: HostMessage): void {
  const content = $("content");
  if (msg.type === "loading") {
    content.innerHTML = `<em>Running…</em>`;
    return;
  }
  if (msg.type === "error") {
    content.innerHTML = `<div class="err">${escapeHtml(msg.message)}${
      msg.detail ? "\n\n" + escapeHtml(msg.detail) : ""
    }</div>`;
    return;
  }
  // type === "result"
  current = msg.data;
  edit = msg.edit;
  currentPage = msg.data.page;
  $("page").textContent = `Page ${msg.data.page + 1}`;

  const editableCols = editableColumnSet(msg.data, msg.edit);
  const head = msg.data.columns.map((c) => `<th>${escapeHtml(c.name)}</th>`).join("");
  const body = msg.data.rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          const editable = editableCols.has(ci);
          const attrs = editable
            ? ` class="editable" contenteditable="true" data-row="${ri}" data-col="${ci}"`
            : "";
          return `<td${attrs}>${escapeHtml(format(v))}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  content.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  $("hint").textContent = msg.edit
    ? "Editable — double-click a non-key cell, edit, then click away to apply."
    : "";
}

// Columns that may be edited: only when edit meta is present, the table has a PK,
// and the column itself is not part of the PK.
function editableColumnSet(data: ResultSet, meta?: EditMeta): Set<number> {
  const set = new Set<number>();
  if (!meta || meta.pkColumns.length === 0) return set;
  data.columns.forEach((c, i) => {
    if (!meta.pkColumns.includes(c.name)) set.add(i);
  });
  return set;
}

function onCellCommit(td: HTMLElement): void {
  if (!current || !edit) return;
  const ri = Number(td.dataset.row);
  const ci = Number(td.dataset.col);
  const original = format(current.rows[ri][ci]);
  const next = td.textContent ?? "";
  if (next === original) return;

  // Build the PK map for this row from the result columns.
  const pk: Record<string, unknown> = {};
  for (const pkCol of edit.pkColumns) {
    const idx = current.columns.findIndex((c) => c.name === pkCol);
    if (idx >= 0) pk[pkCol] = current.rows[ri][idx];
  }
  vscode.postMessage({
    type: "applyEdit",
    pk,
    column: current.columns[ci].name,
    value: next,
  });
}

function format(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

$("prev").addEventListener("click", () => {
  if (currentPage > 0) vscode.postMessage({ type: "requestPage", page: currentPage - 1 });
});
$("next").addEventListener("click", () =>
  vscode.postMessage({ type: "requestPage", page: currentPage + 1 }),
);
$("csv").addEventListener("click", () => vscode.postMessage({ type: "export", format: "csv" }));
$("json").addEventListener("click", () => vscode.postMessage({ type: "export", format: "json" }));

// Commit edits when an editable cell loses focus.
$("content").addEventListener("focusout", (e) => {
  const t = e.target as HTMLElement;
  if (t && t.classList.contains("editable")) onCellCommit(t);
});

window.addEventListener("message", (e: MessageEvent<HostMessage>) => render(e.data));
