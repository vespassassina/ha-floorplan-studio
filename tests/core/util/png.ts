// A minimal, dependency-free PNG reader for Playwright pixel tests (S8.11: a mask's cut is a paint-time
// compositing effect, invisible to getComputedStyle — CLAUDE.md finding 10 — so proving it needs a real
// screenshot's actual pixels). Only decodes what Chromium's page.screenshot() ever produces: 8-bit depth,
// colour type 2 (RGB) or 6 (RGBA), filter method 0, no interlace. Uses only Node's built-in zlib.
import { inflateSync } from "node:zlib";

export interface DecodedPng {
  width: number;
  height: number;
  channels: number; // 3 (RGB) or 4 (RGBA)
  data: Buffer; // raw, unfiltered, one byte per channel per pixel, row-major
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decodes a PNG buffer (as returned by page.screenshot()) into raw RGB(A) pixel data. */
export function decodePng(buf: Buffer): DecodedPng {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat: Buffer[] = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      const interlace = data.readUInt8(12);
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
      if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported colour type ${colorType}`);
      if (interlace !== 0) throw new Error("interlaced PNG not supported");
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 8 + len + 4; // length + type + data + crc
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let rawOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rawOffset++];
    const rowStart = y * stride;
    const prevRowStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[rawOffset++];
      const a = x >= channels ? out[rowStart + x - channels] : 0;
      const b = y > 0 ? out[prevRowStart + x] : 0;
      const c = y > 0 && x >= channels ? out[prevRowStart + x - channels] : 0;
      let val: number;
      switch (filter) {
        case 0: val = v; break;
        case 1: val = v + a; break;
        case 2: val = v + b; break;
        case 3: val = v + Math.floor((a + b) / 2); break;
        case 4: val = v + paeth(a, b, c); break;
        default: throw new Error(`unsupported filter type ${filter}`);
      }
      out[rowStart + x] = val & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/** The [r, g, b, a] at (x, y) (a is 255 when the PNG has no alpha channel). Coordinates are truncated to integers. */
export function pixelAt(png: DecodedPng, x: number, y: number): [number, number, number, number] {
  const px = Math.trunc(x), py = Math.trunc(y);
  if (px < 0 || py < 0 || px >= png.width || py >= png.height) throw new Error(`(${px}, ${py}) is outside the ${png.width}x${png.height} image`);
  const i = (py * png.width + px) * png.channels;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.channels === 4 ? png.data[i + 3] : 255];
}
