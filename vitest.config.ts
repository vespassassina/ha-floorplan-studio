import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "jsdom", include: ["tests/core/**/*.test.ts", "tests/card/**/*.test.ts", "tests/editor/**/*.test.ts"] },
});
