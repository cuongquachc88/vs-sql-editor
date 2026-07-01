import type { EngineId } from "../../../drivers/types";
import { DEFAULT_PORT, ENGINE_LABELS, isFileEngine } from "../../../drivers/defaults";
import type { FormMode, FormProfile, HostMessage, WebviewMessage } from "../protocol";

interface VsCodeApi {
  postMessage(m: WebviewMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const allByGroup = (g: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(`[data-group="${g}"]`));

let mode: FormMode = "add";
let hasExistingSecret = false;
let selectedEngine: EngineId = "postgres";
let inFlight = false;

function updateSslCaVisibility(): void {
  const sslMode = ($("sslMode") as HTMLSelectElement).value;
  const show = sslMode === "verify-ca" || sslMode === "verify-full";
  $("ssl-ca-field").toggleAttribute("hidden", !show);

  // For ClickHouse, suggest the right default port when SSL is toggled.
  if (selectedEngine === "clickhouse") {
    const portEl = $("port") as HTMLInputElement;
    const sslOn = sslMode && sslMode !== "disable";
    const expectedDefault = sslOn ? "8443" : "8123";
    const otherDefault = sslOn ? "8123" : "8443";
    // Only update if the user has not changed it from the other default.
    if (portEl.value === otherDefault || portEl.value === "") {
      portEl.value = expectedDefault;
    }
  }
}

function init(): void {
  // Engine cards
  document.querySelectorAll<HTMLElement>(".engine-card").forEach((card) => {
    card.addEventListener("click", () => selectEngine(card.dataset.engine as EngineId));
  });

  $("browse").addEventListener("click", () => {
    if (isFileEngine(selectedEngine))
      vscode.postMessage({ type: "pickFile", engine: selectedEngine });
  });
  $("cancel").addEventListener("click", () => vscode.postMessage({ type: "cancel" }));
  $("test").addEventListener("click", () => doTest());
  $("add-opt").addEventListener("click", () => addOptRow("", ""));
  $("sslMode").addEventListener("change", () => updateSslCaVisibility());
  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    doSave();
  });

  window.addEventListener("message", (e: MessageEvent<HostMessage>) => handle(e.data));
  vscode.postMessage({ type: "ready" });
}

function handle(m: HostMessage): void {
  if (m.type === "init") {
    mode = m.mode;
    hasExistingSecret = Boolean(m.hasExistingSecret);
    populate(m.profile);
    updateTitle();
    setStatus(null);
  }
  if (m.type === "testResult") {
    inFlight = false;
    setBusy(false);
    setStatus(
      m.ok
        ? { kind: "ok", text: "✓ Connection succeeded." }
        : { kind: "err", text: `✕ Connection failed: ${m.error ?? "unknown"}` },
    );
  }
  if (m.type === "filePicked") {
    ($("filePath") as HTMLInputElement).value = m.path;
  }
  if (m.type === "saveError") {
    inFlight = false;
    setBusy(false);
    setStatus({ kind: "err", text: m.message });
  }
}

function populate(p: FormProfile | undefined): void {
  selectedEngine = (p?.engine ?? "postgres") as EngineId;
  ($("name") as HTMLInputElement).value = p?.name ?? "";
  ($("host") as HTMLInputElement).value = p?.host ?? "localhost";
  ($("port") as HTMLInputElement).value =
    p?.port != null ? String(p.port) : String(DEFAULT_PORT[selectedEngine] ?? "");
  ($("database") as HTMLInputElement).value = p?.database ?? "";
  ($("user") as HTMLInputElement).value = p?.user ?? "";
  ($("filePath") as HTMLInputElement).value = p?.filePath ?? "";

  const pwd = $("password") as HTMLInputElement;
  pwd.value = "";
  pwd.placeholder =
    mode === "edit" && hasExistingSecret
      ? "(unchanged — type to replace, leave blank to keep)"
      : "";

  // SSL
  ($("sslMode") as HTMLSelectElement).value = p?.sslMode ?? "";
  ($("sslCa") as HTMLInputElement).value = p?.sslCa ?? "";
  updateSslCaVisibility();

  // Options
  $("opts").innerHTML = "";
  const opts = p?.options ?? {};
  const entries = Object.entries(opts);
  if (entries.length === 0) addOptRow("", "");
  else entries.forEach(([k, v]) => addOptRow(k, String(v)));

  selectEngine(selectedEngine);
}

function addOptRow(k: string, v: string): void {
  const row = document.createElement("div");
  row.className = "opt-row";
  row.innerHTML = `
    <input class="opt-key" type="text" placeholder="key" />
    <input class="opt-val" type="text" placeholder="value" />
    <button type="button" class="ghost opt-remove" title="Remove">✕</button>
  `;
  (row.querySelector(".opt-key") as HTMLInputElement).value = k;
  (row.querySelector(".opt-val") as HTMLInputElement).value = v;
  (row.querySelector(".opt-remove") as HTMLButtonElement).addEventListener("click", () =>
    row.remove(),
  );
  $("opts").appendChild(row);
}

