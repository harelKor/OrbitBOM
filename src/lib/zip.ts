// A zip with no library (the inventory spreadsheet, batch DXFs, Factory Fab packs). Stored as is,
// or compressed when `deflate` is passed (node:zlib's deflateRawSync on the server).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_DATE = (1 << 5) | 1; // 1980-01-01; zero isn't a valid date

export function zip(files: [string, string | Uint8Array][], deflate?: (data: Uint8Array) => Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const path = enc.encode(name);
    const raw = typeof text === "string" ? enc.encode(text) : text;
    const crc = crc32(raw);
    const packed = deflate?.(raw);
    const compressed = !!packed && packed.length < raw.length;
    const data = compressed ? packed : raw;
    const method = compressed ? 8 : 0;
    const head = new Uint8Array(30 + path.length);
    const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // UTF-8 names
    h.setUint16(8, method, true);
    h.setUint16(12, DOS_DATE, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, raw.length, true);
    h.setUint16(26, path.length, true);
    head.set(path, 30);
    const dir = new Uint8Array(46 + path.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint16(10, method, true);
    d.setUint16(14, DOS_DATE, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, data.length, true);
    d.setUint32(24, raw.length, true);
    d.setUint16(28, path.length, true);
    d.setUint32(42, offset, true);
    dir.set(path, 46);
    local.push(head, data);
    central.push(dir);
    offset += head.length + data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const part of [...local, ...central, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
