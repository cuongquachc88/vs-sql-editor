import type { EditMeta, HostMessage, WebviewMessage } from "../protocol";
import type { ResultSet } from "../../drivers/types";

interface VsCodeApi {
  postMessage(m: WebviewMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

interface SortState {
  col: number;
  dir: "asc" | "desc";
}

interface State {
  rs: ResultSet | undefined;
  edit: EditMeta | undefined;
  // Indices into rs.rows in current render order (post-sort).
  order: number[];
  sort: SortState | undefined;
  findTerm: string;
  matches: { row: number; col: number }[];
  matchIdx: number;
  current: { row: number; col: number } | undefined;
  executionMs: number | undefined;
  connectionLabel: string | undefined;
}

const state: State = {
  rs: undefined,
  edit: undefined,
  order: [],
  sort: undefined,
  findTerm: "",
  matches: [],
  matchIdx: 0,
  current: undefined,
  executionMs: undefined,
  connectionLabel: undefined,
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ------- entry / message handling -------

window.addEventListener("message", (e: MessageEvent<HostMessage>) => handle(e.data));

function handle(m: HostMessage): void {
  if (m.type === "loading") {
    $("content").innerHTML = `<div class="placeholder">Running…</div>`;
    setStatus({ rows: "—", time: "—", page: "—" });
    return;
  }
  if (m.type === "error") {
    $("content").innerHTML = `<div class="err">${escapeHtml(m.message)}${
      m.detail ? "\n\n" + escapeHtml(m.detail) : ""
    }</div>`;
    setStatus({ rows: "—", time: "—", page: "—" });
    return;
  }
  // result
  state.rs = m.data;
  state.edit = m.edit;
  state.order = m.data.rows.map((_, i) => i);
  state.sort = undefined;
  state.findTerm = "";
  state.matches = [];
  state.matchIdx = 0;
  state.current = undefined;
  state.executionMs = m.meta?.executionMs;
  state.connectionLabel = m.meta?.connectionLabel;
  ($("find") as HTMLInputElement).value = "";
  $("find-count").textContent = "";
  ($("page-input") as HTMLInputElement).value = String(m.data.page + 1);
  $("hint").className = m.edit ? "show" : "";
  $("hint").textContent = m.edit
    ? "Editable — double-click a non-key cell to edit, Enter to apply."
    : "";
  renderGrid();
  updateStatus();
}

// ------- grid render -------

function renderGrid(): void {
  if (!state.rs) return;
  const rs = state.rs;
  const editableCols = editableColumnSet(rs, state.edit);
  const categories = rs.columns.map((c) => typeCategory(c.type));

  if (rs.rows.length === 0) {
    $("content").innerHTML = `<div class="empty-state">
      <div class="glyph">✓</div>
      <div class="title">${rs.rowCount != null ? `${rs.rowCount} row${rs.rowCount === 1 ? "" : "s"} affected` : "Query ran — no rows returned"}</div>
      <div class="hint">${rs.rowCount != null ? "The statement modified the database." : "Your query executed but the result set is empty."}</div>
    </div>`;
    return;
  }

  const gutterCol = `<col style="width:56px"/>`;
  const cols = rs.columns
    .map((_, i) => `<col data-col="${i}" style="width:${columnWidth(i)}px"/>`)
    .join("");

  const head = rs.columns
    .map((c, i) => {
      const sortIndicator =
        state.sort?.col === i ? (state.sort.dir === "asc" ? "▲" : "▼") : "▾";
      const sortedCls = state.sort?.col === i ? " sorted" : "";
      return `<th class="col${sortedCls}" data-col="${i}">
        <span class="colname">${escapeHtml(c.name)}</span><span class="type-chip t-${categories[i]}">${escapeHtml(c.type)}</span>
        <span class="sort">${sortIndicator}</span>
        <span class="resizer" data-col="${i}" title="Drag to resize column"></span>
      </th>`;
    })
    .join("");

  const body = state.order
    .map((ri, displayIdx) => {
      const row = rs.rows[ri];
      const cells = row
        .map((v, ci) => {
          const editable = editableCols.has(ci);
          const cat = categories[ci];
          const cls: string[] = [];
          if (editable) cls.push("editable");
          if (cat === "number") cls.push("numeric");
          else if (cat === "datetime") cls.push("datetime");
          else if (cat === "uuid") cls.push("uuid");
          return `<td class="${cls.join(" ")}" data-row="${ri}" data-col="${ci}">${formatCell(v, cat)}</td>`;
        })
        .join("");
      const rowNum = displayIdx + 1 + rs.page * rs.pageSize;
      return `<tr data-row="${ri}"><td class="gutter">${rowNum}</td>${cells}</tr>`;
    })
    .join("");

  const gutterHead = `<th class="gutter"></th>`;
  $("content").innerHTML = `<div class="grid-wrap"><table class="grid">
    <colgroup>${gutterCol}${cols}</colgroup>
    <thead><tr>${gutterHead}${head}</tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
  wireResizers();
}

type TypeCategory =
  | "text"
  | "number"
  | "datetime"
  | "uuid"
  | "json"
  | "bool"
  | "binary"
  | "other";

function typeCategory(t: string): TypeCategory {
  const s = t.toLowerCase();
  if (/uuid/.test(s)) return "uuid";
  if (/json|jsonb/.test(s)) return "json";
  if (/bool|bit\b/.test(s)) return "bool";
  if (/^(timestamp|date|time|interval)/.test(s) || /timestamptz|datetz/.test(s))
    return "datetime";
  if (/int|float|double|decimal|numeric|real|number|bigint|smallint|tinyint/.test(s))
    return "number";
  if (/char|text|varchar|string|clob/.test(s)) return "text";
  if (/bytea|blob|binary/.test(s)) return "binary";
  // Postgres returns oid digit strings as type when rowMode="array"; map known ones.
  if (/^\d+$/.test(s)) {
    const oid = Number(s);
    if ([20, 21, 23, 700, 701, 1700].includes(oid)) return "number";
    if ([1082, 1083, 1114, 1184].includes(oid)) return "datetime";
    if ([16].includes(oid)) return "bool";
    if ([2950].includes(oid)) return "uuid";
    if ([114, 3802].includes(oid)) return "json";
    if ([25, 1043, 1042].includes(oid)) return "text";
  }
  return "other";
}

function editableColumnSet(data: ResultSet, meta?: EditMeta): Set<number> {
  const set = new Set<number>();
  if (!meta || meta.pkColumns.length === 0) return set;
  data.columns.forEach((c, i) => {
    if (!meta.pkColumns.includes(c.name)) set.add(i);
  });
  return set;
}

function formatCell(v: unknown, cat?: TypeCategory): string {
  if (v === null || v === undefined) return `<span class="null">NULL</span>`;
  if (typeof v === "boolean")
    return `<span class="bool t-${v ? "true" : "false"}">${v ? "true" : "false"}</span>`;
  if (cat === "bool" && (v === 0 || v === 1 || v === "0" || v === "1")) {
    const b = v === 1 || v === "1";
    return `<span class="bool t-${b ? "true" : "false"}">${b ? "true" : "false"}</span>`;
  }
  if (cat === "json" || typeof v === "object") {
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return `<span class="json">${escapeHtml(s.length > 200 ? s.slice(0, 200) + "…" : s)}</span>`;
  }
  return escapeHtml(String(v));
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

// ------- column widths (persisted per session, indexed by column) -------

const widths = new Map<number, number>();
const DEFAULT_WIDTH = 140;
function columnWidth(i: number): number {
  return widths.get(i) ?? DEFAULT_WIDTH;
}

// ------- column resize -------

let resize:
  | { col: number; startX: number; startWidth: number; el: HTMLElement }
  | undefined;

// Bind a mousedown listener directly to each resizer element after every
// renderGrid, in addition to the document-level fallback. Direct listeners
// ensure the click on the resizer span is never missed by event bubbling.
function wireResizers(): void {
  document
    .querySelectorAll<HTMLElement>("table.grid th .resizer")
    .forEach((el) => {
      el.addEventListener("mousedown", (e) => startResize(e, el), {
        passive: false,
      });
    });
}

function startResize(e: MouseEvent, el: HTMLElement): void {
  const col = Number(el.dataset.col);
  if (Number.isNaN(col)) return;
  resize = { col, startX: e.clientX, startWidth: columnWidth(col), el };
  el.classList.add("dragging");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  e.preventDefault();
  e.stopPropagation();
}

// Fallback (defensive): document-level listener catches the mousedown even
// if direct wire-up missed for some reason (e.g. content re-rendered).
document.addEventListener(
  "mousedown",
  (e) => {
    const t = e.target as HTMLElement;
    if (!resize && t && t.classList && t.classList.contains("resizer")) {
      startResize(e, t);
    }
  },
  true, // capture phase so we run before sort/click handlers
);
document.addEventListener("mousemove", (e) => {
  if (!resize) return;
  const next = Math.max(60, resize.startWidth + (e.clientX - resize.startX));
  widths.set(resize.col, next);
  const col = document.querySelector<HTMLElement>(`col[data-col="${resize.col}"]`);
  if (col) col.style.width = `${next}px`;
});
document.addEventListener("mouseup", () => {
  if (resize) {
    resize.el.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    resize = undefined;
  }
});

// ------- sort -------

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const th = t.closest("th.col") as HTMLElement | null;
  if (!th) return;
  if ((e.target as HTMLElement).classList.contains("resizer")) return;
  const col = Number(th.dataset.col);
  cycleSort(col);
});

function cycleSort(col: number): void {
  if (!state.rs) return;
  if (state.sort?.col !== col) state.sort = { col, dir: "asc" };
  else if (state.sort.dir === "asc") state.sort.dir = "desc";
  else state.sort = undefined;
  applySort();
  renderGrid();
  applyFindHighlights();
}

function applySort(): void {
  if (!state.rs) return;
  if (!state.sort) {
    state.order = state.rs.rows.map((_, i) => i);
    return;
  }
  const { col, dir } = state.sort;
  const factor = dir === "asc" ? 1 : -1;
  state.order = [...state.rs.rows.keys()].sort((a, b) => {
    const va = state.rs!.rows[a][col];
    const vb = state.rs!.rows[b][col];
    return compareValues(va, vb) * factor;
  });
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

// ------- find -------

const findInput = $("find") as HTMLInputElement;
findInput.addEventListener("input", () => {
  state.findTerm = findInput.value.trim();
  recomputeMatches();
  applyFindHighlights();
});
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    jumpToMatch(e.shiftKey ? -1 : 1);
  }
  if (e.key === "Escape") {
    findInput.value = "";
    state.findTerm = "";
    recomputeMatches();
    applyFindHighlights();
  }
});

function recomputeMatches(): void {
  state.matches = [];
  if (!state.rs || !state.findTerm) return;
  const needle = state.findTerm.toLowerCase();
  state.rs.rows.forEach((row, ri) => {
    row.forEach((v, ci) => {
      if (v == null) return;
      const str = (typeof v === "object" ? JSON.stringify(v) : String(v)).toLowerCase();
      if (str.includes(needle)) state.matches.push({ row: ri, col: ci });
    });
  });
  state.matchIdx = 0;
}

function applyFindHighlights(): void {
  document.querySelectorAll<HTMLElement>("table.grid td.match").forEach((el) => {
    el.classList.remove("match");
  });
  state.matches.forEach((m) => {
    const td = cellEl(m.row, m.col);
    if (td) td.classList.add("match");
  });
  $("find-count").textContent = state.findTerm
    ? state.matches.length === 0
      ? "no matches"
      : `${state.matchIdx + 1} of ${state.matches.length}`
    : "";
}

function jumpToMatch(delta: number): void {
  if (state.matches.length === 0) return;
  state.matchIdx =
    (state.matchIdx + delta + state.matches.length) % state.matches.length;
  const m = state.matches[state.matchIdx];
  const td = cellEl(m.row, m.col);
  if (td) {
    td.scrollIntoView({ block: "center", inline: "center" });
    setCurrent(m.row, m.col);
  }
  $("find-count").textContent = `${state.matchIdx + 1} of ${state.matches.length}`;
}

function cellEl(row: number, col: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `td[data-row="${row}"][data-col="${col}"]`,
  );
}

// ------- pagination -------

$("prev").addEventListener("click", () => {
  if (!state.rs || state.rs.page <= 0) return;
  vscode.postMessage({ type: "requestPage", page: state.rs.page - 1 });
});
$("next").addEventListener("click", () => {
  if (!state.rs) return;
  // Block forward navigation when the current page is the last one.
  if (state.rs.hasMore === false) return;
  vscode.postMessage({ type: "requestPage", page: state.rs.page + 1 });
});
($("page-input") as HTMLInputElement).addEventListener("change", (e) => {
  const n = Math.max(1, Number((e.target as HTMLInputElement).value || "1"));
  // Don't allow jumping past the known last page.
  if (state.rs && state.rs.hasMore === false && n > state.rs.page + 1) {
    (e.target as HTMLInputElement).value = String(state.rs.page + 1);
    return;
  }
  vscode.postMessage({ type: "requestPage", page: n - 1 });
});

// ------- export -------

$("csv").addEventListener("click", () => vscode.postMessage({ type: "export", format: "csv" }));
$("json").addEventListener("click", () => vscode.postMessage({ type: "export", format: "json" }));

// ------- keyboard nav -------

document.addEventListener("keydown", (e) => {
  if (isTypingTarget(e.target)) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    findInput.focus();
    findInput.select();
    return;
  }
  if (!state.current || !state.rs) return;
  let { row, col } = state.current;
  const cols = state.rs.columns.length;
  const rows = state.order.length;
  if (e.key === "ArrowDown") row = Math.min(rows - 1, displayIdxFor(row) + 1);
  else if (e.key === "ArrowUp") row = Math.max(0, displayIdxFor(row) - 1);
  else if (e.key === "ArrowRight") col = Math.min(cols - 1, col + 1);
  else if (e.key === "ArrowLeft") col = Math.max(0, col - 1);
  else if (e.key === "PageDown") {
    e.preventDefault();
    vscode.postMessage({ type: "requestPage", page: (state.rs.page ?? 0) + 1 });
    return;
  } else if (e.key === "PageUp") {
    e.preventDefault();
    if ((state.rs.page ?? 0) > 0)
      vscode.postMessage({ type: "requestPage", page: (state.rs.page ?? 0) - 1 });
    return;
  } else if (e.key === "Enter") {
    e.preventDefault();
    beginEdit(state.current.row, state.current.col);
    return;
  } else {
    return;
  }
  e.preventDefault();
  const r = state.order[row];
  setCurrent(r, col);
});

function displayIdxFor(row: number): number {
  const idx = state.order.indexOf(row);
  return idx >= 0 ? idx : 0;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || t.isContentEditable;
}

// ------- cell selection -------

document.addEventListener("click", (e) => {
  const td = (e.target as HTMLElement).closest("td[data-row][data-col]") as HTMLElement | null;
  if (!td || td.classList.contains("gutter")) return;
  setCurrent(Number(td.dataset.row), Number(td.dataset.col));
});

function setCurrent(row: number, col: number): void {
  state.current = { row, col };
  document.querySelectorAll<HTMLElement>("tr.current").forEach((el) => el.classList.remove("current"));
  const tr = document.querySelector<HTMLElement>(`tr[data-row="${row}"]`);
  if (tr) tr.classList.add("current");
}

// ------- inline edit (double-click) -------

document.addEventListener("dblclick", (e) => {
  const td = (e.target as HTMLElement).closest("td.editable") as HTMLElement | null;
  if (!td) return;
  beginEdit(Number(td.dataset.row), Number(td.dataset.col));
});

function beginEdit(row: number, col: number): void {
  if (!state.rs || !state.edit) return;
  const td = cellEl(row, col);
  if (!td || !td.classList.contains("editable")) return;
  const original = formatPlain(state.rs.rows[row][col]);
  const input = document.createElement("input");
  input.type = "text";
  input.value = original;
  input.className = "cell-input";
  td.innerHTML = "";
  td.appendChild(input);
  input.focus();
  input.select();

  const commit = () => {
    const next = input.value;
    if (next === original) {
      td.innerHTML = formatCell(state.rs!.rows[row][col]);
      return;
    }
    const pk: Record<string, unknown> = {};
    for (const pkCol of state.edit!.pkColumns) {
      const idx = state.rs!.columns.findIndex((c) => c.name === pkCol);
      if (idx >= 0) pk[pkCol] = state.rs!.rows[row][idx];
    }
    vscode.postMessage({
      type: "applyEdit",
      pk,
      column: state.rs!.columns[col].name,
      value: next,
    });
  };
  const cancel = () => {
    td.innerHTML = formatCell(state.rs!.rows[row][col]);
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      input.blur();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      input.removeEventListener("blur", commit);
      cancel();
    }
  });
}

function formatPlain(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ------- context menu -------

const menu = $("context-menu");
document.addEventListener("contextmenu", (e) => {
  const td = (e.target as HTMLElement).closest("td[data-row][data-col]") as HTMLElement | null;
  if (!td || td.classList.contains("gutter")) return hideMenu();
  e.preventDefault();
  const row = Number(td.dataset.row);
  const col = Number(td.dataset.col);
  setCurrent(row, col);
  showMenu(e.clientX, e.clientY, row, col);
});
document.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest("#context-menu")) hideMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideMenu();
});

function showMenu(x: number, y: number, row: number, col: number): void {
  if (!state.rs) return;
  const cellVal = formatPlain(state.rs.rows[row][col]);
  const rowTsv = state.rs.rows[row].map(formatPlain).join("\t");
  const colName = state.rs.columns[col].name;
  menu.innerHTML = `
    <div class="item" data-action="copy-cell">Copy cell</div>
    <div class="item" data-action="copy-row">Copy row as TSV</div>
    <div class="item" data-action="copy-col">Copy column name</div>
  `;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.add("show");
  menu.querySelectorAll<HTMLElement>(".item").forEach((it) => {
    it.addEventListener("click", () => {
      const a = it.dataset.action;
      if (a === "copy-cell") copy(cellVal);
      else if (a === "copy-row") copy(rowTsv);
      else if (a === "copy-col") copy(colName);
      hideMenu();
    });
  });
}
function hideMenu(): void {
  menu.classList.remove("show");
}
function copy(text: string): void {
  void navigator.clipboard.writeText(text);
}

// ------- status bar -------

interface StatusUpdate {
  rows?: string;
  time?: string;
  page?: string;
  conn?: string;
}
function setStatus(s: StatusUpdate): void {
  if (s.rows !== undefined) $("status-rows").textContent = s.rows;
  if (s.time !== undefined) $("status-time").textContent = s.time;
  if (s.page !== undefined) $("status-page").textContent = s.page;
  if (s.conn !== undefined) $("status-conn").textContent = s.conn;
}

function updateStatus(): void {
  if (!state.rs) return;
  const rs = state.rs;
  const start = rs.page * rs.pageSize + 1;
  const end = rs.page * rs.pageSize + rs.rows.length;
  const rowsText =
    rs.rowCount != null
      ? `${rs.rowCount.toLocaleString()} row${rs.rowCount === 1 ? "" : "s"} affected`
      : `Rows ${start.toLocaleString()}–${end.toLocaleString()}`;
  const timeText =
    state.executionMs != null
      ? state.executionMs < 1000
        ? `${state.executionMs} ms`
        : `${(state.executionMs / 1000).toFixed(2)} s`
      : "—";
  const pageText = `Page ${rs.page + 1}${rs.hasMore === false ? " (last)" : ""}`;
  setStatus({
    rows: rowsText,
    time: timeText,
    page: pageText,
    conn: state.connectionLabel ?? "—",
  });
  $("page-total").textContent = rs.hasMore === false ? `/ ${rs.page + 1}` : "/ …";
  ($("page-input") as HTMLInputElement).value = String(rs.page + 1);
  // Enable/disable nav buttons based on real page bounds.
  ($("prev") as HTMLButtonElement).disabled = rs.page <= 0;
  ($("next") as HTMLButtonElement).disabled = rs.hasMore === false;
}
