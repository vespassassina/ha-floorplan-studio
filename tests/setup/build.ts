import { execSync } from "node:child_process";

// Side effect: this rebuilds dist/ AND overwrites custom_components/floorplan_studio/www/ (scripts/build.mjs copies the bundles and editor.html there).
// FP_TEST_BUILD=1 also builds dist-test/, the card with the 3D test hook, for the specs that drive it.
// Always build: a stale dist/editor.html would let the standalone tests pass against old code.
export default function globalSetup() {
  execSync("node scripts/build.mjs", { stdio: "inherit", env: { ...process.env, FP_TEST_BUILD: "1" } });
}
