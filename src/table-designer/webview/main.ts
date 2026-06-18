import type { EngineId } from "../../drivers/types";
import type {
  HostMessage,
  WebviewMessage,
} from "../protocol";
import type {
  CheckConstraint,
  DesignerMode,
  ForeignKey,
  IndexDef,
  TableColumn,
  TableSchema,
} from "../model";

interface VsCodeApi {
  postMessage(m: WebviewMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let mode: DesignerMode = "create";
let engine: EngineId = "postgres";
let typeCatalog: string[] = [];
let current: TableSchema = {
  schema: "",
  name: "",
  columns: [],
  foreignKeys: [],
  indexes: [],
  checks: [],
};

// =============================================================================
// Init
// =============================================================================

window.addEventListener("message", (e: MessageEvent<HostMessage>) => handle(e.data));
vscode.postMessage({ type: "ready" });

function handle(m: HostMessage): void {
  if (m.type === "init") {
    mode = m.mode;
    engine = m.engine;
    typeCatalog = m.typeCatalog;
    current = JSON.parse(JSON.stringify(m.original)) as TableSchema;
    $("title").textContent =
      mode === "create"
        ? `Create Table — ${m.connectionName} (${m.engine})`
        : `Edit Table ${m.original.schema}.${m.original.name}`;
    $("subtitle").textContent =
      mode === "create"
        ? "Define columns and constraints, then Save to run the CREATE statement."
        : "Edit fields below. Save computes ALTER statements (diff from current schema).";
    // Populate schema dropdown
    const sel = $("t-schema") as HTMLSelectElement;
    sel.innerHTML = m.schemas
      .map((s) => `<option value="${s}">${escapeHtml(s)}</option>`)
      .join("");
    if (!m.schemas.includes(current.schema)) {
      const opt = document.createElement("option");
      opt.value = current.schema;
      opt.textContent = current.schema || "(no schema)";
      sel.appendChild(opt);
    }
    sel.value = current.schema;
    sel.disabled = mode === "edit";
    ($("t-name") as HTMLInputElement).value = current.name;
    ($("t-name") as HTMLInputElement).readOnly = false;
    render();
    refreshPreview();
    return;
  }
  if (m.type === "previewSql") {
    $("preview").textContent = m.sql;
    return;
  }
  if (m.type === "saveResult") {
    if (!m.ok) setStatus(m.error ?? "Save failed.");
    return;
  }
}

// =============================================================================
// Render
// =============================================================================

function render(): void {
  renderColumns();
  renderFks();
  renderIndexes();
  renderChecks();
}

function renderColumns(): void {
  const body = $("cols-body");
  body.innerHTML = current.columns
    .map(
      (c, i) => `
    <tr data-idx="${i}">
      <td><input type="text" class="col-name" value="${escapeAttr(c.name)}" /></td>
      <td><input list="type-dl" type="text" class="col-type" value="${escapeAttr(c.type)}" /></td>
      <td style="text-align:center"><input type="checkbox" class="col-null" ${c.nullable ? "checked" : ""} /></td>
      <td style="text-align:center"><input type="checkbox" class="col-pk" ${c.isPrimary ? "checked" : ""} /></td>
      <td><input type="text" class="col-def" value="${escapeAttr(c.default ?? "")}" placeholder="e.g. now()" /></td>
      <td><input type="text" class="col-cmt" value="${escapeAttr(c.comment ?? "")}" /></td>
      <td style="text-align:center"><button class="ghost danger" data-action="remove-col" title="Remove">✕</button></td>
    </tr>`,
    )
    .join("") + typeDatalist();
  wireColumnRows();
}

function typeDatalist(): string {
  return `<datalist id="type-dl">${typeCatalog
    .map((t) => `<option value="${escapeAttr(t)}"></option>`)
    .join("")}</datalist>`;
}

function wireColumnRows(): void {
  const body = $("cols-body");
  body.querySelectorAll<HTMLTableRowElement>("tr[data-idx]").forEach((tr) => {
    const i = Number(tr.dataset.idx);
    const col = current.columns[i];
    (tr.querySelector(".col-name") as HTMLInputElement).addEventListener("input", (e) => {
      col.name = (e.target as HTMLInputElement).value;
      refreshPreview();
    });
    (tr.querySelector(".col-type") as HTMLInputElement).addEventListener("input", (e) => {
      col.type = (e.target as HTMLInputElement).value;
      refreshPreview();
    });
    (tr.querySelector(".col-null") as HTMLInputElement).addEventListener("change", (e) => {
      col.nullable = (e.target as HTMLInputElement).checked;
      refreshPreview();
    });
    (tr.querySelector(".col-pk") as HTMLInputElement).addEventListener("change", (e) => {
      col.isPrimary = (e.target as HTMLInputElement).checked;
      if (col.isPrimary) col.nullable = false;
      renderColumns();
      refreshPreview();
    });
    (tr.querySelector(".col-def") as HTMLInputElement).addEventListener("input", (e) => {
      col.default = (e.target as HTMLInputElement).value || undefined;
      refreshPreview();
    });
    (tr.querySelector(".col-cmt") as HTMLInputElement).addEventListener("input", (e) => {
      col.comment = (e.target as HTMLInputElement).value || undefined;
      refreshPreview();
    });
    (tr.querySelector("[data-action='remove-col']") as HTMLButtonElement).addEventListener(
      "click",
      () => {
        current.columns.splice(i, 1);
        renderColumns();
        refreshPreview();
      },
    );
  });
}

$("cols-add").addEventListener("click", () => {
  current.columns.push({
    name: `col_${current.columns.length + 1}`,
    type: typeCatalog[0] ?? "text",
    nullable: true,
    isPrimary: false,
  });
  renderColumns();
  refreshPreview();
});

// --- FKs ---

function renderFks(): void {
  const host = $("fks");
  host.innerHTML = current.foreignKeys
    .map(
      (fk, i) => `
    <div class="kv-card" data-idx="${i}">
      <div class="row">
        <strong>FK ${i + 1}</strong>
        <button class="ghost danger" data-action="remove-fk">Remove</button>
      </div>
      <div class="kv-card-grid" style="margin-top:6px;">
        <div class="field"><label>Local columns (comma)</label>
          <input type="text" class="fk-cols" value="${escapeAttr(fk.columns.join(","))}" /></div>
        <div class="field"><label>Ref table</label>
          <input type="text" class="fk-ref" value="${escapeAttr((fk.refSchema ? fk.refSchema + "." : "") + fk.refTable)}" placeholder="schema.table" /></div>
        <div class="field"><label>Ref columns (comma)</label>
          <input type="text" class="fk-refcols" value="${escapeAttr(fk.refColumns.join(","))}" /></div>
        <div class="field"><label>ON DELETE</label>
          <select class="fk-del">${refActionOptions(fk.onDelete)}</select></div>
        <div class="field"><label>ON UPDATE</label>
          <select class="fk-upd">${refActionOptions(fk.onUpdate)}</select></div>
      </div>
    </div>`,
    )
    .join("");
  host.querySelectorAll<HTMLElement>(".kv-card[data-idx]").forEach((card) => {
    const i = Number(card.dataset.idx);
    const fk = current.foreignKeys[i];
    (card.querySelector(".fk-cols") as HTMLInputElement).addEventListener("input", (e) => {
      fk.columns = splitCsv((e.target as HTMLInputElement).value);
      refreshPreview();
    });
    (card.querySelector(".fk-ref") as HTMLInputElement).addEventListener("input", (e) => {
      const v = (e.target as HTMLInputElement).value;
      const dot = v.indexOf(".");
      if (dot >= 0) {
        fk.refSchema = v.slice(0, dot);
        fk.refTable = v.slice(dot + 1);
      } else {
        fk.refSchema = undefined;
        fk.refTable = v;
      }
      refreshPreview();
    });
    (card.querySelector(".fk-refcols") as HTMLInputElement).addEventListener("input", (e) => {
      fk.refColumns = splitCsv((e.target as HTMLInputElement).value);
      refreshPreview();
    });
    (card.querySelector(".fk-del") as HTMLSelectElement).addEventListener("change", (e) => {
      fk.onDelete = (e.target as HTMLSelectElement).value as ForeignKey["onDelete"];
      refreshPreview();
    });
    (card.querySelector(".fk-upd") as HTMLSelectElement).addEventListener("change", (e) => {
      fk.onUpdate = (e.target as HTMLSelectElement).value as ForeignKey["onUpdate"];
      refreshPreview();
    });
    (card.querySelector("[data-action='remove-fk']") as HTMLButtonElement).addEventListener(
      "click",
      () => {
        current.foreignKeys.splice(i, 1);
        renderFks();
        refreshPreview();
      },
    );
  });
}

function refActionOptions(cur: ForeignKey["onDelete"] | ForeignKey["onUpdate"]): string {
  const opts = ["", "NO ACTION", "CASCADE", "SET NULL", "RESTRICT", "SET DEFAULT"];
  return opts
    .map(
      (o) =>
        `<option value="${o}" ${cur === o ? "selected" : ""}>${o || "(none)"}</option>`,
    )
    .join("");
}

$("fk-add").addEventListener("click", () => {
  current.foreignKeys.push({ columns: [], refTable: "", refColumns: [] });
  renderFks();
  refreshPreview();
});

// --- Indexes ---

function renderIndexes(): void {
  const host = $("idxs");
  host.innerHTML = current.indexes
    .map(
      (idx, i) => `
    <div class="kv-card" data-idx="${i}">
      <div class="row">
        <strong>Index ${i + 1}</strong>
        <button class="ghost danger" data-action="remove-idx">Remove</button>
      </div>
      <div class="kv-card-grid" style="margin-top:6px;">
        <div class="field"><label>Name (optional)</label>
          <input type="text" class="idx-name" value="${escapeAttr(idx.name ?? "")}" /></div>
        <div class="field"><label>Columns (comma)</label>
          <input type="text" class="idx-cols" value="${escapeAttr(idx.columns.join(","))}" /></div>
        <div class="field">
          <label><input type="checkbox" class="idx-uniq" ${idx.unique ? "checked" : ""} /> Unique</label>
        </div>
      </div>
    </div>`,
    )
    .join("");
  host.querySelectorAll<HTMLElement>(".kv-card[data-idx]").forEach((card) => {
    const i = Number(card.dataset.idx);
    const idx = current.indexes[i];
    (card.querySelector(".idx-name") as HTMLInputElement).addEventListener("input", (e) => {
      idx.name = (e.target as HTMLInputElement).value || undefined;
      refreshPreview();
    });
    (card.querySelector(".idx-cols") as HTMLInputElement).addEventListener("input", (e) => {
      idx.columns = splitCsv((e.target as HTMLInputElement).value);
      refreshPreview();
    });
    (card.querySelector(".idx-uniq") as HTMLInputElement).addEventListener("change", (e) => {
      idx.unique = (e.target as HTMLInputElement).checked;
      refreshPreview();
    });
    (card.querySelector("[data-action='remove-idx']") as HTMLButtonElement).addEventListener(
      "click",
      () => {
        current.indexes.splice(i, 1);
        renderIndexes();
        refreshPreview();
      },
    );
  });
}

$("idx-add").addEventListener("click", () => {
  current.indexes.push({ columns: [], unique: false });
  renderIndexes();
  refreshPreview();
});

// --- Check constraints ---

function renderChecks(): void {
  const host = $("checks");
  host.innerHTML = current.checks
    .map(
      (ck, i) => `
    <div class="kv-card" data-idx="${i}">
      <div class="row">
        <strong>Check ${i + 1}</strong>
        <button class="ghost danger" data-action="remove-chk">Remove</button>
      </div>
      <div class="kv-card-grid" style="margin-top:6px;">
        <div class="field"><label>Name (optional)</label>
          <input type="text" class="ck-name" value="${escapeAttr(ck.name ?? "")}" /></div>
        <div class="field" style="grid-column: 1 / -1;"><label>Expression</label>
          <textarea class="ck-expr" rows="2">${escapeHtml(ck.expression)}</textarea></div>
      </div>
    </div>`,
    )
    .join("");
  host.querySelectorAll<HTMLElement>(".kv-card[data-idx]").forEach((card) => {
    const i = Number(card.dataset.idx);
    const ck = current.checks[i];
    (card.querySelector(".ck-name") as HTMLInputElement).addEventListener("input", (e) => {
      ck.name = (e.target as HTMLInputElement).value || undefined;
      refreshPreview();
    });
    (card.querySelector(".ck-expr") as HTMLTextAreaElement).addEventListener("input", (e) => {
      ck.expression = (e.target as HTMLTextAreaElement).value;
      refreshPreview();
    });
    (card.querySelector("[data-action='remove-chk']") as HTMLButtonElement).addEventListener(
      "click",
      () => {
        current.checks.splice(i, 1);
        renderChecks();
        refreshPreview();
      },
    );
  });
}

$("chk-add").addEventListener("click", () => {
  current.checks.push({ expression: "" });
  renderChecks();
  refreshPreview();
});

// --- Tabs ---

document.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab!;
    document.querySelectorAll<HTMLElement>(".tab-btn").forEach((b) =>
      b.classList.toggle("active", b === btn),
    );
    document.querySelectorAll<HTMLElement>(".section").forEach((s) =>
      s.classList.toggle("active", s.dataset.section === tab),
    );
    if (tab === "preview") refreshPreview();
  });
});

// --- Header inputs ---

$("t-schema").addEventListener("change", (e) => {
  current.schema = (e.target as HTMLSelectElement).value;
  refreshPreview();
});
$("t-name").addEventListener("input", (e) => {
  current.name = (e.target as HTMLInputElement).value;
  refreshPreview();
});

// --- Actions ---

$("refresh-preview").addEventListener("click", refreshPreview);
$("cancel-btn").addEventListener("click", () => vscode.postMessage({ type: "cancel" }));
$("save-btn").addEventListener("click", () => {
  if (!current.name.trim()) {
    setStatus("Table name is required.");
    return;
  }
  if (current.columns.length === 0) {
    setStatus("At least one column is required.");
    return;
  }
  setStatus(null);
  vscode.postMessage({ type: "save", current });
});

function refreshPreview(): void {
  vscode.postMessage({ type: "requestPreview", current });
}

function setStatus(msg: string | null): void {
  const el = $("status");
  if (!msg) {
    el.className = "";
    el.textContent = "";
    return;
  }
  el.className = "err";
  el.textContent = msg;
}

function splitCsv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
