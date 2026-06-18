// Shared CSS injected into every webview panel's HTML <style> block.
// Single source of truth for the design tokens — change here, all surfaces
// (results, form, sidebar, welcome) update in lockstep.
export function getDesignTokensCss(): string {
  return `
:root {
  /* Spacing */
  --vsx-gap-xs: 4px;
  --vsx-gap-sm: 6px;
  --vsx-gap: 10px;
  --vsx-gap-md: 14px;
  --vsx-gap-lg: 18px;
  --vsx-gap-xl: 24px;

  /* Radii */
  --vsx-radius-sm: 4px;
  --vsx-radius: 6px;
  --vsx-radius-lg: 10px;

  /* Surfaces — layer above the editor background */
  --vsx-surface: color-mix(in srgb, var(--vscode-editor-background), var(--vscode-foreground) 4%);
  --vsx-surface-hover: color-mix(in srgb, var(--vscode-editor-background), var(--vscode-foreground) 8%);
  --vsx-surface-active: color-mix(in srgb, var(--vscode-editor-background), var(--vscode-foreground) 12%);
  --vsx-border: color-mix(in srgb, var(--vscode-foreground), transparent 88%);
  --vsx-border-strong: color-mix(in srgb, var(--vscode-foreground), transparent 78%);

  /* Engine accents */
  --vsx-accent-postgres: #336791;
  --vsx-accent-mysql: #00758F;
  --vsx-accent-sqlite: #003B57;
  --vsx-accent-pglite: #5C8AB8;
  --vsx-accent-clickhouse: #FFCC00;

  /* Status */
  --vsx-success: var(--vscode-testing-iconPassed, #2ea043);
  --vsx-warning: var(--vscode-notificationsWarningIcon-foreground, #d29922);
  --vsx-danger: var(--vscode-errorForeground, #f48771);
}

* { box-sizing: border-box; }

html, body {
  font-family: var(--vscode-font-family);
  font-size: 13px;
  line-height: 1.45;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  margin: 0;
  padding: 0;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
}

button, input, select {
  font: inherit;
  letter-spacing: inherit;
  color: inherit;
}

button {
  cursor: pointer;
  height: 28px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--vsx-radius);
  background: var(--vsx-surface);
  color: var(--vscode-foreground);
  transition: background-color 100ms;
}
button:hover { background: var(--vsx-surface-hover); }
button:active { background: var(--vsx-surface-active); }
button:disabled { opacity: 0.45; cursor: default; }

button.primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
button.primary:hover { background: var(--vscode-button-hoverBackground); }

button.ghost {
  background: transparent;
}
button.ghost:hover { background: var(--vsx-surface-hover); }

button.danger {
  background: transparent;
  color: var(--vsx-danger);
}
button.danger:hover { background: color-mix(in srgb, var(--vsx-danger), transparent 88%); }

input[type="text"], input[type="number"], input[type="password"], input:not([type]), select {
  height: 28px;
  padding: 0 8px;
  border-radius: var(--vsx-radius);
  background: var(--vscode-input-background, var(--vsx-surface));
  color: var(--vscode-input-foreground, var(--vscode-foreground));
  border: 1px solid var(--vsx-border);
  outline: none;
}
input:focus, select:focus {
  border-color: var(--vscode-focusBorder, var(--vsx-border-strong));
}

/* Typography helpers */
.vsx-muted { color: var(--vscode-descriptionForeground); }
.vsx-mono { font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace); }
.vsx-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Card surface (used by form engine picker, sidebar, welcome) */
.vsx-card {
  background: var(--vsx-surface);
  border: 1px solid var(--vsx-border);
  border-radius: var(--vsx-radius-lg);
  padding: var(--vsx-gap-md);
}

/* Engine accent pill (used in headers like "Add PostgreSQL Connection") */
.vsx-engine-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--vsx-gap-xs);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.vsx-divider { height: 1px; background: var(--vsx-border); margin: var(--vsx-gap) 0; }

/* Scrollbar polish — matches VS Code's defaults */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb {
  background: var(--vscode-scrollbarSlider-background, transparent);
  border-radius: 999px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--vscode-scrollbarSlider-hoverBackground, var(--vsx-border-strong));
}
`;
}

// Engine -> CSS var name for the accent color.
export function engineAccentVar(engine: string): string {
  return `var(--vsx-accent-${engine})`;
}
