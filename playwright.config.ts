import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/editor",
  testMatch: "**/*.spec.ts",
  use: { baseURL: "http://localhost:5173" },
  webServer: { command: "npm run dev -- --port 5173", url: "http://localhost:5173", reuseExistingServer: true },
});
