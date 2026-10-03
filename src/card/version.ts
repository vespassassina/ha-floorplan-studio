/** The integration's version, stamped in at build time from manifest.json (vite.config.ts), so the card can say
 * which build a dashboard is really running. "dev" in the tests and the dev server. */
declare const __FP_VERSION__: string | undefined;
export const CARD_VERSION: string = typeof __FP_VERSION__ === "string" ? __FP_VERSION__ : "dev";
