// The scan photo as the phone sends it: base64 JPEG (with or without its data: prefix), under
// ~1.5 MB. Null for anything else.
export function readScanPhoto(raw: unknown): string | null {
  const image = typeof raw === "string" ? raw.replace(/^data:image\/jpeg;base64,/, "") : "";
  return image && image.length <= 2_000_000 && /^[A-Za-z0-9+/=]+$/.test(image) ? image : null;
}
