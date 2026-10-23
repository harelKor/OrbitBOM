import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { dhash, hashDistance, imageHash, pngGrey } from "./dhash";

// A bare RGBA PNG (CRCs left as zero; the reader doesn't check them).
function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  const chunk = (kind: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(kind, 4, "latin1");
    return Buffer.concat([head, body, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

describe("dhash", () => {
  const disc = (shift: number) => png(64, 48, (x, y) => ((x - 32 - shift) ** 2 + (y - 24) ** 2 < 300 ? [40, 60, 200, 255] : [0, 0, 0, 0]));
  it("reads a PNG, transparent as white", () => {
    const img = pngGrey(disc(0))!;
    expect(img.width).toBe(64);
    expect(img.grey[0]).toBe(255);
  });
  it("gives near hashes for near pictures and far ones for different pictures", () => {
    const a = imageHash(disc(0))!;
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(hashDistance(a, imageHash(disc(1))!)).toBeLessThanOrEqual(5);
    const bar = png(64, 48, (x) => (x % 16 < 8 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    expect(hashDistance(a, imageHash(bar)!)).toBeGreaterThan(10);
  });
  it("gives null for what isn't a PNG it reads", () => {
    expect(imageHash(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(dhash({ width: 1, height: 1, grey: new Float64Array([0]) })).toBe("0000000000000000");
  });
});
