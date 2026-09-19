import { defineConfig } from "@playwright/test";

// FP_PORT lets a second checkout run its own dev server beside another one.
const port = Number(process.env.FP_PORT ?? 5173);

export default defineConfig({
  // Builds dist/ first: the standalone tests open dist/editor.html from file://.
  globalSetup: "./tests/setup/build.ts",
  testDir: "tests/editor",
  testMatch: "**/*.spec.ts",
  use: { baseURL: `http://localhost:${port}` },
  // The dev root has no index.html, so wait on the editor page itself.
  webServer: { command: `npm run dev -- --port ${port} --strictPort`, url: `http://localhost:${port}/standalone.html`, reuseExistingServer: true },
});
