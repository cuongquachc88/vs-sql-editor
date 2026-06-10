import type { HostMessage, WebviewMessage } from "../protocol";

interface VsCodeApi {
  postMessage(m: WebviewMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

let currentPage = 0;

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
  currentPage = msg.data.page;
  $("page").textContent = `Page ${msg.data.page + 1}`;
  const head = msg.data.columns.map((c) => `<th>${escapeHtml(c.name)}</th>`).join("");
  const body = msg.data.rows
    .map((r) => `<tr>${r.map((v) => `<td>${escapeHtml(format(v))}</td>`).join("")}</tr>`)
    .join("");
  content.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
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

window.addEventListener("message", (e: MessageEvent<HostMessage>) => render(e.data));
