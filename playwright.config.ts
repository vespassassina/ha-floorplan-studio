import { defineConfig } from "@playwright/test";

// PW_PORT lets parallel worktrees run side by side. The default is not 5173, the port every other vite
// picks first: a stranger's server there must never be mistaken for ours. We bind 127.0.0.1 only and
// never reuse a running server, so the tests always run against the code in this tree.
const port = Number(process.env.PW_PORT ?? 5273);
const host = "127.0.0.1";

export default defineConfig({
  // Side effect: globalSetup rebuilds dist/ and custom_components/floorplan_studio/www/ (see tests/setup/build.ts).
  // Builds dist/ first: the standalone tests open dist/editor.html from file://.
  globalSetup: "./tests/setup/build.ts",
  testDir: "tests/editor",
  testMatch: "**/*.spec.ts",
  use: { baseURL: `http://${host}:${port}` },
  // The dev root has no index.html, so wait on the editor page itself.
  webServer: { command: `npm run dev -- --host ${host} --port ${port} --strictPort`, url: `http://${host}:${port}/standalone.html`, reuseExistingServer: false },
});
