"use client";

import { useState, useTransition } from "react";
import { Notice } from "@/components/ui/Notice";
import { askConfirm } from "@/components/ui/useConfirm";
import { createMcpTokenAction, revokeMcpToken } from "./actions";
import { toast } from "@/components/ui/Toaster";
import { safeAction } from "@/lib/safeAction";

type Token = { id: string; label: string | null; createdAt: Date; lastUsedAt: Date | null };

// "Use OrbitParts from Claude" (plan §6): a personal connector link, shown once.
export function McpTokens({ tokens, origin }: { tokens: Token[]; origin: string }) {
  const [label, setLabel] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3 text-sm">
      {link ? (
        <Notice tone="success" className="space-y-2">
          <p>
            Your connector link. Copy it now: it won&apos;t be shown again, and anyone with it can edit the BOM as you.
          </p>
          <div className="flex gap-2">
            <input readOnly value={link} className="input font-mono text-xs" onFocus={(e) => e.target.select()} />
            <button
              className="btn"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <ol className="list-decimal space-y-0.5 pl-5 text-fg-2">
            <li>In Claude (web or desktop), open Settings → Connectors → Add custom connector.</li>
            <li>Name it OrbitParts and paste the link as the URL. Leave the OAuth fields empty.</li>
            <li>In a chat, turn on OrbitParts from the tools menu and ask, for example: &ldquo;Which parts in Drivetrain still have no machine?&rdquo;</li>
          </ol>
        </Notice>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const r = await safeAction((): Promise<{ token?: string; error?: string }> => createMcpTokenAction(label));
              if (r.error || !r.token) return toast(r.error ?? "Couldn't make the link. Try again.", true);
              const token = r.token;
              setLink(`${origin}/api/mcp/${token}`);
              setLabel("");
              setCopied(false);
            });
          }}
        >
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label, e.g. My laptop" className="input max-w-xs" />
          <button className="btn-primary" disabled={pending}>
            Create connector link
          </button>
        </form>
      )}
      {tokens.length > 0 && (
        <ul className="divide-y divide-line">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <span className="flex-1">{t.label ?? "Connector link"}</span>
              <span className="text-xs text-subtle">
                made {t.createdAt.toISOString().slice(0, 10)}
                {t.lastUsedAt ? ` · last used ${t.lastUsedAt.toISOString().slice(0, 10)}` : " · never used"}
              </span>
              <button
                className="text-xs text-rose-700 hover:text-rose-700"
                onClick={async () => {
                  if (await askConfirm({ title: "Revoke this link?", body: "Claude stops working with it at once.", confirm: "Revoke", danger: true })) startTransition(async () => {
                      const r = await safeAction(async (): Promise<{ error?: string }> => { await revokeMcpToken(t.id); return {}; });
                      if (r.error) toast(r.error, true);
                    });
                }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
