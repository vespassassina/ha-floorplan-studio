// The scene builder bound to the real core helpers: what the tests and any non-card caller use. The card's lazy 3D chunk
// holds `scene-build.ts` and is handed the same helpers (three-deps.ts), so this file is not in the card's bundle.
import { sceneDeps } from "./three-deps";
import { makeBuildScene } from "./scene-build";
export * from "./scene-build";
export const buildScene = makeBuildScene(sceneDeps);
