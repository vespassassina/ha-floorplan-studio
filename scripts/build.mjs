// Builds card, panel and the standalone editor into dist/, then names the editor file.
import { build } from "vite";
import { existsSync, renameSync, rmSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";

const editorEntry = "src/editor/standalone.html";
if (!existsSync(editorEntry)) {
  console.error(`Missing ${editorEntry}. The standalone editor cannot be built without it.`);
  process.exit(1);
}
rmSync("dist", { recursive: true, force: true });
for (const mode of ["card", "panel", "editor"]) await build({ configFile: "vite.config.ts", mode, logLevel: "warn" });
renameSync("dist/standalone.html", "dist/editor.html");

// The integration serves these files from its www/ folder.
const www = "custom_components/floorplan_studio/www";
mkdirSync(www, { recursive: true });
// The card's 3D chunk has a content hash in its name (floorplan-studio-3d-<hash>.js), so a rebuild leaves the old one
// behind: clear them first, or the zip would ship every chunk ever built.
for (const f of readdirSync(www).filter((n) => /^floorplan-studio-3d-.*\.js$/.test(n))) rmSync(`${www}/${f}`);
for (const f of readdirSync("dist").filter((n) => n.endsWith(".js") || n === "editor.html")) copyFileSync(`dist/${f}`, `${www}/${f}`);
console.log("dist/: floorplan-studio-card.js, floorplan-studio-3d-<hash>.js, floorplan-studio-panel.js, editor.html");
