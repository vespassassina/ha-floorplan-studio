const WATCH_MS = 30_000;
const EVERY_MS = 500;

/** Defines a custom element, and defines it again if the registry is replaced within 30 s.
 *
 * S8.3: the integration loads the card with `add_extra_js_url`, in parallel with HA's core. Core installs a
 * scoped-custom-element-registry polyfill that replaces `customElements`. When the card ran first (about half
 * of hard reloads), the element was defined only in the native registry, the polyfill's `get` returned
 * undefined, and the dashboard read "Custom element doesn't exist". Defining again on the new registry works,
 * and HA's own `whenDefined` then rebuilds the card.
 *
 * If another script (an older copy kept as a manual dashboard resource, say) already owns the name, the registry
 * keeps that one and this build is never used: the dashboard then shows the old card whatever is installed. Say so
 * once in the console, with this build's version, so the cause can be found without guessing. */
export function defineElement(name: string, ctor: CustomElementConstructor, version = "dev"): void {
  if (typeof window === "undefined" || !window.customElements) return;
  let warned = false;
  // eslint-disable-next-line prefer-const
  let id: ReturnType<typeof setInterval> | undefined;
  const define = () => {
    // The page can be gone before the watch ends (a test environment torn down, a frame detached): stop, do not throw.
    if (typeof window === "undefined") { clearInterval(id); return; }
    const reg = window.customElements;
    const owner = reg.get(name);
    if (owner) {
      if (owner !== ctor && !warned) {
        warned = true;
        console.warn(`Floorplan Studio ${version}: <${name}> is already defined by another script, so this one is not used. Remove the older copy under Settings > Dashboards > Resources (or from /local), then hard-refresh.`);
      }
      return;
    }
    try {
      reg.define(name, ctor);
    } catch (e) {
      console.warn(`Floorplan Studio: could not define <${name}>:`, e);
    }
  };
  define();
  id = setInterval(define, EVERY_MS);
  setTimeout(() => clearInterval(id), WATCH_MS);
}
