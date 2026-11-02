import type { Page } from "@playwright/test";

// S41.c: the machine's speed, shared by every Playwright ceiling that must hold on a CI runner 3 to 6x slower than the Mac (plan-incremental, replay-gate).
/**
 * The machine's speed, in ms: median of 5 builds of a fixed 2,000-group SVG string set as innerHTML and laid out. None of
 * our code runs in it, so a renderFloor slowdown moves the plan's time and not this one.
 */
export async function calibrate(page: Page) {
  return page.evaluate(() => {
    const host = document.createElement("div");
    document.body.append(host);
    const xs: number[] = [];
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      let s = '<svg xmlns="http://www.w3.org/2000/svg">';
      for (let i = 0; i < 2000; i++) s += `<g data-x="${i}" transform="translate(${(i % 50) * 10},${Math.floor(i / 50) * 10})"><circle r="4" fill="#${((i * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, "0")}"/><text>${i}</text></g>`;
      host.innerHTML = s + "</svg>";
      host.firstElementChild!.getBoundingClientRect();
      xs.push(performance.now() - t0);
    }
    host.remove();
    return xs.sort((a, b) => a - b)[2]!;
  });
}
