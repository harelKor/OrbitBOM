"use client";

import { useEffect, useState } from "react";
import { toast } from "@/components/ui/Toaster";

// Starts the service worker (public/sw.js: the app's code kept on the device, a saved copy of each
// page for offline) and shows a bar while the app is offline or showing a saved copy (Harel,
// 2026-11-13). Production only: in `next dev` a worker would keep serving old code. Not inside the
// Onshape panel's frame, which is another site's page.
export function OfflineSupport() {
  const [online, setOnline] = useState(true);
  // When this page is a saved copy the service worker served: the time it was saved.
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || window.top !== window || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    const worker = navigator.serviceWorker.controller;
    if (!worker) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = (e: MessageEvent<{ savedAt: number | null }>) => {
      if (e.data.savedAt) setSavedAt(e.data.savedAt);
    };
    worker.postMessage({ type: "saved-at", url: location.href }, [channel.port2]);
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    // A save made offline fails inside whichever component started it; say why, once, here.
    const failed = () => {
      if (!navigator.onLine) toast("You're offline: that wasn't saved.", true);
    };
    window.addEventListener("unhandledrejection", failed);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("unhandledrejection", failed);
    };
  }, []);

  if (online && !savedAt) return null;
  const at = savedAt ? new Date(savedAt) : null;
  const when = at ? (at.toDateString() === new Date().toDateString() ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : at.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) : null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-0 z-[60] flex items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-center text-sm font-medium text-black pb-[max(0.375rem,env(safe-area-inset-bottom))]">
      <span>
        {!online ? "Offline" : "Back online"}
        {when ? ` · showing this page as it was at ${when}` : " · changes won't save"}
      </span>
      {online && savedAt && (
        <button type="button" onClick={() => location.reload()} className="min-h-7 rounded-md bg-black/80 px-3 text-white active:scale-[0.98] pointer-coarse:min-h-9">
          Reload
        </button>
      )}
    </div>
  );
}
