import { execSync } from "node:child_process";

// Always build: a stale dist/editor.html would let the standalone tests pass against old code.
export default function globalSetup() {
  execSync("node scripts/build.mjs", { stdio: "inherit" });
}
