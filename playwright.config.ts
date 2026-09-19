import { defineConfig } from "@playwright/test";

// PW_PORT lets parallel worktrees run side by side; without it, nothing changes.
const port = Number(process.env.PW_PORT ?? 5173);

export default defineConfig({
  // Side effect: globalSetup rebuilds dist/ and custom_components/floorplan_studio/www/ (see tests/setup/build.ts).
  // Builds dist/ first: the standalone tests open dist/editor.html from file://.
  globalSetup: "./tests/setup/build.ts",
  testDir: "tests/editor",
  testMatch: "**/*.spec.ts",
  use: { baseURL: `http://localhost:${port}` },
  // The dev root has no index.html, so wait on the editor page itself.
  webServer: { command: `npm run dev -- --port ${port} --strictPort`, url: `http://localhost:${port}/standalone.html`, reuseExistingServer: !process.env.PW_PORT },
});
