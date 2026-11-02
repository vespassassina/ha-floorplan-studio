// The card's source for a page that cannot fetch its chunks. Tests and screenshot scripts inject the built card with
// `addScriptTag({ content, type: "module" })`: an inline module has the page's URL, not the card's, so its
// `import("./floorplan-studio-overview-<hash>.js")` points at nothing. The chunk imports nothing (tests/card/size-budget.spec.ts holds it
// to that), so its own text can stand in the import as a data: URL.
import { readFileSync } from "node:fs";

/** `dir`/floorplan-studio-card.js, each `import("./floorplan-studio-overview-<hash>.js")` pointing at the chunk's own text. */
export function cardSource(dir = "dist") {
  return readFileSync(`${dir}/floorplan-studio-card.js`, "utf8").replace(
    /"\.\/(floorplan-studio-overview-[\w-]+\.js)"/g,
    (_all, file) => JSON.stringify(`data:text/javascript;base64,${readFileSync(`${dir}/${file}`).toString("base64")}`),
  );
}
