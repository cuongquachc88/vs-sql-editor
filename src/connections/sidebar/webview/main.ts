import type { SchemaModel } from "../../../drivers/types";
import { getEngineSvg } from "../../../ui/engine-icons";
import { ENGINE_LABELS } from "../../../drivers/defaults";
import type { ConnectionSummary, HostMessage, WebviewMessage } from "../protocol";

// Inline SVG icons for the schema tree — no external assets needed.
const iconDatabase = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><ellipse cx="8" cy="4" rx="6" ry="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 4v4c0 1.38 2.69 2.5 6 2.5S14 9.38 14 8V4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 8v4c0 1.38 2.69 2.5 6 2.5S14 13.38 14 12V8" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
const iconSchema = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="1" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="5" y="9" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 7v2h4M12 7v2H8" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>`;
const iconTable = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1 5h14M5 5v10" stroke="currentColor" stroke-width="1.2"/></svg>`;
const iconView = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M8 3C4 3 1 8 1 8s3 5 7 5 7-5 7-5-3-5-7-5Z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
const iconFunction = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M3 3a2 2 0 0 1 2-2h.5v1.5H5a.5.5 0 0 0-.5.5v3L3 7.5 4.5 9v3a.5.5 0 0 0 .5.5h.5V14H5a2 2 0 0 1-2-2V9.5L1.5 7.5 3 6V3Z" fill="currentColor"/><path d="M13 3a2 2 0 0 0-2-2h-.5v1.5H11a.5.5 0 0 1 .5.5v3l1.5 1.5-1.5 1.5v3a.5.5 0 0 1-.5.5h-.5V14H11a2 2 0 0 0 2-2V9.5l1.5-2L13 6V3Z" fill="currentColor"/></svg>`;
const iconProcedure = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M2 3h12M2 8h12M2 13h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/><circle cx="13" cy="13" r="2" fill="currentColor"/><path d="M12 12 L14 14 M14 12 L12 14" stroke="white" stroke-width="1.2" stroke-linecap="round"/></svg>`;
const iconKey = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="7" r="4" fill="none" stroke="#f59e0b" stroke-width="1.8"/><path d="M10 9l5 5" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round"/><path d="M13 12l-1 1" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const iconColumn = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none" opacity="0.5"/></svg>`;

