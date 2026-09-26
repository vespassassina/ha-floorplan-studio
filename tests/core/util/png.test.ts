// Round-trips the PNG decoder (tests/util/png.ts) against a hand-encoded PNG, so the Playwright pixel test that
// relies on it (S8.11) is not trusting an unverified decoder. This test must fail with the decoder removed or
// broken: it pins exact, asymmetric colours at each of four pixels, not a single uniform fill.
import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { decodePng, pixelAt } from "./png";

function crc32(buf: Buffer): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}

/** A hand-built 2x2 RGBA PNG: red, green / blue, and a half-transparent white, so no two pixels share a channel. */
function makeTestPng(): Buffer {
  const width = 2, height = 2, channels = 4;
  const pixels = [
    [255, 0, 0, 255], [0, 255, 0, 255],
    [0, 0, 255, 255], [255, 255, 255, 128],
  ];
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type "None"
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixels[y * width + x];
      const o = y * (stride + 1) + 1 + x * channels;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // compression, filter, interlace
  const idat = deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("PNG decoder (test infrastructure for S8.11's pixel test)", () => {
  it("decodes a hand-built 2x2 RGBA PNG back to its exact, asymmetric pixel values", () => {
    const png = decodePng(makeTestPng());
    expect(png.width).toBe(2);
    expect(png.height).toBe(2);
    expect(png.channels).toBe(4);
    expect(pixelAt(png, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(png, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(png, 0, 1)).toEqual([0, 0, 255, 255]);
    expect(pixelAt(png, 1, 1)).toEqual([255, 255, 255, 128]);
  });

  it("throws when asked for a pixel outside the image", () => {
    const png = decodePng(makeTestPng());
    expect(() => pixelAt(png, 2, 0)).toThrow();
    expect(() => pixelAt(png, 0, -1)).toThrow();
  });
});
