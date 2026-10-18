import "server-only";
import { AwsClient } from "aws4fetch";

// Cloudflare R2 through its S3 API (plan §1). The browser uploads and downloads with short-lived
// presigned URLs, so files never pass through a Vercel function (4.5 MB body limit) and the
// keys stay on the server. R2_ENDPOINT overrides the endpoint for local S3 emulators.

function config() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT } = process.env;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !(R2_ENDPOINT || R2_ACCOUNT_ID)) return null;
  const endpoint = R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  return {
    client: new AwsClient({
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      service: "s3",
      region: "auto",
    }),
    base: `${endpoint.replace(/\/$/, "")}/${R2_BUCKET}`,
  };
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("File storage isn't set up yet (R2 settings are missing; see docs/setup.md).");
  }
}

function mustConfig() {
  const c = config();
  if (!c) throw new StorageNotConfiguredError();
  return c;
}

export const storageConfigured = () => config() !== null;

const objectUrl = (base: string, key: string) =>
  new URL(`${base}/${key.split("/").map(encodeURIComponent).join("/")}`);

async function presign(method: "GET" | "PUT", key: string, expiresSeconds: number, params: Record<string, string> = {}) {
  const { client, base } = mustConfig();
  const url = objectUrl(base, key);
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const signed = await client.sign(new Request(url, { method }), { aws: { signQuery: true } });
  return signed.url;
}

export const presignUpload = (key: string) => presign("PUT", key, 600);

// Image links that stay the same for six hours, so the browser can cache thumbnails between
// page loads. Signing is local (no network), so a page of 200 cards costs nothing.
const WINDOW_MS = 6 * 3600 * 1000;
export async function imageUrl(key: string) {
  const c = config();
  if (!c) return null;
  const start = new Date(Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS);
  const url = objectUrl(c.base, key);
  url.searchParams.set("X-Amz-Expires", String((2 * WINDOW_MS) / 1000));
  const signed = await c.client.sign(new Request(url), {
    aws: { signQuery: true, datetime: start.toISOString().replace(/[:-]|\.\d{3}/g, "") },
  });
  return signed.url;
}

export function presignDownload(key: string, filename: string, inline = true) {
  const safe = filename.replace(/["\\\r\n]/g, "_");
  return presign("GET", key, 300, {
    "response-content-disposition": `${inline ? "inline" : "attachment"}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
}

export async function objectExists(key: string) {
  const { client, base } = mustConfig();
  const res = await client.fetch(objectUrl(base, key), { method: "HEAD" });
  return res.ok;
}

export async function putObject(key: string, body: BodyInit, contentType: string) {
  const { client, base } = mustConfig();
  const res = await client.fetch(objectUrl(base, key), {
    method: "PUT",
    body,
    headers: { "content-type": contentType },
  });
  if (!res.ok) throw new Error(`R2 upload failed (${res.status})`);
}

export async function getObject(key: string) {
  const { client, base } = mustConfig();
  const res = await client.fetch(objectUrl(base, key));
  return res.ok ? res : null;
}

export async function deleteObject(key: string) {
  const c = config();
  if (!c) return;
  await c.client.fetch(objectUrl(c.base, key), { method: "DELETE" });
}

// "parts/<partId>/gcode/<random>-My_Part.gcode"
export function fileKey(prefix: string, filename: string) {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(-120) || "file";
  return `${prefix}/${crypto.randomUUID().slice(0, 8)}-${safe}`;
}
