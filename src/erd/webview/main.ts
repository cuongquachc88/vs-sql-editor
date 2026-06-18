import type { EngineId, SchemaModel } from "../../drivers/types";
import type {
  HostMessage,
  LayoutMap,
  NodePosition,
  WebviewMessage,
} from "../protocol";

interface VsCodeApi {
  postMessage(m: WebviewMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

const COL_H = 22;
const HEADER_H = 28;
const NODE_W = 220;
const PAD = 24;

interface NodeData {
  key: string; // "schema|table"
  database: string;
  schema: string;
  name: string;
  isView: boolean;
  pos: NodePosition;
  cols: { name: string; type: string; isPk: boolean }[];
}

interface FkLink {
  from: { key: string; col: string };
  to: { key: string; col: string };
}

interface State {
  engine: EngineId | undefined;
  model: SchemaModel | undefined;
  nodes: Map<string, NodeData>;
  links: FkLink[];
  scale: number;
  tx: number; // pan x
  ty: number; // pan y
  filter: string;
}

const state: State = {
  engine: undefined,
  model: undefined,
  nodes: new Map(),
  links: [],
  scale: 1,
  tx: 0,
  ty: 0,
  filter: "",
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

window.addEventListener("message", (e: MessageEvent<HostMessage>) => handle(e.data));

function handle(m: HostMessage): void {
  if (m.type === "schemaError") {
    $("placeholder").className = "err";
    $("placeholder").textContent = m.message;
    $("placeholder").style.display = "";
    $("canvas").style.display = "none";
    return;
  }
  // state
  state.engine = m.engine;
  state.model = m.model;
  buildNodes(m.model, m.layout);
  buildLinks(m.model);
  $("placeholder").style.display = "none";
  $("canvas").style.display = "";
  document.documentElement.style.setProperty(
    "--engine-accent",
    `var(--vsx-accent-${m.engine})`,
  );
  render();
  fit();
}

// ------- build model -------

function buildNodes(model: SchemaModel, layout: LayoutMap): void {
  state.nodes.clear();
  const auto = layoutGrid(model, layout);
  for (const db of model.databases) {
    for (const sc of db.schemas) {
      for (const t of sc.tables) {
        const key = `${sc.name}|${t.name}`;
        state.nodes.set(key, {
          key,
          database: db.name,
          schema: sc.name,
          name: t.name,
          isView: t.isView,
          pos: layout[key] ?? auto[key] ?? { x: 0, y: 0 },
          cols: t.columns.map((c) => ({
            name: c.name,
            type: c.type,
            isPk: t.primaryKey.includes(c.name),
          })),
        });
      }
    }
  }
}

function layoutGrid(model: SchemaModel, taken: LayoutMap): Record<string, NodePosition> {
  const out: Record<string, NodePosition> = {};
  const all: NodeData[] = [];
  for (const db of model.databases) {
    for (const sc of db.schemas) {
      for (const t of sc.tables) {
        all.push({
          key: `${sc.name}|${t.name}`,
          database: db.name,
          schema: sc.name,
          name: t.name,
          isView: t.isView,
          pos: { x: 0, y: 0 },
          cols: t.columns.map((c) => ({ name: c.name, type: c.type, isPk: false })),
        });
      }
    }
  }
  const cols = Math.max(1, Math.ceil(Math.sqrt(all.length)));
  let i = 0;
  for (const n of all) {
    if (taken[n.key]) {
      i++;
      continue;
    }
    const r = Math.floor(i / cols);
    const c = i % cols;
    out[n.key] = { x: PAD + c * (NODE_W + 60), y: PAD + r * 260 };
    i++;
  }
  return out;
}

function buildLinks(model: SchemaModel): void {
  state.links = [];
  // index for ref lookup
  const tables = new Map<string, { schema: string; name: string }>();
  for (const db of model.databases) {
    for (const sc of db.schemas) {
      for (const t of sc.tables) {
        tables.set(`${sc.name}|${t.name}`, { schema: sc.name, name: t.name });
        tables.set(`|${t.name}`, { schema: sc.name, name: t.name }); // schemaless fallback
      }
    }
  }
  for (const db of model.databases) {
    for (const sc of db.schemas) {
      for (const t of sc.tables) {
        for (const fk of t.foreignKeys) {
          const refKey = `${fk.refSchema ?? sc.name}|${fk.refTable}`;
          const ref = tables.get(refKey) ?? tables.get(`|${fk.refTable}`);
          if (!ref) continue;
          // Only render the first column of a composite FK (most ERDs do this).
          state.links.push({
            from: { key: `${sc.name}|${t.name}`, col: fk.columns[0] },
            to: { key: `${ref.schema}|${ref.name}`, col: fk.refColumns[0] },
          });
        }
      }
    }
  }
}

// ------- render -------

function render(): void {
  const vp = $("viewport") as unknown as SVGGElement;
  vp.setAttribute("transform", `translate(${state.tx},${state.ty}) scale(${state.scale})`);

  // Render order: links first (behind nodes), then nodes.
  const links = state.links
    .map((l) => `<path class="fk-line" d="${pathFor(l)}" marker-end="url(#fk-arrow)"
      data-from="${l.from.key}" data-to="${l.to.key}"></path>`)
    .join("");

  const nodes = [...state.nodes.values()]
    .map((n) => renderNode(n))
    .join("");
  vp.innerHTML = links + nodes;
  wireNodeEvents();
  $("zoom-info").textContent = `${Math.round(state.scale * 100)}%`;
}

function renderNode(n: NodeData): string {
  const h = HEADER_H + n.cols.length * COL_H;
  const matched =
    state.filter && (n.name.toLowerCase().includes(state.filter) ? "match" : "");
  const cols = n.cols
    .map((c, i) => {
      const y = HEADER_H + i * COL_H;
      const pk = c.isPk ? `<text class="pk-glyph" x="10" y="${y + 14}">🔑</text>` : "";
      const cleanType = c.type.length > 16 ? c.type.slice(0, 16) + "…" : c.type;
      return `<g class="col-row" data-col="${escapeAttr(c.name)}">
        <rect x="0" y="${y}" width="${NODE_W}" height="${COL_H}" fill="transparent"></rect>
        ${pk}
        <text class="node-col" x="26" y="${y + 14}">${escapeXml(c.name)}</text>
        <text class="node-col-type" x="${NODE_W - 10}" y="${y + 14}" text-anchor="end">${escapeXml(cleanType)}</text>
      </g>`;
    })
    .join("");
  const titleText = n.isView ? `◇ ${n.name}` : n.name;
  return `<g class="node-group ${matched}" data-key="${escapeAttr(n.key)}"
       transform="translate(${n.pos.x},${n.pos.y})">
    <rect class="node-bg" width="${NODE_W}" height="${h}" rx="6" ry="6"></rect>
    <rect class="node-header" width="${NODE_W}" height="${HEADER_H}" rx="6" ry="6"></rect>
    <rect class="node-header" y="${HEADER_H - 6}" width="${NODE_W}" height="6" rx="0" ry="0"></rect>
    <text class="node-title" x="${NODE_W / 2}" y="${HEADER_H / 2 + 4}" text-anchor="middle">${escapeXml(titleText)}</text>
    ${cols}
  </g>`;
}

function pathFor(l: FkLink): string {
  const a = anchorFor(l.from, "right");
  const b = anchorFor(l.to, "left");
  if (!a || !b) return "";
  const dx = (b.x - a.x) * 0.5;
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
}

function anchorFor(
  ref: { key: string; col: string },
  side: "left" | "right",
): { x: number; y: number } | undefined {
  const n = state.nodes.get(ref.key);
  if (!n) return undefined;
  const idx = Math.max(0, n.cols.findIndex((c) => c.name === ref.col));
  const y = n.pos.y + HEADER_H + idx * COL_H + COL_H / 2;
  const x = side === "right" ? n.pos.x + NODE_W : n.pos.x;
  return { x, y };
}

// ------- drag (nodes) + pan + zoom -------

let nodeDrag:
  | { key: string; startMx: number; startMy: number; startX: number; startY: number }
  | undefined;
let pan: { startMx: number; startMy: number; startTx: number; startTy: number } | undefined;

function wireNodeEvents(): void {
  document.querySelectorAll<SVGGElement>(".node-group").forEach((el) => {
    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const key = el.dataset.key!;
      const n = state.nodes.get(key);
      if (!n) return;
      nodeDrag = {
        key,
        startMx: e.clientX,
        startMy: e.clientY,
        startX: n.pos.x,
        startY: n.pos.y,
      };
      el.classList.add("dragging");
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const key = el.dataset.key!;
      const n = state.nodes.get(key);
      if (!n) return;
      vscode.postMessage({
        type: "openTable",
        database: n.database,
        schema: n.schema,
        table: n.name,
        isView: n.isView,
      });
    });
    el.addEventListener("pointerup", (e) => {
      void e;
      el.classList.remove("dragging");
      if (nodeDrag) {
        nodeDrag = undefined;
        saveLayout();
      }
    });
  });
  document.querySelectorAll<SVGPathElement>(".fk-line").forEach((p) => {
    p.addEventListener("mouseenter", () => p.classList.add("highlight"));
    p.addEventListener("mouseleave", () => p.classList.remove("highlight"));
  });
}

document.addEventListener("pointermove", (e) => {
  if (nodeDrag) {
    const dx = (e.clientX - nodeDrag.startMx) / state.scale;
    const dy = (e.clientY - nodeDrag.startMy) / state.scale;
    const n = state.nodes.get(nodeDrag.key);
    if (!n) return;
    n.pos.x = nodeDrag.startX + dx;
    n.pos.y = nodeDrag.startY + dy;
    const el = document.querySelector<SVGGElement>(`.node-group[data-key="${cssEscape(nodeDrag.key)}"]`);
    if (el) el.setAttribute("transform", `translate(${n.pos.x},${n.pos.y})`);
    updateLinksFor(nodeDrag.key);
  } else if (pan) {
    state.tx = pan.startTx + (e.clientX - pan.startMx);
    state.ty = pan.startTy + (e.clientY - pan.startMy);
    ($("viewport") as unknown as SVGGElement).setAttribute(
      "transform",
      `translate(${state.tx},${state.ty}) scale(${state.scale})`,
    );
  }
});

document.addEventListener("pointerup", () => {
  pan = undefined;
  $("canvas").classList.remove("panning");
});

$("canvas").addEventListener("pointerdown", (e) => {
  if (e.target === $("canvas") || (e.target as HTMLElement).id === "viewport") {
    pan = {
      startMx: e.clientX,
      startMy: e.clientY,
      startTx: state.tx,
      startTy: state.ty,
    };
    $("canvas").classList.add("panning");
  }
});

$("canvas").addEventListener("wheel", (e) => {
  e.preventDefault();
  const delta = -e.deltaY * 0.001;
  zoomBy(delta, e.clientX, e.clientY);
});

function zoomBy(delta: number, cx?: number, cy?: number): void {
  const next = clamp(state.scale * (1 + delta), 0.2, 3);
  if (cx != null && cy != null) {
    const rect = $("canvas").getBoundingClientRect();
    const px = (cx - rect.left - state.tx) / state.scale;
    const py = (cy - rect.top - state.ty) / state.scale;
    state.scale = next;
    state.tx = cx - rect.left - px * state.scale;
    state.ty = cy - rect.top - py * state.scale;
  } else {
    state.scale = next;
  }
  ($("viewport") as unknown as SVGGElement).setAttribute(
    "transform",
    `translate(${state.tx},${state.ty}) scale(${state.scale})`,
  );
  $("zoom-info").textContent = `${Math.round(state.scale * 100)}%`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function updateLinksFor(nodeKey: string): void {
  const lines = Array.from(document.querySelectorAll<SVGPathElement>(".fk-line"));
  for (const line of lines) {
    if (line.dataset.from === nodeKey || line.dataset.to === nodeKey) {
      const from = line.dataset.from!;
      const to = line.dataset.to!;
      const linkLike = state.links.find((l) => l.from.key === from && l.to.key === to);
      if (linkLike) line.setAttribute("d", pathFor(linkLike));
    }
  }
}

function saveLayout(): void {
  const layout: LayoutMap = {};
  for (const [k, n] of state.nodes) layout[k] = { x: n.pos.x, y: n.pos.y };
  vscode.postMessage({ type: "saveLayout", layout });
}

// ------- toolbar -------

$("zoom-in").addEventListener("click", () => zoomBy(0.15));
$("zoom-out").addEventListener("click", () => zoomBy(-0.15));
$("fit").addEventListener("click", fit);
$("reset").addEventListener("click", () => vscode.postMessage({ type: "resetLayout" }));

const searchEl = $("search") as HTMLInputElement;
searchEl.addEventListener("input", () => {
  state.filter = searchEl.value.trim().toLowerCase();
  render();
  if (state.filter) {
    // jump to first match
    const match = [...state.nodes.values()].find((n) =>
      n.name.toLowerCase().includes(state.filter),
    );
    if (match) centerOn(match.pos.x + NODE_W / 2, match.pos.y + HEADER_H / 2);
  }
});

$("download").addEventListener("click", () => {
  const svg = $("canvas").outerHTML;
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `erd-${Date.now()}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function fit(): void {
  if (state.nodes.size === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of state.nodes.values()) {
    minX = Math.min(minX, n.pos.x);
    minY = Math.min(minY, n.pos.y);
    maxX = Math.max(maxX, n.pos.x + NODE_W);
    maxY = Math.max(maxY, n.pos.y + HEADER_H + n.cols.length * COL_H);
  }
  const rect = $("canvas").getBoundingClientRect();
  const w = maxX - minX + PAD * 2;
  const h = maxY - minY + PAD * 2;
  state.scale = clamp(Math.min(rect.width / w, rect.height / h), 0.3, 1.4);
  state.tx = -minX * state.scale + (rect.width - (maxX - minX) * state.scale) / 2;
  state.ty = -minY * state.scale + (rect.height - (maxY - minY) * state.scale) / 2;
  ($("viewport") as unknown as SVGGElement).setAttribute(
    "transform",
    `translate(${state.tx},${state.ty}) scale(${state.scale})`,
  );
  $("zoom-info").textContent = `${Math.round(state.scale * 100)}%`;
}

function centerOn(x: number, y: number): void {
  const rect = $("canvas").getBoundingClientRect();
  state.tx = rect.width / 2 - x * state.scale;
  state.ty = rect.height / 2 - y * state.scale;
  ($("viewport") as unknown as SVGGElement).setAttribute(
    "transform",
    `translate(${state.tx},${state.ty}) scale(${state.scale})`,
  );
}

function escapeXml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
function escapeAttr(s: string): string {
  return escapeXml(s);
}
function cssEscape(s: string): string {
  return s.replace(/(["\\])/g, "\\$1");
}

vscode.postMessage({ type: "ready" });