interface VsCodeApi {
  postMessage(m: WebviewMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

interface State {
  connections: ConnectionSummary[];
  activeId: string | undefined;
  liveIds: Set<string>;
  open: Set<string>; // expanded connection ids
  openNodes: Set<string>; // expanded db/schema/table paths
  schemas: Map<string, { model: SchemaModel | null; error?: string; loading: boolean }>;
  filter: string;
}

const state: State = {
  connections: [],
  activeId: undefined,
  liveIds: new Set(),
  open: new Set(),
  openNodes: new Set(),
  schemas: new Map(),
  filter: "",
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

window.addEventListener("message", (e: MessageEvent<HostMessage>) => handle(e.data));

function handle(m: HostMessage): void {
  if (m.type === "state") {
    state.connections = m.connections;
    state.activeId = m.activeId;
    state.liveIds = new Set(m.liveIds);
    // Restore persisted expand state on first state push.
    if (m.openConnections && state.open.size === 0) {
      for (const id of m.openConnections) state.open.add(id);
      // Auto-request schemas for restored connections so the tree renders
      // without a second click.
      for (const id of state.open) {
        if (!state.schemas.has(id)) {
          state.schemas.set(id, { model: null, loading: true });
          vscode.postMessage({ type: "loadSchema", profileId: id });
        }
      }
    }
    if (m.openNodes && state.openNodes.size === 0) {
      for (const p of m.openNodes) state.openNodes.add(p);
    }
    render();
    return;
  }
  if (m.type === "activeChanged") {
    state.activeId = m.activeId;
    render();
    return;
  }
  if (m.type === "liveChanged") {
    state.liveIds = new Set(m.liveIds);
    render();
    return;
  }
  if (m.type === "schema") {
    state.schemas.set(m.profileId, { model: m.model, error: m.error, loading: false });
    renderSchemaFor(m.profileId);
    return;
  }
}

// ------- header wiring -------

const searchEl = $("search") as HTMLInputElement;
searchEl.addEventListener("input", () => {
  state.filter = searchEl.value.trim().toLowerCase();
  render();
});
$("refresh-btn").addEventListener("click", () => {
  state.schemas.clear();
  vscode.postMessage({ type: "refresh" });
});
$("add-btn").addEventListener("click", () => vscode.postMessage({ type: "addConnection" }));



// ------- render -------

function render(): void {
  const list = $("list");
  const filtered = filterConnections(state.connections, state.filter);
  if (state.connections.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🗄️</div>
        <div>No connections yet.</div>
        <button class="primary" id="empty-add">+ Add your first connection</button>
      </div>`;
    document.getElementById("empty-add")?.addEventListener("click", () =>
      vscode.postMessage({ type: "addConnection" }),
    );
    return;
  }
  list.innerHTML = filtered.map(renderConnection).join("");
  wireConnectionEvents();
  // Re-wire schema tree events for all open connections whose tree was inlined
  // into the HTML by renderConnection (happens when schema is already cached).
  for (const id of state.open) {
    const treeEl = document.querySelector<HTMLElement>(`[data-conn-tree="${id}"]`);
    if (treeEl && treeEl.children.length > 0) wireSchemaEvents(treeEl, id);
  }
}

function filterConnections(conns: ConnectionSummary[], filter: string): ConnectionSummary[] {
  if (!filter) return conns;
  return conns.filter((c) => {
    if (c.name.toLowerCase().includes(filter)) return true;
    if (c.engine.toLowerCase().includes(filter)) return true;
    // If we have a schema model loaded, match against table names too.
    const s = state.schemas.get(c.id)?.model;
    if (!s) return false;
    return s.databases.some((d) =>
      d.schemas.some((sc) => sc.tables.some((t) => t.name.toLowerCase().includes(filter))),
    );
  });
}

function renderConnection(c: ConnectionSummary): string {
  const open = state.open.has(c.id);
  const active = c.id === state.activeId;
  const live = state.liveIds.has(c.id);
  const accent = `var(--vsx-accent-${c.engine})`;
  const meta = c.filePath ?? `${c.host ?? ""}${c.database ? "/" + c.database : ""}`;
  const treeBody = open ? renderSchema(c.id) : "";
  return `<div class="conn ${open ? "open" : ""} ${active ? "active" : ""}"
       data-conn="${c.id}" style="--engine-accent:${accent}">
    <div class="conn-row" data-action="toggle">
      <span class="caret">▸</span>
      <span class="engine-svg">${getEngineSvg(c.engine, 24)}</span>
      <div class="conn-info">
        <div class="conn-name">
          ${live ? `<span class="dot" title="Live session"></span>` : ""}
          <span class="vsx-truncate">${escapeHtml(c.name)}</span>
          ${active && !live ? `<span class="vsx-muted" style="font-size:10px;">active</span>` : ""}
        </div>
        <div class="conn-meta">${escapeHtml(ENGINE_LABELS[c.engine])}${meta ? " · " + escapeHtml(meta) : ""}</div>
      </div>
      <div class="conn-actions">
        <button class="ghost" data-action="new-query" title="New SQL query against this connection">▶</button>
        ${active ? "" : `<button class="ghost" data-action="set-active" title="Set active">★</button>`}
        <button class="ghost" data-action="edit" title="Edit">✎</button>
        <button class="ghost" data-action="duplicate" title="Duplicate">⧉</button>
        <button class="ghost danger" data-action="delete" title="Delete">✕</button>
      </div>
    </div>
    <div class="schema-tree" data-conn-tree="${c.id}">${treeBody}</div>
  </div>`;
}

function wireConnectionEvents(): void {
  document.querySelectorAll<HTMLElement>(".conn").forEach((el) => {
    const id = el.dataset.conn!;
    el.querySelectorAll<HTMLElement>("[data-action]").forEach((target) => {
      target.addEventListener("click", (e) => {
        e.stopPropagation();
        const action = target.dataset.action;
        if (action === "toggle") onConnectionClick(id);
        else if (action === "new-query")
          vscode.postMessage({ type: "newQuery", profileId: id });
        else if (action === "set-active") vscode.postMessage({ type: "setActive", profileId: id });
        else if (action === "edit") vscode.postMessage({ type: "edit", profileId: id });
        else if (action === "duplicate")
          vscode.postMessage({ type: "duplicate", profileId: id });
        else if (action === "delete") vscode.postMessage({ type: "delete", profileId: id });
      });
    });
    // Click anywhere on the row (other than buttons) → set active
    el.querySelector(".conn-row")?.addEventListener("dblclick", () =>
      vscode.postMessage({ type: "setActive", profileId: id }),
    );
  });
}

function persistExpanded(): void {
  vscode.postMessage({
    type: "expandedChanged",
    openConnections: [...state.open],
    openNodes: [...state.openNodes],
  });
}

function onConnectionClick(id: string): void {
  if (state.open.has(id)) {
    state.open.delete(id);
  } else {
    state.open.add(id);
    if (!state.schemas.has(id)) {
      state.schemas.set(id, { model: null, loading: true });
      vscode.postMessage({ type: "loadSchema", profileId: id });
    }
  }
  persistExpanded();
  render();
}

// ------- schema tree render (per connection) -------

function renderSchemaFor(profileId: string): void {
  const treeEl = document.querySelector<HTMLElement>(`[data-conn-tree="${profileId}"]`);
  if (!treeEl) return;
  treeEl.innerHTML = renderSchema(profileId);
  wireSchemaEvents(treeEl, profileId);
}

function renderSchema(profileId: string): string {
  const entry = state.schemas.get(profileId);
  if (!entry || entry.loading) return `<div class="loading">Loading schema…</div>`;
  if (entry.error) return `<div class="err">${escapeHtml(entry.error)}</div>`;
  if (!entry.model || entry.model.databases.length === 0) {
    return `<div class="loading">No databases found. Run a CREATE statement from a New Query.</div>`;
  }
  return entry.model.databases.map((d) => renderDb(profileId, d)).join("");
}

function renderDb(profileId: string, d: SchemaModel["databases"][number]): string {
  const path = `${profileId}|db|${d.name}`;
  const open = state.openNodes.has(path);
  const schemas = open ? d.schemas.map((s) => renderSchemaNode(profileId, d.name, s)).join("") : "";
  return `<div class="branch lvl-db ${open ? "open" : ""}" data-path="${path}">
    <span class="caret">▸</span>
    <span class="icon">${iconDatabase}</span>
    <span class="label">${escapeHtml(d.name)}</span>
    <span class="badge">${d.schemas.length} schema${d.schemas.length === 1 ? "" : "s"}</span>
  </div>${schemas}`;
}

function renderSchemaNode(
  profileId: string,
  database: string,
  s: SchemaModel["databases"][number]["schemas"][number],
): string {
  const path = `${profileId}|sch|${database}|${s.name}`;
  const open = state.openNodes.has(path);
  const fns = s.functions ?? [];
  const children = open
    ? s.tables.length === 0 && fns.length === 0
      ? `<div class="branch lvl-table" style="opacity:0.6"><span class="label">(empty — no tables yet)</span></div>`
      : [
          ...s.tables.map((t) => renderTable(profileId, database, s.name, t)),
          ...fns.map((f) => renderFunction(f)),
        ].join("")
    : "";
  const totalCount = s.tables.length + fns.length;
  return `<div class="branch lvl-sch ${open ? "open" : ""}" data-path="${path}">
    <span class="caret">▸</span>
    <span class="icon">${iconSchema}</span>
    <span class="label">${escapeHtml(s.name)}</span>
    <span class="badge">${totalCount}</span>
  </div>${children}`;
}

function renderTable(
  profileId: string,
  database: string,
  schema: string,
  t: SchemaModel["databases"][number]["schemas"][number]["tables"][number],
): string {
  const path = `${profileId}|tbl|${database}|${schema}|${t.name}`;
  const open = state.openNodes.has(path);
  const matched = state.filter && t.name.toLowerCase().includes(state.filter);
  const hidden =
    state.filter &&
    !matched &&
    !state.openNodes.has(path)
      ? "hidden"
      : "";
  const cols = open
    ? t.columns
        .map(
          (c) =>
            `<div class="branch lvl-col"><span class="icon">${t.primaryKey.includes(c.name) ? iconKey : iconColumn}</span><span class="label">${escapeHtml(c.name)}</span><span class="badge">${escapeHtml(c.type)}</span></div>`,
        )
        .join("")
    : "";
  const icon = t.isView ? iconView : iconTable;
  return `<div class="branch lvl-table ${open ? "open" : ""} row ${matched ? "match" : ""} ${hidden}"
       data-path="${path}"
       data-table-preview="${profileId}|${database}|${schema}|${t.name}|${t.isView ? 1 : 0}">
    <span class="caret">▸</span>
    <span class="icon">${icon}</span>
    <span class="label">${escapeHtml(t.name)}</span>
    <span class="badge">${t.columns.length} cols</span>
  </div>${cols}`;
}

function renderFunction(f: SchemaModel["databases"][number]["schemas"][number]["functions"][number]): string {
  const icon = f.kind === "procedure" ? iconProcedure : iconFunction;
  const tooltip = f.arguments ? escapeHtml(`${f.name}(${f.arguments})`) : escapeHtml(f.name);
  return `<div class="branch lvl-fn" title="${tooltip}">
    <span class="caret" style="visibility:hidden">▸</span>
    <span class="icon">${icon}</span>
    <span class="label">${escapeHtml(f.name)}</span>
    <span class="badge">${f.kind}</span>
  </div>`;
}

function wireSchemaEvents(rootEl: HTMLElement, profileId: string): void {
  rootEl.querySelectorAll<HTMLElement>(".branch[data-path]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const path = el.dataset.path!;
      const preview = el.dataset.tablePreview;
      // If this is a table and it's already open, treat the click as preview;
      // otherwise expand. Double-click always previews.
      if (state.openNodes.has(path)) state.openNodes.delete(path);
      else state.openNodes.add(path);
      persistExpanded();
      renderSchemaFor(profileId);
      void preview;
    });
    el.addEventListener("dblclick", (e) => {
      const preview = el.dataset.tablePreview;
      if (!preview) return;
      e.stopPropagation();
      const [pid, database, schema, table, isViewFlag] = preview.split("|");
      vscode.postMessage({
        type: "previewTable",
        profileId: pid,
        database,
        schema,
        table,
        isView: isViewFlag === "1",
      });
    });
  });
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

// ------- Right-click context menu -------

interface MenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  onClick: () => void;
}
interface MenuSection {
  header?: string;
  items: MenuItem[];
}

const menuEl = $("ctx-menu");

function showMenu(x: number, y: number, sections: MenuSection[]): void {
  const html = sections
    .map((sec, si) => {
      const header = sec.header
        ? `<div class="header">${escapeHtml(sec.header)}</div>`
        : "";
      const items = sec.items
        .map(
          (it, ii) =>
            `<div class="item ${it.danger ? "danger" : ""}" data-section="${si}" data-idx="${ii}">
              <span class="ic">${it.icon ?? ""}</span><span>${escapeHtml(it.label)}</span>
            </div>`,
        )
        .join("");
      return header + items + (si < sections.length - 1 ? `<div class="sep"></div>` : "");
    })
    .join("");
  menuEl.innerHTML = html;
  menuEl.classList.add("show");
  // Position; clamp into viewport.
  menuEl.style.left = `${x}px`;
  menuEl.style.top = `${y}px`;
  requestAnimationFrame(() => {
    const rect = menuEl.getBoundingClientRect();
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (rect.right > w) menuEl.style.left = `${w - rect.width - 6}px`;
    if (rect.bottom > h) menuEl.style.top = `${h - rect.height - 6}px`;
  });
  menuEl.querySelectorAll<HTMLElement>(".item").forEach((el) => {
    el.addEventListener("click", () => {
      const si = Number(el.dataset.section);
      const ii = Number(el.dataset.idx);
      const item = sections[si]?.items[ii];
      hideMenu();
      if (item) item.onClick();
    });
  });
}

function hideMenu(): void {
  menuEl.classList.remove("show");
  menuEl.innerHTML = "";
}

document.addEventListener("click", (e) => {
  if (!menuEl.contains(e.target as Node)) hideMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideMenu();
});

document.addEventListener("contextmenu", (e) => {
  // Connection card right-click
  const connRow = (e.target as HTMLElement).closest<HTMLElement>(".conn-row");
  if (connRow) {
    e.preventDefault();
    const conn = connRow.closest<HTMLElement>(".conn");
    const id = conn?.dataset.conn;
    if (!id) return;
    const active = id === state.activeId;
    showMenu(e.clientX, e.clientY, [
      {
        items: [
          {
            label: "New Query",
            icon: "▶",
            onClick: () => vscode.postMessage({ type: "newQuery", profileId: id }),
          },
          ...(active
            ? []
            : [
                {
                  label: "Set Active",
                  icon: "★",
                  onClick: () =>
                    vscode.postMessage({ type: "setActive", profileId: id }),
                },
              ]),
        ],
      },
      {
        header: "Schema",
        items: [
          {
            label: "Create Database…",
            icon: "✚",
            onClick: () =>
              vscode.postMessage({ type: "createDatabase", profileId: id }),
          },
          {
            label: "Refresh",
            icon: "↻",
            onClick: () => vscode.postMessage({ type: "refresh" }),
          },
        ],
      },
      {
        items: [
          {
            label: "Edit Connection",
            icon: "✎",
            onClick: () => vscode.postMessage({ type: "edit", profileId: id }),
          },
          {
            label: "Duplicate Connection",
            icon: "⧉",
            onClick: () => vscode.postMessage({ type: "duplicate", profileId: id }),
          },
          {
            label: "Delete Connection",
            icon: "✕",
            danger: true,
            onClick: () => vscode.postMessage({ type: "delete", profileId: id }),
          },
        ],
      },
    ]);
    return;
  }
  // Branch (db / schema / table) right-click
  const branch = (e.target as HTMLElement).closest<HTMLElement>(".branch[data-path]");
  if (branch) {
    e.preventDefault();
    const path = branch.dataset.path!;
    const parts = path.split("|");
    const profileId = parts[0];
    const kind = parts[1]; // "db" | "sch" | "tbl"
    if (kind === "db") {
      const database = parts[2];
      showMenu(e.clientX, e.clientY, [
        {
          items: [
            {
              label: "Create Schema…",
              icon: "✚",
              onClick: () =>
                vscode.postMessage({ type: "createSchema", profileId, database }),
            },
          ],
        },
      ]);
    } else if (kind === "sch") {
      const database = parts[2];
      const schema = parts[3];
      showMenu(e.clientX, e.clientY, [
        {
          items: [
            {
              label: "Create Table…",
              icon: "✚",
              onClick: () =>
                vscode.postMessage({
                  type: "createTable",
                  profileId,
                  database,
                  schema,
                }),
            },
          ],
        },
      ]);
    } else if (kind === "tbl") {
      const database = parts[2];
      const schema = parts[3];
      const table = parts[4];
      const preview = branch.dataset.tablePreview;
      const isView = preview ? preview.split("|")[4] === "1" : false;
      showMenu(e.clientX, e.clientY, [
        {
          items: [
            {
              label: "Preview Data",
              icon: "▦",
              onClick: () =>
                vscode.postMessage({
                  type: "previewTable",
                  profileId,
                  database,
                  schema,
                  table,
                  isView,
                }),
            },
            ...(isView
              ? []
              : [
                  {
                    label: "Edit Schema…",
                    icon: "✎",
                    onClick: () =>
                      vscode.postMessage({
                        type: "editTable",
                        profileId,
                        database,
                        schema,
                        table,
                      }),
                  },
                ]),
            {
              label: isView ? "Drop View" : "Drop Table",
              icon: "✕",
              danger: true,
              onClick: () =>
                vscode.postMessage({
                  type: "dropTable",
                  profileId,
                  database,
                  schema,
                  table,
                  isView,
                }),
            },
          ],
        },
      ]);
    }
  }
});

// kick off
vscode.postMessage({ type: "ready" });
