import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// S5.8: scripts/validate-layout.mjs is what an assistant runs on its own answer before handing it over. It
// wraps validate() and adds the mistakes a model makes when tracing a drawing. Each test below is one of them.
const dir = mkdtempSync(join(tmpdir(), "fp-validate-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const flat = () => JSON.parse(readFileSync("prompts/examples/flat.json", "utf8"));
function run(layout: unknown, raw?: string) {
  const f = join(dir, `l-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, raw ?? JSON.stringify(layout));
  const r = spawnSync("node", ["scripts/validate-layout.mjs", f], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe("validate-layout CLI", () => {
  it.each(["prompts/examples/flat.json", "prompts/examples/two-floors.json", "demo/layout.json"])("%s prints ok and exits 0", (file) => {
    const r = spawnSync("node", ["scripts/validate-layout.mjs", file], { encoding: "utf8" });
    expect(r.stdout).toContain("ok");
    expect(r.status).toBe(0);
  });

  it("metres written as centimetres is caught, and says so", () => {
    const l = flat();
    const scale = (p: number[]) => [p[0] / 100, p[1] / 100];
    const g = l.floors.ground;
    g.outline = g.outline.map(scale);
    g.rooms.forEach((r: any) => (r.pts = r.pts.map(scale)));
    g.doors.forEach((d: any) => { d.a = scale(d.a); d.b = scale(d.b); });
    g.furniture = [];
    const r = run(l);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/metres/);
  });

  it("a room drawn outside the outline is caught by the CLI, not by the person", () => {
    const l = flat();
    l.floors.ground.rooms[1].pts = [[400, 0], [900, 0], [900, 400], [400, 400]];
    const r = run(l);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/room-ground-2.*outside the outline/);
  });

  it("an outdoor kind may sit outside the outline", () => {
    const l = flat();
    l.floors.ground.rooms.push({ id: "room-ground-3", name: "Garden", area: "", label: "", kind: "garden", pts: [[600, 0], [800, 0], [800, 400], [600, 400]], wk: ["boundary", "boundary", "boundary", "boundary"] });
    expect(run(l).code).toBe(0);
  });

  it("a door floating off every wall is caught", () => {
    const l = flat();
    l.floors.ground.doors[0].a = [100, 250];
    l.floors.ground.doors[0].b = [190, 250]; // inside the living room, 150 cm from the nearest wall
    const r = run(l);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/door-ground-1.*not on a wall/);
  });

  it("the JSON wrapped in a code fence gets the fence named as the cause", () => {
    const r = run(null, "```json\n" + JSON.stringify(flat()) + "\n```");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/fence/);
  });

  it("devices in the answer draw a warning, not a failure", () => {
    const l = flat();
    l.floors.ground.devices.push({ id: "light-1", type: "light", entity: "light.invented", x: 100, y: 100 });
    const r = run(l);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/warning:.*devices/);
  });

  // S7.16: the script migrates before it validates, as the editor and the card do, so a v1 file or a floor
  // without `unlinked` now opens instead of failing; the error here is one migrate cannot repair.
  it("a plain schema error still fails, once per problem", () => {
    const l = flat();
    (l as { north: unknown }).north = "north";
    const r = run(l);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/north must be a number/);
  });

  it("S7.16: a floor saved before `unlinked` existed passes, filled in by migrate", () => {
    const l = flat();
    for (const f of Object.values(l.floors)) delete (f as { unlinked?: unknown }).unlinked;
    const r = run(l);
    expect(r.code).toBe(0);
  });

  it("S7.16: a plan migrate itself refuses fails with its reason", () => {
    const r = run({ ...flat(), version: 7 });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Unknown layout version 7/);
  });

  it("no argument is a usage error, exit 2", () => {
    const r = spawnSync("node", ["scripts/validate-layout.mjs"], { encoding: "utf8" });
    expect(r.status).toBe(2);
  });
});
