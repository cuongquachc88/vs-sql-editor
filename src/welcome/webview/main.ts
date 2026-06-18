import type { EngineId } from "../../drivers/types";
import { getEngineSvg } from "../../ui/engine-icons";
import { ENGINE_IDS, ENGINE_LABELS } from "../../drivers/defaults";
import type {
  HostMessage,
  WebviewMessage,
  WelcomeConnection,
  WelcomeRecent,
} from "../protocol";

interface VsCodeApi {
  postMessage(m: WebviewMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

window.addEventListener("message", (e: MessageEvent<HostMessage>) => handle(e.data));

function handle(m: HostMessage): void {
  if (m.type === "state") {
    renderConnections(m.connections, m.activeId);
    renderRecents(m.recents);
    renderSamples();
  }
}

// --- connections ---

function renderConnections(conns: WelcomeConnection[], activeId: string | undefined): void {
  const host = $("conns");
  const cards = conns.map((c) => renderConnCard(c, activeId === c.id)).join("");
  const add = `
    <div class="vsx-card add-card" data-action="add">
      <div class="plus">＋</div>
      <div>Add connection</div>
    </div>`;
  host.innerHTML = cards + add;
  host.querySelectorAll<HTMLElement>("[data-conn]").forEach((el) => {
    el.addEventListener("click", () => {
      vscode.postMessage({ type: "openConnection", profileId: el.dataset.conn! });
    });
  });
  host.querySelectorAll<HTMLElement>("[data-action='add']").forEach((el) => {
    el.addEventListener("click", () => vscode.postMessage({ type: "addConnection" }));
  });
}

function renderConnCard(c: WelcomeConnection, active: boolean): string {
  const meta = c.filePath ?? `${c.host ?? ""}${c.database ? "/" + c.database : ""}`;
  return `<div class="vsx-card conn-card ${active ? "active" : ""}"
       data-conn="${c.id}"
       style="--engine-accent: var(--vsx-accent-${c.engine})">
    <div class="top">
      ${getEngineSvg(c.engine, 28)}
      <div class="name">
        ${active ? `<span class="dot"></span>` : ""}
        <span class="vsx-truncate">${escapeHtml(c.name)}</span>
      </div>
    </div>
    <div class="engine">${escapeHtml(ENGINE_LABELS[c.engine])}</div>
    <div class="meta">${escapeHtml(meta || "—")}</div>
  </div>`;
}

// --- recents ---

function renderRecents(recents: WelcomeRecent[]): void {
  const host = $("recents");
  if (recents.length === 0) {
    host.innerHTML = `<div class="empty">No queries yet. Run one to see it here.</div>`;
    return;
  }
  host.innerHTML = recents
    .map(
      (r, i) => `<div class="recent" data-idx="${i}">
      <span class="${r.ok ? "dot-ok" : "dot-err"}"></span>
      <span class="sql">${escapeHtml(condense(r.sql))}</span>
      <span class="conn-label">${escapeHtml(r.profileName)}</span>
      <span class="ago">${ago(r.at)}</span>
    </div>`,
    )
    .join("");
  host.querySelectorAll<HTMLElement>(".recent").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = Number(el.dataset.idx);
      const r = recents[idx];
      vscode.postMessage({ type: "openQuery", sql: r.sql, profileId: r.profileId });
    });
  });
  $("clear-recents").onclick = () => vscode.postMessage({ type: "clearRecents" });
}

function condense(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function ago(at: number): string {
  const diff = Math.max(0, Date.now() - at);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// --- samples ---

interface Sample {
  engine: EngineId;
  label: string;
  descr: string;
}

const SAMPLES: Sample[] = [
  { engine: "postgres", label: "PostgreSQL hello", descr: "select version() + list tables" },
  { engine: "mysql", label: "MySQL hello", descr: "select version() + show tables" },
  { engine: "sqlite", label: "SQLite hello", descr: "sqlite_master schema preview" },
  { engine: "pglite", label: "PGlite hello", descr: "in-process Postgres demo" },
  { engine: "clickhouse", label: "ClickHouse hello", descr: "version + system.tables peek" },
];

function renderSamples(): void {
  const host = $("samples");
  host.innerHTML = SAMPLES.map(
    (s) => `<div class="vsx-card sample-card"
       data-engine="${s.engine}"
       style="--engine-accent: var(--vsx-accent-${s.engine})">
      <div class="label">${getEngineSvg(s.engine, 20)} ${escapeHtml(s.label)}</div>
      <div class="descr">${escapeHtml(s.descr)}</div>
    </div>`,
  ).join("");
  host.querySelectorAll<HTMLElement>("[data-engine]").forEach((el) => {
    el.addEventListener("click", () => {
      vscode.postMessage({ type: "openSample", engine: el.dataset.engine as EngineId });
    });
  });
  void ENGINE_IDS;
}

// --- hero ---

$("add-hero").onclick = () => vscode.postMessage({ type: "addConnection" });

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

vscode.postMessage({ type: "ready" });
