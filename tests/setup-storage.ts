// Node 22+ ships its own global `localStorage`/`sessionStorage` (behind `--localstorage-file`, unset here, so
// reading either throws or returns undefined). Vitest's jsdom environment does not override a global that
// already exists on `globalThis` unless it is one vitest patches itself (see `getWindowKeys` in vitest's own
// source: `k in global` short-circuits to "leave it alone" before jsdom's own working version is ever offered).
// So on this Node/vitest pairing every test that touched `localStorage` failed with "Cannot read properties of
// undefined (reading 'clear')" — not a bug in this repo's code, a version-skew gap between the two. This setup
// file runs once the jsdom environment is installed (`globalThis.jsdom` is jsdom's own global hook) and points
// `localStorage`/`sessionStorage` at jsdom's real, working implementation instead of Node's inert one.
const dom = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom;
if (dom) {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => dom.window.localStorage });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: () => dom.window.sessionStorage });
}
