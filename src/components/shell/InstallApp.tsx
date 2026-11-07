"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { Icon } from "@/components/ui/Icon";

// What Chrome (Android and PC) and Edge hand a page that can be installed (not in the DOM's own types).
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

// Chrome fires this once, as soon as the app can be installed, maybe before the side panel is on
// screen: kept here so the button can use it whenever it's pressed.
let saved: InstallPrompt | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    saved = e as InstallPrompt;
  });
  window.addEventListener("appinstalled", () => (saved = null));
}

const installed = () =>
  matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: window-controls-overlay)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const phone = () => matchMedia("(pointer: coarse)").matches;
const iPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1);

// In the side panel's empty space above Members (Harel, 2026-11-06; PCs too since 2026-11-07): puts
// OrbitParts on the home screen, or on a PC in its own window, as an app. Chrome and Edge open their
// own install prompt; an iPhone has no such prompt (Safari only adds to the home screen from Share),
// so it shows those steps, and any other browser that gave no prompt shows its own. Hidden once the
// app runs installed.
export function InstallApp() {
  const [show, setShow] = useState(false);
  const [help, setHelp] = useState<"ios" | "android" | "pc" | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only: is it installed already?
    setShow(!installed());
  }, []);
  if (!show) return null;
  const install = async () => {
    if (saved) {
      await saved.prompt();
      const { outcome } = await saved.userChoice;
      saved = null;
      if (outcome === "accepted") setShow(false);
      return;
    }
    setHelp(iPhone() ? "ios" : phone() ? "android" : "pc");
  };
  return (
    <div className="px-2 pb-2 @max-[10rem]:hidden">
      <button
        type="button"
        onClick={() => void install()}
        className="press flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-accent/50 bg-accent/10 px-3 py-2 text-sm font-semibold text-accent hover:bg-accent/15 active:scale-[0.98]"
      >
        <Icon name="download" className="h-4 w-4 shrink-0" />
        Install app
      </button>
      <Dialog open={!!help} onClose={() => setHelp(null)} title="Install OrbitParts">
        <div className="space-y-3 text-sm">
          {help === "ios" ? (
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Open this page in <span className="font-semibold">Safari</span> (or Chrome).
              </li>
              <li>
                Tap <span className="font-semibold">Share</span> <ShareIcon /> at the bottom of the screen (in Chrome, at the top).
              </li>
              <li>
                Scroll down and tap <span className="font-semibold">Add to Home Screen</span>, then <span className="font-semibold">Add</span>.
              </li>
            </ol>
          ) : help === "pc" ? (
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Open this page in <span className="font-semibold">Chrome</span> or <span className="font-semibold">Edge</span>.
              </li>
              <li>
                Click the install icon at the right end of the address bar, or open the menu <span className="font-semibold">⋮</span> /{" "}
                <span className="font-semibold">…</span> → <span className="font-semibold">Cast, save and share</span> (Chrome) or{" "}
                <span className="font-semibold">Apps</span> (Edge) → <span className="font-semibold">Install OrbitParts</span>.
              </li>
            </ol>
          ) : (
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Open the browser&apos;s menu <span className="font-semibold">⋮</span> (top right in Chrome).
              </li>
              <li>
                Tap <span className="font-semibold">Install app</span> or <span className="font-semibold">Add to Home screen</span>, then <span className="font-semibold">Install</span>.
              </li>
            </ol>
          )}
          {/* An iPhone's home screen app keeps its own sign-in, apart from Safari's. */}
          <p className="text-muted">OrbitParts then opens from its own icon{help === "pc" ? ", in its own window" : ", full screen"}.{help === "ios" && " Sign in once more the first time you open it."}</p>
          <div className="flex justify-end">
            <button type="button" className="btn-primary min-h-10 active:scale-[0.98]" onClick={() => setHelp(null)}>
              Got it
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// The iPhone's Share symbol: a box with an arrow up out of it.
function ShareIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-label="Share" className="inline h-4 w-4 -translate-y-0.5 stroke-current" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2.5v10M6.5 6 10 2.5 13.5 6M6 9H4.5v8.5h11V9H14" />
    </svg>
  );
}