function selectEngine(engine: EngineId): void {
  selectedEngine = engine;
  document.querySelectorAll<HTMLElement>(".engine-card").forEach((card) => {
    const selected = card.dataset.engine === engine;
    card.classList.toggle("selected", selected);
    if (selected) card.style.setProperty("--engine-accent", card.dataset.accent ?? "");
  });

  const fileGroup = allByGroup("file");
  const netGroup = allByGroup("net");
  const isFile = isFileEngine(engine);
  fileGroup.forEach((el) => el.toggleAttribute("hidden", !isFile));
  netGroup.forEach((el) => el.toggleAttribute("hidden", isFile));

  if (engine === "sqlite") {
    $("filePathLabel").textContent = "Database file";
    $("fileHint").textContent = "Path to a SQLite .db / .sqlite file.";
  } else if (engine === "pglite") {
    $("filePathLabel").textContent = "Data directory";
    $("fileHint").textContent = "PGlite directory (leave blank for in-memory).";
  }

  if (!isFile) {
    const portEl = $("port") as HTMLInputElement;
    if (!portEl.value) portEl.value = String(DEFAULT_PORT[engine] ?? "");
  }

  updateTitle();
}

function updateTitle(): void {
  const verb = mode === "edit" ? "Edit" : mode === "duplicate" ? "Duplicate" : "Add";
  $("title").textContent = `${verb} ${ENGINE_LABELS[selectedEngine]} Connection`;
  const subtitle =
    mode === "edit"
      ? "Update the details below — leave password blank to keep the existing one."
      : "Fill in the connection details, then Test or Save.";
  $("subtitle").textContent = subtitle;
  ($("save") as HTMLButtonElement).textContent = mode === "edit" ? "Update" : "Save";
}

function readOptions(): Record<string, string> | undefined {
  const opts: Record<string, string> = {};
  document.querySelectorAll<HTMLElement>("#opts .opt-row").forEach((row) => {
    const k = (row.querySelector(".opt-key") as HTMLInputElement).value.trim();
    const v = (row.querySelector(".opt-val") as HTMLInputElement).value.trim();
    if (k) opts[k] = v;
  });
  return Object.keys(opts).length === 0 ? undefined : opts;
}

function readForm(): FormProfile {
  const profile: FormProfile = {
    name: ($("name") as HTMLInputElement).value.trim(),
    engine: selectedEngine,
  };
  if (isFileEngine(selectedEngine)) {
    const fp = ($("filePath") as HTMLInputElement).value.trim();
    if (fp) profile.filePath = fp;
  } else {
    const host = ($("host") as HTMLInputElement).value.trim();
    const portRaw = ($("port") as HTMLInputElement).value.trim();
    const port = Number(portRaw);
    const database = ($("database") as HTMLInputElement).value.trim();
    const user = ($("user") as HTMLInputElement).value.trim();
    if (host) profile.host = host;
    if (portRaw && Number.isFinite(port)) profile.port = port;
    if (database) profile.database = database;
    if (user) profile.user = user;

    const sslMode = ($("sslMode") as HTMLSelectElement).value;
    if (sslMode) profile.sslMode = sslMode as FormProfile["sslMode"];
    const sslCa = ($("sslCa") as HTMLInputElement).value.trim();
    if (sslCa) profile.sslCa = sslCa;
  }
  const opts = readOptions();
  if (opts) profile.options = opts;
  return profile;
}

function readSecret(): { secret?: string; clearSecret?: boolean } {
  const pwd = ($("password") as HTMLInputElement).value;
  if (mode === "edit" && hasExistingSecret) {
    if (pwd === "") return {};
    return { secret: pwd };
  }
  return pwd ? { secret: pwd } : {};
}

function doTest(): void {
  if (inFlight) return;
  const profile = readForm();
  if (!validate(profile)) return;
  const { secret } = readSecret();
  inFlight = true;
  setBusy(true);
  setStatus({ kind: "ok", text: "Testing…" });
  vscode.postMessage({ type: "test", profile, secret });
}

function doSave(): void {
  if (inFlight) return;
  const profile = readForm();
  if (!validate(profile)) return;
  const { secret, clearSecret } = readSecret();
  inFlight = true;
  setBusy(true);
  vscode.postMessage({ type: "save", profile, secret, clearSecret });
}

function validate(p: FormProfile): boolean {
  if (!p.name) {
    setStatus({ kind: "err", text: "Name is required." });
    return false;
  }
  if (isFileEngine(p.engine)) {
    if (p.engine === "sqlite" && !p.filePath) {
      setStatus({ kind: "err", text: "SQLite needs a database file." });
      return false;
    }
  } else if (!p.host) {
    setStatus({ kind: "err", text: "Host is required." });
    return false;
  }
  return true;
}

function setBusy(busy: boolean): void {
  ($("save") as HTMLButtonElement).disabled = busy;
  ($("test") as HTMLButtonElement).disabled = busy;
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

init();
