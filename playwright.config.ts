import { defineConfig } from "@playwright/test";

export default defineConfig({
  // Builds dist/ first: the standalone tests open dist/editor.html from file://.
  globalSetup: "./tests/setup/build.ts",
  testDir: "tests/editor",
  testMatch: "**/*.spec.ts",
  use: { baseURL: "http://localhost:5173" },
  // The dev root has no index.html, so wait on the editor page itself.
  webServer: { command: "npm run dev -- --port 5173 --strictPort", url: "http://localhost:5173/standalone.html", reuseExistingServer: true },
});
