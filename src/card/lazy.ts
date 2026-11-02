/** A chunk of the card that loads on first use (B52.2). */
export interface Lazy<T> {
  /** The module once loaded, else null. */
  get(): T | null;
  /** Loads it. A failed load is not remembered: asking again is the retry. */
  load(): Promise<T>;
}

const asBrowserImport = <T>(url: string): Promise<T> => import(/* @vite-ignore */ url); // not `new URL(.., import.meta.url)`: Vite reads that as an asset and rewrites it

/**
 * `plain` is the build-time `import()`; `file` is the placeholder the build replaces with the chunk's hashed name (vite.config.ts), and
 * `prefix` the chunk's name in it. Unbuilt (vitest, dev) `file` stays a placeholder and every try is the plain import.
 *
 * A browser remembers a failed `import()` of one URL and never asks the network again. So the first try is the plain import and each
 * later one asks for the same file under a new query, which is a new URL to the browser and the same file to the server. Two callers who
 * ask while a try is on its way share it: they must not count as a retry. `fetchModule` is the browser's import, a seam for the tests.
 */
export function lazy<T>(plain: () => Promise<T>, file: string, prefix: string, fetchModule: (url: string) => Promise<T> = asBrowserImport): Lazy<T> {
  let lib: T | null = null, flight: Promise<T> | null = null, tries = 0;
  return {
    get: () => lib,
    load() {
      if (lib) return Promise.resolve(lib);
      if (!flight) {
        const n = tries++;
        const base = import.meta.url.split(/[?#]/)[0].replace(/[^/]*$/, "");
        flight = (n > 0 && new RegExp(`^floorplan-studio-${prefix}-.+\\.js$`).test(file) ? fetchModule(`${base}${file}?r=${n}`) : plain())
          .then((m) => (lib = m), (err) => { flight = null; throw err; });
      }
      return flight;
    },
  };
}
