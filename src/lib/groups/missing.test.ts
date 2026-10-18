import { expect, it } from "vitest";
import { analyseMissing } from "./missing";

const t = new Date("2026-10-18T10:00:00Z");
const m = (partId: string, name: string, removed: Date | null) => ({
  partId,
  name,
  systemId: "s",
  systemName: "Drive",
  removedFromCadAt: removed,
});

it("explains and re-links re-keyed members", () => {
  const members = [m("a", "Belt 45T", t), m("b", "Belt 45T", t), m("c", "Spacer", t)];
  const live = [
    { id: "x", name: "belt 45t", systemId: "s" },
    { id: "y", name: "Belt 45T", systemId: "s" },
    { id: "z", name: "Spacer", systemId: "other" },
  ];
  const r = analyseMissing(members, live, new Set(["a", "b", "c"]));
  expect(r.missing.map((x) => [x.partId, x.reason, x.liveMatches, x.recoverTo])).toEqual([
    ["a", "rekeyed", 2, "x"],
    ["b", "rekeyed", 2, "y"],
    ["c", "removed", 0, null],
  ]);
  expect(r.allAtOnce).toBe(true);
  expect(r.recoverable).toBe(2);
});

it("ignores present members and doesn't re-link to a part already in the group", () => {
  const r = analyseMissing([m("a", "Plate", null), m("b", "Plate", new Date())], [{ id: "a", name: "Plate", systemId: "s" }], new Set(["a", "b"]));
  expect(r.missing).toHaveLength(1);
  expect(r.missing[0].recoverTo).toBeNull();
  expect(r.allAtOnce).toBe(false);
});
