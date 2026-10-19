import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// AES-256-GCM for secrets at rest (Onshape tokens). ONSHAPE_TOKEN_KEY is ideally 32 random
// bytes, base64-encoded (`openssl rand -base64 32`). Any other long random string also works:
// it is hashed into a 32-byte key.
function key(): Buffer {
  const raw = process.env.ONSHAPE_TOKEN_KEY?.trim() ?? "";
  if (raw.length < 32) throw new Error("ONSHAPE_TOKEN_KEY must be a random string of at least 32 characters.");
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : createHash("sha256").update(raw).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(sealed: string): string {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
