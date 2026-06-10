import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    alias: { vscode: new URL("./test/vscode-mock.ts", import.meta.url).pathname },
  },
});
