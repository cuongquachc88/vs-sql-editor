import esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const common = { bundle: true, sourcemap: !production, minify: production, logLevel: "info" };

const host = {
  ...common,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  // Keep node deps external so WASM-backed libs (pglite, sql.js) load from
  // node_modules with their asset resolution intact, and the ESM-only pglite
  // can be reached via a runtime dynamic import(). They ship inside the .vsix.
  packages: "external",
  external: ["vscode"],
};

const web = {
  ...common,
  entryPoints: ["src/results/webview/main.ts"],
  outfile: "dist/webview.js",
  platform: "browser",
  format: "iife",
};

const form = {
  ...common,
  entryPoints: ["src/connections/form/webview/main.ts"],
  outfile: "dist/connection-form.js",
  platform: "browser",
  format: "iife",
};

const sidebar = {
  ...common,
  entryPoints: ["src/connections/sidebar/webview/main.ts"],
  outfile: "dist/connections-sidebar.js",
  platform: "browser",
  format: "iife",
};

const welcome = {
  ...common,
  entryPoints: ["src/welcome/webview/main.ts"],
  outfile: "dist/welcome.js",
  platform: "browser",
  format: "iife",
};

const erd = {
  ...common,
  entryPoints: ["src/erd/webview/main.ts"],
  outfile: "dist/erd.js",
  platform: "browser",
  format: "iife",
};

const importView = {
  ...common,
  entryPoints: ["src/import/webview/main.ts"],
  outfile: "dist/import.js",
  platform: "browser",
  format: "iife",
};

// Notebook output renderer — must be an ES module that exports `activate`.
const notebookRenderer = {
  ...common,
  entryPoints: ["src/notebook/renderer/main.ts"],
  outfile: "dist/sqlnb-renderer.js",
  platform: "browser",
  format: "esm",
};

const tableDesigner = {
  ...common,
  entryPoints: ["src/table-designer/webview/main.ts"],
  outfile: "dist/table-designer.js",
  platform: "browser",
  format: "iife",
};

const all = [host, web, form, sidebar, welcome, erd, importView, notebookRenderer, tableDesigner];

if (watch) {
  const ctxs = await Promise.all(all.map((c) => esbuild.context(c)));
  await Promise.all(ctxs.map((c) => c.watch()));
} else {
  for (const c of all) await esbuild.build(c);
}
