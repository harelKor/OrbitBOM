"use client";

import { toast } from "@/components/ui/Toaster";

// A part's CAD export (/api/parts/<id>/export), checked before the browser downloads it: when
// Onshape can't make the file, its reason shows as a toast instead of a bare error page.
// Returns where to download it from, or null after showing the error.
export async function prepareExport(url: string): Promise<{ href: string; filename?: string } | null> {
  let res: Response;
  try {
    // A ready export answers with a redirect to storage; don't follow it here (another origin).
    res = await fetch(url, { redirect: "manual" });
  } catch {
    toast("Couldn't reach OrbitBOM. Check your connection and try again.", true);
    return null;
  }
  // The file is stored now, so downloading the same link again only signs the storage link.
  if (res.type === "opaqueredirect") return { href: url };
  if (!res.ok) {
    // The route's own reasons are plain text; anything else (a crash page) gets a short message.
    const reason = res.headers.get("content-type")?.startsWith("text/plain") ? (await res.text()).trim() : "";
    toast(reason || `Download failed (${res.status}). Try again.`, true);
    return null;
  }
  // No storage: the file came in this response.
  const href = URL.createObjectURL(await res.blob());
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
  return { href, filename: /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "part" };
}

export async function downloadExport(url: string) {
  const file = await prepareExport(url);
  if (!file) return;
  const a = document.createElement("a");
  a.href = file.href;
  if (file.filename) a.download = file.filename;
  a.click();
}
