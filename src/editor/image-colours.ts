import { MAX_PALETTE } from "./scene-colour";

// S17.6: the colours of a picture, in the browser, no network. `dominantColours` is pure (RGBA bytes in, #rrggbb out) and uses a
// fixed seed, so the same picture always gives the same scene. `readImageColours` is the thin canvas wrapper around it.

const MAX_SAMPLE = 4096;
const ITERATIONS = 12;
const SEED = 20261007;

/** A 32-bit linear congruential generator: small, fixed, the same in every browser. */
const lcg = (seed: number) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; }; };
const hex = (c: number[]) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

/**
 * Up to `k` (at most 6) dominant colours of `data` (RGBA bytes, as `getImageData` gives them), biggest cluster first, ties by hex.
 * Pixels that are mostly transparent are skipped. Fewer colours than asked when the picture holds fewer. Never throws.
 */
export function dominantColours(data: ArrayLike<number>, k: number): string[] {
  const want = Math.min(MAX_PALETTE, Math.floor(k));
  if (!(want > 0)) return [];
  const all: number[][] = [];
  for (let i = 0; i + 3 < data.length; i += 4) if (data[i + 3] >= 128) all.push([data[i], data[i + 1], data[i + 2]]);
  if (!all.length) return [];
  const step = Math.max(1, Math.ceil(all.length / MAX_SAMPLE));
  const pts = all.filter((_, i) => i % step === 0);
  const distinct = new Set(pts.map((p) => p.join())).size;
  const n = Math.min(want, distinct);
  const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // Seeds: one pixel picked by the fixed generator, then each next the pixel farthest from the seeds so far (first one wins a tie).
  const centres = [[...pts[lcg(SEED)() % pts.length]]];
  while (centres.length < n) {
    let best = -1, far = -1;
    pts.forEach((p, i) => { const d = Math.min(...centres.map((c) => d2(p, c))); if (d > far) { far = d; best = i; } });
    centres.push([...pts[best]]);
  }
  let size: number[] = new Array(n).fill(0);
  for (let it = 0; it < ITERATIONS; it++) {
    const sum = centres.map(() => [0, 0, 0]);
    size = new Array(n).fill(0);
    for (const p of pts) {
      let b = 0, bd = Infinity;
      centres.forEach((c, j) => { const d = d2(p, c); if (d < bd) { bd = d; b = j; } });
      size[b]++; sum[b][0] += p[0]; sum[b][1] += p[1]; sum[b][2] += p[2];
    }
    sum.forEach((s, j) => { if (size[j]) centres[j] = [s[0] / size[j], s[1] / size[j], s[2] / size[j]]; });
  }
  const out = centres.map((c, j) => ({ h: hex(c), n: size[j] })).filter((c) => c.n > 0);
  out.sort((a, b) => b.n - a.n || (a.h < b.h ? -1 : 1));
  return [...new Set(out.map((c) => c.h))];
}

const SIDE = 64;
/** Reads an image file into a small canvas and returns its dominant colours. Rejects with a sentence the user can read. */
export async function readImageColours(file: File, k: number): Promise<string[]> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name || "That file"} is not a picture. Choose a PNG, JPEG, GIF, WebP or SVG image.`);
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { throw new Error(`${file.name || "That file"} could not be read as a picture.`); }
  try {
    const cv = document.createElement("canvas");
    const scale = Math.min(1, SIDE / Math.max(bmp.width, bmp.height));
    cv.width = Math.max(1, Math.round(bmp.width * scale)); cv.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = cv.getContext("2d");
    if (!ctx) throw new Error("This browser cannot read picture colours.");
    ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    const cols = dominantColours(ctx.getImageData(0, 0, cv.width, cv.height).data, k);
    if (!cols.length) throw new Error("The picture has no visible colour.");
    return cols;
  } finally { bmp.close(); }
}
