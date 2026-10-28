"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/Dialog";

// Scan a barcode or SKU off a vendor bag with the camera; the code goes into the add box, which
// searches the shelf and the stores with it. The reader loads only when the camera opens.
export function ScanButton({ onCode }: { onCode: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn min-h-12 shrink-0 self-start" title="Scan a barcode or SKU with the camera">
        <span aria-hidden>▥</span> Scan
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Scan a barcode">
        {open && (
          <Scanner
            onCode={(code) => {
              setOpen(false);
              onCode(code);
            }}
          />
        )}
      </Dialog>
    </>
  );
}

function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onCode);
  useEffect(() => {
    done.current = onCode;
  });
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled || !video.current) return;
        const controls = await new BrowserMultiFormatReader().decodeFromConstraints({ video: { facingMode: "environment" } }, video.current, (result, _err, c) => {
          if (!result) return;
          c.stop();
          done.current(result.getText());
        });
        if (cancelled) controls.stop();
        else stop = () => controls.stop();
      } catch {
        setError("Couldn't open the camera. Allow camera access for this site, or type the code.");
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return (
    <div className="space-y-2">
      <video ref={video} className="aspect-[4/3] w-full rounded-lg bg-black object-cover" muted playsInline />
      <p className="text-sm text-muted">{error ?? "Hold the barcode inside the frame."}</p>
    </div>
  );
}
