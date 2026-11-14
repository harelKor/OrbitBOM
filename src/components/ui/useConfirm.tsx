"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/Dialog";

const CONFIRM_EVENT = "orbit:confirm";

export type ConfirmOptions = {
  title: string;
  body?: React.ReactNode;
  confirm?: string; // the yes button's word: "Delete", "Revert"…
  cancel?: string;
  danger?: boolean; // a red yes button, for something that removes or overwrites
};

type Ask = ConfirmOptions & { answer: (yes: boolean) => void };

let hosted = false;

// Asks in an Orbit window instead of the browser's confirm() (which is tiny on a phone, can't be
// themed and can be switched off by the browser). Resolves true for yes. Without the app's shell
// (the Onshape panel, sign-in pages) it falls back to the browser's own box.
export function askConfirm(options: ConfirmOptions | string): Promise<boolean> {
  const o = typeof options === "string" ? { title: options } : options;
  if (!hosted) return Promise.resolve(window.confirm(o.body && typeof o.body === "string" ? `${o.title}\n\n${o.body}` : o.title));
  return new Promise((answer) => window.dispatchEvent(new CustomEvent<Ask>(CONFIRM_EVENT, { detail: { ...o, answer } })));
}

export function useConfirm() {
  return askConfirm;
}

// One per app (Shell): shows each question as it comes.
export function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    hosted = true;
    const on = (e: Event) => {
      const next = (e as CustomEvent<Ask>).detail;
      // A second question while one is open: the first is answered no.
      setAsk((prev) => {
        prev?.answer(false);
        return next;
      });
    };
    window.addEventListener(CONFIRM_EVENT, on);
    return () => {
      hosted = false;
      window.removeEventListener(CONFIRM_EVENT, on);
    };
  }, []);
  useEffect(() => {
    // The yes button takes the focus, so Enter answers on a keyboard; on touch the window keeps it.
    if (ask && !matchMedia("(pointer: coarse)").matches) yes.current?.focus();
  }, [ask]);
  const done = (answer: boolean) => {
    ask?.answer(answer);
    setAsk(null);
  };
  return (
    <Dialog open={!!ask} onClose={() => done(false)} title={ask?.title ?? ""}>
      {ask?.body && <div className="text-sm text-fg-2">{ask.body}</div>}
      <div className={`flex justify-end gap-2 ${ask?.body ? "mt-5" : ""}`}>
        <button type="button" className="btn min-h-10" onClick={() => done(false)}>
          {ask?.cancel ?? "Cancel"}
        </button>
        <button ref={yes} type="button" className={`${ask?.danger ? "btn-danger" : "btn-primary"} min-h-10`} onClick={() => done(true)}>
          {ask?.confirm ?? "OK"}
        </button>
      </div>
    </Dialog>
  );
}
