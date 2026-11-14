// A Content-Disposition header for a download: an ASCII-only filename="…" for old browsers and
// RFC 5987's filename*=UTF-8''… with the real name. Quotes, backslashes, control characters and
// line breaks can't get into the header, so a part number can't add headers of its own.
export function contentDisposition(filename: string, inline = false): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\%]/g, "_").trim() || "download";
  const clean = filename.replace(/[\x00-\x1f\x7f]/g, "_");
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
