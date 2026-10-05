// Build-time trim of three.js for the card's 3D chunk (docs/DECISIONS.md, S12.6). WebGLRenderer constructs a WebXR manager, an
// environment-map (PMREM) cache and a shadow-map renderer whatever the scene holds, so the bundler keeps them and about 20 KB
// gzipped of code the card never runs: no headset, no environment texture, no shadow-casting light. Each patch swaps the
// construction for an inert stand-in; the classes then have no user and the bundler drops them.
// A patch must match exactly once or the build fails, so a three.js upgrade that moves a line is a loud error here and not a
// silent size regression (or a changed renderer). The browser tests (tests/card/card-3d*.spec.ts) render through the result.
const PATCHES = [
  {
    why: "no WebXR: the renderer asks its xr object a handful of questions, all answered 'not presenting'",
    from: "const xr = new WebXRManager( _this, _gl );",
    to: "const xr = new NoXR();",
  },
  {
    why: "no environment maps (scene.environment, envMap, PMREM): get() answers null",
    from: "environments = new WebGLEnvironments( _this );",
    to: "environments = NO_ENVIRONMENTS;",
  },
  {
    why: "no shadows: no light of ours casts one, and `render` is never needed",
    from: "shadowMap = new WebGLShadowMap( _this, objects, capabilities );",
    to: "shadowMap = new NoShadowMap();",
  },
];
const STANDINS = `
class NoXR extends EventDispatcher {
	constructor() { super(); this.enabled = false; this.isPresenting = false; this.cameraAutoUpdate = false; }
	dispose() {}
	setAnimationLoop() {}
	hasDepthSensing() { return false; }
	getDepthSensingMesh() { return null; }
	getEnvironmentBlendMode() { return undefined; } // WebGLBackground asks; with no session the real one answers undefined too
	getCamera() { return null; }
	updateCamera() {}
}
const NO_ENVIRONMENTS = { get() { return null; }, dispose() {} };
class NoShadowMap { constructor() { this.enabled = false; this.autoUpdate = false; this.needsUpdate = false; this.type = 1; } render() {} }
`;

export function trimThree() {
  return {
    name: "fp-trim-three",
    enforce: "pre",
    transform(code, id) {
      if (!/node_modules\/three\/build\/three\.module\.js$/.test(id.split("?")[0])) return null;
      let out = code;
      for (const p of PATCHES) {
        const n = out.split(p.from).length - 1;
        if (n !== 1) throw new Error(`trim-three: expected one match for "${p.from}" (${p.why}), found ${n}. three.js changed: update scripts/trim-three.mjs.`);
        out = out.replace(p.from, p.to);
      }
      return { code: out + STANDINS, map: null };
    },
  };
}
