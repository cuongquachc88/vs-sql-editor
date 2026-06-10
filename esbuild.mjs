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

if (watch) {
  const c1 = await esbuild.context(host);
  const c2 = await esbuild.context(web);
  await Promise.all([c1.watch(), c2.watch()]);
} else {
  await esbuild.build(host);
  await esbuild.build(web);
}
