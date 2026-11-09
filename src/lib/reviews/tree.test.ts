import { describe, expect, it } from "vitest";
import { buildTree } from "./tree";

const v = (id: string, createdAt: string) => ({ id, name: id.toUpperCase(), createdAt });

describe("CAD Review version tree", () => {
  it("puts comments under the version current when they were added and ticked off", () => {
    const tree = buildTree(
      [v("v1", "2026-11-01T00:00:00Z"), v("v2", "2026-11-03T00:00:00Z"), v("v3", "2026-11-05T00:00:00Z")],
      [{ id: "b1", label: "V2", at: "2026-11-04T00:00:00Z", by: "Noa", vid: "v2", current: true }],
      [
        { id: "early", createdAt: "2026-10-30T00:00:00Z", doneAt: null, doneVersionId: null, state: "open" },
        { id: "c1", createdAt: "2026-11-02T00:00:00Z", doneAt: "2026-11-06T00:00:00Z", doneVersionId: "b1", state: "done" },
        { id: "c2", createdAt: "2026-11-03T12:00:00Z", doneAt: "2026-11-05T12:00:00Z", doneVersionId: null, state: "approved" },
      ],
    );
    expect(tree.map((n) => n.key)).toEqual(["v3", "v2", "v1"]);
    const [v3, v2, v1] = tree;
    expect(v1.added).toEqual(["early", "c1"]);
    expect(v2.added).toEqual(["c2"]);
    // Ticked in the Update system window: at the committed version, whenever that was.
    expect(v2.done).toEqual(["c1"]);
    // Ticked by itself: the version current then.
    expect(v3.done).toEqual(["c2"]);
    expect(v2.bom).toEqual([{ id: "b1", label: "V2", current: true }]);
    expect(v3.bom).toEqual([]);
  });

  it("puts a panel comment on its Onshape version and marks versions newer than the BOM", () => {
    const tree = buildTree(
      [v("v1", "2026-11-01T00:00:00Z"), v("v2", "2026-11-03T00:00:00Z"), v("v3", "2026-11-05T00:00:00Z")],
      [{ id: "b1", label: "V1", at: "2026-11-02T00:00:00Z", by: null, vid: "v1", current: true }],
      [
        // Written in the panel on V3 before anyone looked at the tree: still on V3, not V1.
        { id: "on3", createdAt: "2026-11-01T12:00:00Z", doneAt: null, doneVersionId: null, state: "open", onshapeVersionId: "v3", onshapeVersionName: "V3" },
        // Its version isn't in the kept list yet: a node of its own, on top.
        { id: "on4", createdAt: "2026-11-06T00:00:00Z", doneAt: null, doneVersionId: null, state: "open", onshapeVersionId: "v4", onshapeVersionName: "V4" },
        { id: "site", createdAt: "2026-11-04T00:00:00Z", doneAt: null, doneVersionId: null, state: "open" },
      ],
    );
    expect(tree.map((n) => [n.key, n.ahead])).toEqual([
      ["v4", true],
      ["v3", true],
      ["v2", true],
      ["v1", false],
    ]);
    expect(tree[0].name).toBe("V4");
    expect(tree[0].added).toEqual(["on4"]);
    expect(tree[1].added).toEqual(["on3"]);
    expect(tree[2].added).toEqual(["site"]);
  });

  it("uses the BOM versions when no Onshape list is kept", () => {
    const tree = buildTree(
      null,
      [
        { id: "b1", label: "#1", at: "2026-11-01T00:00:00Z", by: null, vid: null, current: false },
        { id: "b2", label: "#2", at: "2026-11-02T00:00:00Z", by: null, vid: null, current: true },
      ],
      [{ id: "c", createdAt: "2026-11-02T10:00:00Z", doneAt: null, doneVersionId: null, state: "open" }],
    );
    expect(tree.map((n) => n.name)).toEqual(["#2", "#1"]);
    expect(tree[0].added).toEqual(["c"]);
    expect(tree[0].bom[0].current).toBe(true);
  });
});
