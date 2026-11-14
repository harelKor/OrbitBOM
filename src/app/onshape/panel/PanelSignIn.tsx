"use client";

import { useState } from "react";

// Google won't load inside Onshape's iframe, so sign-in happens in a popup: the panel gets a
// one-time code, the popup approves it, and the panel polls until the code turns into its cookie.
export function PanelSignIn() {
  const [state, setState] = useState<"idle" | "waiting" | "expired">("idle");
  const [refused, setRefused] = useState<string | null>(null);

  async function signIn() {
    const popup = window.open("about:blank", "orbitbom-signin", "width=480,height=640");
    const { code, error } = (await (await fetch("/api/panel/login", { method: "POST" })).json().catch(() => ({}))) as { code?: string; error?: string };
    if (!code) {
      popup?.close();
      setRefused(error ?? "Sign-in isn't answering. Try again in a minute.");
      return setState("expired");
    }
    setRefused(null);
    const url = `/onshape/connect?code=${encodeURIComponent(code)}`;
    if (popup) popup.location.href = url;
    else window.open(url, "_blank");
    setState("waiting");
    const poll = setInterval(async () => {
      const res = await (await fetch(`/api/panel/login?code=${encodeURIComponent(code)}`)).json();
      if (res.state === "waiting") return;
      clearInterval(poll);
      if (res.state === "signed-in") window.location.reload();
      else setState("expired");
    }, 2000);
  }

  return (
    <div className="space-y-3">
      <h1 className="text-base font-semibold">OrbitParts</h1>
      <p className="text-muted">Sign in with your team Google account to see this assembly&apos;s BOM.</p>
      <button className="btn-primary w-full" onClick={signIn} disabled={state === "waiting"}>
        {state === "waiting" ? "Finish signing in in the popup…" : "Sign in"}
      </button>
      {state === "expired" && <p className="text-rose-700">{refused ?? "The sign-in timed out. Try again."}</p>}
    </div>
  );
}
