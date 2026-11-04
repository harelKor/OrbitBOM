import { deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { zip } from "./zip";

// Reads the first entry's header back: method, sizes and the data.
function firstEntry(out: Uint8Array) {
  const v = new DataView(out.buffer, out.byteOffset);
  const method = v.getUint16(8, true);
  const packed = v.getUint32(18, true);
  const size = v.getUint32(22, true);
  const nameLen = v.getUint16(26, true);
  const data = out.subarray(30 + nameLen, 30 + nameLen + packed);
  return { method, packed, size, data };
}

describe("zip", () => {
  it("stores text as is without deflate", () => {
    const e = firstEntry(zip([["a.txt", "hello"]]));
    expect(e.method).toBe(0);
    expect(new TextDecoder().decode(e.data)).toBe("hello");
  });

  it("compresses binary files with deflate", () => {
    const bytes = new Uint8Array(5000).fill(7);
    const e = firstEntry(zip([["part.x_t", bytes]], (d) => deflateRawSync(d)));
    expect(e.method).toBe(8);
    expect(e.packed).toBeLessThan(e.size);
    expect(e.size).toBe(5000);
    expect(new Uint8Array(inflateRawSync(e.data))).toEqual(bytes);
  });

});
