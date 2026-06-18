// Notebook output renderer for application/x-vssqleditor-result+json (and the
// matching error MIME). Loaded by VS Code in a sandboxed iframe per cell output.
//
// Inputs / outputs:
//   - VS Code gives us `RendererContext<void>` and an OutputItem per render call.
//   - We post messages to the controller via `context.postMessage`.

import type {
  NotebookErrorPayload,
  NotebookResultPayload,
  RendererMessage,
} from "../protocol";

// Minimal subset of the VS Code Notebook Renderer API typings.
interface OutputItem {
  readonly mime: string;
  readonly id: string;
  json(): unknown;
}
interface RendererContext {
  postMessage(message: RendererMessage): void;
  setState?(s: unknown): void;
  getState?(): unknown;
}

export const activate = (context: RendererContext) => ({
  renderOutputItem(item: OutputItem, element: HTMLElement): void {
    element.innerHTML = "";
    if (item.mime.endsWith("error+json")) {
      const e = item.json() as NotebookErrorPayload;
      element.appendChild(renderError(e));
      return;
    }
    const p = item.json() as NotebookResultPayload;
    element.appendChild(renderResult(p, context));
  },
});

function renderError(e: NotebookErrorPayload): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "padding:8px 10px; border-left:3px solid var(--vscode-errorForeground); color:var(--vscode-errorForeground); white-space:pre-wrap; font-family:var(--vscode-editor-font-family); font-size:12px;";
  wrap.textContent = e.message + (e.detail ? "\n\n" + e.detail : "");
  return wrap;
}

function renderResult(p: NotebookResultPayload, ctx: RendererContext): HTMLElement {
  const root = document.createElement("div");
  root.style.cssText = "font-family: var(--vscode-font-family); font-size:12px;";

  // Toolbar
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex; align-items:center; gap:8px; padding:6px 4px;";
  bar.innerHTML = `
    <span style="color:var(--vscode-descriptionForeground); font-size:11px;">
      <span style="display:inline-block;width:6px;height:6px;border-radius:999px;background:var(--vscode-testing-iconPassed, #2ea043); vertical-align:middle; margin-right:6px;"></span>
      ${escapeHtml(p.connectionLabel ?? "")}
      ${p.rowCount != null
        ? `· ${p.rowCount.toLocaleString()} row${p.rowCount === 1 ? "" : "s"} affected`
        : `· ${p.rows.length.toLocaleString()} row${p.rows.length === 1 ? "" : "s"}` +
          (p.hasMore ? " (first page)" : "")}
      · ${formatMs(p.executionMs)}
    </span>
    <span style="flex:1"></span>
  `;
  const csvBtn = makeButton("Export CSV");
  const jsonBtn = makeButton("Export JSON");
  csvBtn.onclick = () => ctx.postMessage({ type: "exportCsv", resultId: p.resultId });
  jsonBtn.onclick = () => ctx.postMessage({ type: "exportJson", resultId: p.resultId });
  bar.appendChild(csvBtn);
  bar.appendChild(jsonBtn);

  root.appendChild(bar);

  // Empty-rowset hint (DDL / DML without RETURNING)
  if (p.rows.length === 0) {
    const hint = document.createElement("div");
    hint.style.cssText = "padding:6px 4px; color:var(--vscode-descriptionForeground); font-style:italic;";
    hint.textContent = p.rowCount != null ? `${p.rowCount} row(s) affected.` : "(no rows)";
    root.appendChild(hint);
    return root;
  }

  // Grid
  const wrap = document.createElement("div");
  wrap.style.cssText = "max-height:420px; overflow:auto; border:1px solid var(--vscode-panel-border, rgba(128,128,128,0.3)); border-radius:4px;";
  const table = document.createElement("table");
  table.style.cssText = "border-collapse:separate; border-spacing:0; width:100%; font-size:12px; table-layout:auto;";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  // Row-number gutter
  headRow.appendChild(th("#", true));
  for (const c of p.columns) {
    headRow.appendChild(th(`${c.name} <span style="color:var(--vscode-descriptionForeground); font-size:10px; font-weight:500; margin-left:6px;">${escapeHtml(c.type)}</span>`));
  }
  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement("tbody");
  const numericCols = numericColumnSet(p.columns);
  p.rows.forEach((row, ri) => {
    const tr = document.createElement("tr");
    tr.appendChild(td(String(ri + 1 + p.page * p.pageSize), { gutter: true }));
    row.forEach((v, ci) => tr.appendChild(td(format(v), { numeric: numericCols.has(ci) })));
    body.appendChild(tr);
  });
  table.appendChild(body);
  wrap.appendChild(table);
  root.appendChild(wrap);

  return root;
}

function th(html: string, gutter = false): HTMLTableCellElement {
  const el = document.createElement("th");
  el.innerHTML = html;
  el.style.cssText = `position:sticky; top:0; z-index:1; padding:4px 8px; text-align:left; background:var(--vscode-editor-background); border-bottom:1px solid var(--vscode-panel-border, rgba(128,128,128,0.4)); ${gutter ? "color:var(--vscode-descriptionForeground); width:48px;" : "font-weight:600;"}`;
  return el;
}

function td(text: string, opts: { gutter?: boolean; numeric?: boolean } = {}): HTMLTableCellElement {
  const el = document.createElement("td");
  el.innerHTML = text;
  el.style.cssText = `padding:3px 8px; border-bottom:1px solid var(--vscode-panel-border, rgba(128,128,128,0.2)); vertical-align:top; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:320px; ${opts.gutter ? "color:var(--vscode-descriptionForeground); text-align:right; font-variant-numeric:tabular-nums; width:48px;" : opts.numeric ? "text-align:right; font-variant-numeric:tabular-nums;" : ""}`;
  return el;
}

function makeButton(label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.style.cssText = "font:inherit; padding:2px 10px; border-radius:4px; border:1px solid transparent; background:color-mix(in srgb, var(--vscode-editor-background), var(--vscode-foreground) 6%); color:inherit; cursor:pointer; font-size:11px;";
  b.onmouseenter = () => (b.style.background = "color-mix(in srgb, var(--vscode-editor-background), var(--vscode-foreground) 12%)");
  b.onmouseleave = () => (b.style.background = "color-mix(in srgb, var(--vscode-editor-background), var(--vscode-foreground) 6%)");
  return b;
}

function numericColumnSet(cols: { type: string }[]): Set<number> {
  const RE = /int|float|double|decimal|numeric|real|number/i;
  const set = new Set<number>();
  cols.forEach((c, i) => {
    if (RE.test(c.type)) set.add(i);
  });
  return set;
}

function format(v: unknown): string {
  if (v === null || v === undefined)
    return `<span style="color:var(--vscode-descriptionForeground); font-style:italic;">∅</span>`;
  if (typeof v === "object") return escapeHtml(JSON.stringify(v));
  return escapeHtml(String(v));
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
