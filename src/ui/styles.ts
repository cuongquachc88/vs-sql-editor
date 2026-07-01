// Shared CSS injected into every webview panel's HTML <style> block.
// Single source of truth for the design tokens — change here, all surfaces
// (results, form, sidebar, welcome) update in lockstep.
//
// Design language: Linear / Notion — generous whitespace, subtle shadows,
// clear type hierarchy, soft borders. Adapts to VS Code light/dark themes.
export function getDesignTokensCss(): string {
  return `
:root {
  /* ── Spacing scale ─────────────────────────────────────────────────── */
  --vsx-gap-xs:  4px;
  --vsx-gap-sm:  8px;
  --vsx-gap:    12px;
  --vsx-gap-md: 16px;
  --vsx-gap-lg: 24px;
  --vsx-gap-xl: 32px;
  --vsx-gap-2xl:48px;

  /* ── Radii ──────────────────────────────────────────────────────────── */
  --vsx-radius-sm:  4px;
  --vsx-radius:     8px;
  --vsx-radius-lg: 12px;
  --vsx-radius-xl: 16px;

  /* ── Surfaces — layered above editor background ─────────────────────── */
  --vsx-surface:        color-mix(in srgb, var(--vscode-editor-background), var(--vscode-foreground)  4%);
  --vsx-surface-2:      color-mix(in srgb, var(--vscode-editor-background), var(--vscode-foreground)  7%);
  --vsx-surface-hover:  color-mix(in srgb, var(--vscode-editor-background), var(--vscode-foreground)  9%);
  --vsx-surface-active: color-mix(in srgb, var(--vscode-editor-background), var(--vscode-foreground) 14%);
  --vsx-border:         color-mix(in srgb, var(--vscode-foreground), transparent 86%);
  --vsx-border-strong:  color-mix(in srgb, var(--vscode-foreground), transparent 74%);

  /* ── Brand accent (indigo/violet — Linear-inspired) ────────────────── */
  --vsx-accent:         #6366f1;
  --vsx-accent-hover:   #4f46e5;
  --vsx-accent-subtle:  color-mix(in srgb, #6366f1, transparent 88%);
  --vsx-accent-border:  color-mix(in srgb, #6366f1, transparent 72%);

  /* ── Engine accents ─────────────────────────────────────────────────── */
  --vsx-accent-postgres:   #4169e1;
  --vsx-accent-mysql:      #00758F;
  --vsx-accent-sqlite:     #0f7dc0;
  --vsx-accent-pglite:     #6366f1;
  --vsx-accent-clickhouse: #f5a623;

  /* ── Semantic colors ────────────────────────────────────────────────── */
  --vsx-success: var(--vscode-testing-iconPassed, #22c55e);
  --vsx-warning: var(--vscode-notificationsWarningIcon-foreground, #f59e0b);
  --vsx-danger:  var(--vscode-errorForeground, #ef4444);

  /* ── Shadows (Light-mode friendly — negligible on dark) ─────────────── */
  --vsx-shadow-sm: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
  --vsx-shadow:    0 2px 8px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06);
  --vsx-shadow-lg: 0 4px 20px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06);

  /* ── Transition ─────────────────────────────────────────────────────── */
  --vsx-transition: 120ms ease;
}

/* ── Reset ───────────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  font-family: var(--vscode-font-family);
  font-size: 13px;
  line-height: 1.5;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}

/* ── Base elements ───────────────────────────────────────────────────────── */
button, input, select, textarea {
  font: inherit;
  letter-spacing: inherit;
  color: inherit;
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--vsx-gap-xs);
  cursor: pointer;
  height: 30px;
  padding: 0 14px;
  border: 1px solid var(--vsx-border);
  border-radius: var(--vsx-radius);
  background: var(--vsx-surface);
  color: var(--vscode-foreground);
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  transition: background-color var(--vsx-transition),
              border-color var(--vsx-transition),
              box-shadow var(--vsx-transition);
}
button:hover {
  background: var(--vsx-surface-hover);
  border-color: var(--vsx-border-strong);
}
button:active  { background: var(--vsx-surface-active); }
button:disabled { opacity: 0.4; cursor: default; pointer-events: none; }

button.primary {
  background: var(--vsx-accent);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 1px 3px rgba(99,102,241,0.3);
}
button.primary:hover {
  background: var(--vsx-accent-hover);
  box-shadow: 0 2px 8px rgba(99,102,241,0.4);
}
button.primary:active { background: #4338ca; box-shadow: none; }

button.ghost {
  background: transparent;
  border-color: transparent;
}
button.ghost:hover {
  background: var(--vsx-surface-hover);
  border-color: var(--vsx-border);
}

button.danger {
  background: transparent;
  border-color: transparent;
  color: var(--vsx-danger);
}
button.danger:hover {
  background: color-mix(in srgb, var(--vsx-danger), transparent 90%);
  border-color: color-mix(in srgb, var(--vsx-danger), transparent 75%);
}

/* ── Inputs ──────────────────────────────────────────────────────────────── */
input[type="text"],
input[type="number"],
input[type="password"],
input:not([type]),
select {
  height: 30px;
  padding: 0 10px;
  border-radius: var(--vsx-radius);
  background: var(--vscode-input-background, var(--vsx-surface));
  color: var(--vscode-input-foreground, var(--vscode-foreground));
  border: 1px solid var(--vsx-border);
  outline: none;
  transition: border-color var(--vsx-transition), box-shadow var(--vsx-transition);
}
input:focus, select:focus {
  border-color: var(--vsx-accent);
  box-shadow: 0 0 0 3px var(--vsx-accent-subtle);
}
input::placeholder { color: var(--vscode-descriptionForeground); opacity: 0.7; }

/* ── Section labels ──────────────────────────────────────────────────────── */
.section-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--vscode-descriptionForeground);
  margin-bottom: var(--vsx-gap-sm);
}

/* ── Typography helpers ──────────────────────────────────────────────────── */
.vsx-muted    { color: var(--vscode-descriptionForeground); }
.vsx-mono     { font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace); }
.vsx-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Cards ───────────────────────────────────────────────────────────────── */
.vsx-card {
  background: var(--vsx-surface);
  border: 1px solid var(--vsx-border);
  border-radius: var(--vsx-radius-lg);
  padding: var(--vsx-gap-md);
  box-shadow: var(--vsx-shadow-sm);
  transition: box-shadow var(--vsx-transition), border-color var(--vsx-transition);
}
.vsx-card:hover {
  box-shadow: var(--vsx-shadow);
  border-color: var(--vsx-border-strong);
}

/* ── Engine accent pill ──────────────────────────────────────────────────── */
.vsx-engine-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--vsx-gap-xs);
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

/* ── Divider ─────────────────────────────────────────────────────────────── */
.vsx-divider {
  height: 1px;
  background: var(--vsx-border);
  margin: var(--vsx-gap-md) 0;
}

/* ── Badge ───────────────────────────────────────────────────────────────── */
.vsx-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  background: var(--vsx-surface-2);
  border: 1px solid var(--vsx-border);
  color: var(--vscode-descriptionForeground);
}

/* ── Scrollbar ───────────────────────────────────────────────────────────── */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: var(--vscode-scrollbarSlider-background, rgba(128,128,128,0.2));
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--vscode-scrollbarSlider-hoverBackground, rgba(128,128,128,0.35));
  background-clip: content-box;
}

/* ── Focus ring ──────────────────────────────────────────────────────────── */
:focus-visible {
  outline: 2px solid var(--vsx-accent);
  outline-offset: 2px;
}
`;
}

// Engine -> CSS var name for the accent color.
export function engineAccentVar(engine: string): string {
  return `var(--vsx-accent-${engine})`;
}
