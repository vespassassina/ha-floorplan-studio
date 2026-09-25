const WATCH_MS = 30_000;
const EVERY_MS = 500;

/** Defines a custom element, and defines it again if the registry is replaced within 30 s.
 *
 * S8.3: the integration loads the card with `add_extra_js_url`, in parallel with HA's core. Core installs a
 * scoped-custom-element-registry polyfill that replaces `customElements`. When the card ran first (about half
 * of hard reloads), the element was defined only in the native registry, the polyfill's `get` returned
 * undefined, and the dashboard read "Custom element doesn't exist". Defining again on the new registry works,
 * and HA's own `whenDefined` then rebuilds the card. */
export function defineElement(name: string, ctor: CustomElementConstructor): void {
  if (typeof window === "undefined" || !window.customElements) return;
  const define = () => {
    const reg = window.customElements;
    if (reg.get(name)) return;
    try {
      reg.define(name, ctor);
    } catch (e) {
      console.warn(`Floorplan Studio: could not define <${name}>:`, e);
    }
  };
  define();
  const id = setInterval(define, EVERY_MS);
  setTimeout(() => clearInterval(id), WATCH_MS);
}
