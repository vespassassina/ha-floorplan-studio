// node scripts/validate-layout.mjs <file>
//
// Checks a layout.json the way the editor would, plus the mistakes a model makes when it traces a drawing:
// metres written as centimetres, a room drawn outside the outline, a door floating in the air. Prints "ok" or
// one line per problem and exits 1 on any error. Warnings are printed but do not fail.
//
// It wraps the same validate() the editor and the card use, so there is nothing to keep in step: it bundles
// src/core in memory on every run and imports the result.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/validate-layout.mjs <layout.json>");
  process.exit(2);
}

let raw;
try {
  raw = readFileSync(file, "utf8");
} catch (e) {
  console.error(`cannot read ${file}: ${e.message}`);
  process.exit(2);
}
let json;
try {
  json = JSON.parse(raw);
} catch (e) {
  // A model wrapping its answer in a code fence is the commonest cause. Say so.
  console.error(`${file} is not valid JSON: ${e.message}. Is there text or a \`\`\` fence around it? The file must be the JSON object and nothing else.`);
  process.exit(1);
}

const out = await build({
  stdin: {
    contents: `export { validate } from "./schema"; export { migrate } from "./migrate"; export { polys, nearestEdge, dist } from "./geometry";`,
    resolveDir: resolve("src/core"),
    loader: "ts",
  },
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
});
const core = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

// S7.16: migrate first, as the editor and the card do. A plan saved before a field existed (`unlinked`, say) is
// filled in there, not refused here; a plan migrate itself refuses is reported with its reason.
let res;
try {
  res = core.validate(core.migrate(json));
} catch (e) {
  res = { ok: false, errors: [e.message] };
}
const errors = res.ok ? [] : [...res.errors];
const warnings = [];

if (res.ok) {
  const inPoly = (p, poly) => {
    // ray casting; a point within 2 cm of an edge counts as inside, so a room that shares the outline's wall passes
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      if (core.dist(p, [a[0] + t * dx, a[1] + t * dy]) <= 2) return true;
    }
    return false;
  };
  for (const [id, f] of Object.entries(res.layout.floors)) {
    const at = `floor ${id}:`;
    const xs = f.outline.map((p) => p[0]), ys = f.outline.map((p) => p[1]);
    const longest = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    // Units are centimetres. A house is 500 to 5000 cm on its long side. Outside 300 to 10000 it is almost surely a unit slip.
    if (longest < 300) errors.push(`${at} the outline is only ${longest} cm on its long side. Units are centimetres: did you write metres? A 6 m wall is 600.`);
    else if (longest > 10000) errors.push(`${at} the outline is ${longest} cm (${longest / 100} m) on its long side. Did you write millimetres? A 6 m wall is 600.`);
    for (const r of f.rooms) {
      // Gardens, pavement, terraces, water and zones may sit outside the house. A room or a structure may not.
      if (r.kind !== "room" && r.kind !== "structure") continue;
      const out_ = r.pts.filter((p) => !inPoly(p, f.outline));
      if (out_.length) errors.push(`${at} ${r.id} (${r.name || "unnamed"}) has ${out_.length} corner(s) outside the outline, first at [${out_[0]}]. Move it inside, or make it kind "terrace" or "garden" if it is outdoors.`);
    }
    for (const d of f.doors) {
      const ends = [d.a, d.b].map((p) => core.nearestEdge(f, p, 15, { walls: true }));
      const bad = ends.findIndex((e) => !e);
      if (bad >= 0) errors.push(`${at} ${d.id} (${d.name || d.kind}) end ${bad ? "b" : "a"} at [${(bad ? d.b : d.a)}] is not on a wall (nothing within 15 cm). A door or window sits on an edge of a room, the outline or a free wall.`);
    }
    if (!f.rooms.length) warnings.push(`${at} no rooms. The editor opens, but nothing can be attached to a room or an area.`);
  }
  if (Object.keys(res.layout.floors).length === 0) errors.push("floors is empty: at least one floor is needed");
  if (res.layout.catalog.length || Object.values(res.layout.floors).some((f) => f.devices.length))
    warnings.push("devices or catalog are not empty. A drawing has no entities in it: leave both empty and let the owner attach real ones in the editor.");
}

for (const w of warnings) console.log(`warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.log(e);
  console.log(`\n${errors.length} problem(s) in ${file}. Fix them and run this again until it prints ok.`);
  process.exit(1);
}
console.log("ok");
