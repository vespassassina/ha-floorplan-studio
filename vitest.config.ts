import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/core/**/*.test.ts", "tests/card/**/*.test.ts", "tests/editor/**/*.test.ts"],
    // See tests/setup-storage.ts: Node's own global localStorage shadows jsdom's working one on this Node version.
    setupFiles: ["tests/setup-storage.ts"],
  },
});
