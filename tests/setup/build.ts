import { execSync } from "node:child_process";

// Side effect: this rebuilds dist/ AND overwrites custom_components/floorplan_studio/www/ (scripts/build.mjs copies the bundles and editor.html there).
// Always build: a stale dist/editor.html would let the standalone tests pass against old code.
export default function globalSetup() {
  execSync("node scripts/build.mjs", { stdio: "inherit" });
}
