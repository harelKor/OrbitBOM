"use client";

import { useState, useTransition } from "react";
import { Dialog } from "@/components/Dialog";
import { addItemToBom } from "@/app/(app)/inventory/actions";
import type { BomTarget, Item } from "./types";

// "Add to a BOM" (ref §5, screenshot 12).
export function ToBomDialog({ item, targets, onClose }: { item: Item | null; targets: BomTarget[]; onClose: () => void }) {
  const [robotId, setRobotId] = useState(targets[0]?.id ?? "");
  const robot = targets.find((r) => r.id === robotId);
  const [systemId, setSystemId] = useState(robot?.systems[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={!!item} onClose={onClose} title="Add to a BOM">
      {item && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const r = await addItemToBom(item.id, systemId, quantity);
              setResult(r);
            });
          }}
        >
          <p className="text-sm text-muted">
            Put <span className="text-fg">{item.name}</span> on a system&apos;s BOM as an ordinary part. Its stock
            is allocated to the new part automatically.
          </p>
          {targets.length === 0 ? (
            <p className="text-sm text-amber-700">Create a robot with a system first.</p>
          ) : (
            <>
              <div>
                <label className="label" htmlFor="bom-robot">
                  Robot
                </label>
                <select
                  id="bom-robot"
                  value={robotId}
                  onChange={(e) => {
                    setRobotId(e.target.value);
                    setSystemId(targets.find((r) => r.id === e.target.value)?.systems[0]?.id ?? "");
                  }}
                  className="input"
                >
                  {targets.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="bom-system">
                  System
                </label>
                <select id="bom-system" value={systemId} onChange={(e) => setSystemId(e.target.value)} className="input">
                  {robot?.systems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="bom-qty">
                  Quantity
                </label>
                <input
                  id="bom-qty"
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="input"
                />
              </div>
            </>
          )}
          {result?.error && <p className="text-sm text-rose-700">{result.error}</p>}
          {result?.message && <p className="text-sm text-emerald-700">{result.message}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={onClose}>
              {result?.message ? "Close" : "Cancel"}
            </button>
            <button className="btn-primary" disabled={pending || !systemId}>
              {pending ? "Adding…" : "Add to BOM"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
