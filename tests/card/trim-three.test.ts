import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { trimThree } from "../../scripts/trim-three.mjs";

// scripts/trim-three.mjs swaps three.js's WebXR, environment-map and shadow-map construction for inert stand-ins, so the bundler drops
// those classes (about 15 KB gzipped). It must fail loudly when three.js moves a line, never skip a patch in silence.
const THREE = "/x/node_modules/three/build/three.module.js";
const real = readFileSync("node_modules/three/build/three.module.js", "utf8");
const run = (code: string, id = THREE) => (trimThree() as unknown as { transform(c: string, id: string): { code: string } | null }).transform(code, id);

describe("trim-three", () => {
  it("replaces the three constructions in the real three.module.js and adds the stand-ins", () => {
    const out = run(real)!.code;
    for (const gone of ["new WebXRManager( _this, _gl )", "new WebGLEnvironments( _this )", "new WebGLShadowMap( _this, objects, capabilities )"]) expect(out).not.toContain(gone);
    for (const kept of ["new NoXR()", "NO_ENVIRONMENTS", "new NoShadowMap()", "class NoXR extends EventDispatcher"]) expect(out).toContain(kept);
  });
  it("throws when an anchor is missing, naming it", () => {
    expect(() => run(real.replace("const xr = new WebXRManager( _this, _gl );", "const xr = makeXR();"))).toThrow(/new WebXRManager/);
  });
  it("throws when an anchor appears twice", () => {
    expect(() => run(real + "\nconst xr = new WebXRManager( _this, _gl );")).toThrow(/found 2/);
  });
  it("leaves every other file alone", () => {
    expect(run("const a = 1;", "/x/src/card/view3d.ts")).toBeNull();
    expect(run(real, "/x/node_modules/three/build/three.core.js")).toBeNull();
  });
});
