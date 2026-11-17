import { describe, expect, it } from "vitest";
import { diffVersions, OLD } from "./versionDiff";

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const at = (x: number) => [1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe("diffVersions", () => {
  it("finds added, removed, moved, recounted and reshaped parts; leaves the rest", () => {
    const model = {
      keys: ["f1", "f2", "f3"],
      placements: [
        { s: 0, k: "d:e:same", t: I },
        { s: 0, k: `${OLD}d:e:same`, t: I },
        { s: 0, k: "d:e:moved", t: at(0.01) },
        { s: 0, k: `${OLD}d:e:moved`, t: I },
        { s: 0, k: "d:e:two", t: I },
        { s: 0, k: "d:e:two", t: at(1) },
        { s: 0, k: `${OLD}d:e:two`, t: I },
        { s: 1, k: "d:e:shape", t: I },
        { s: 2, k: `${OLD}d:e:shape`, t: I },
        { s: 1, k: "d:e:kept", t: I },
        { s: 2, k: `${OLD}d:e:kept`, t: I },
        { s: 1, k: "d:e:new", t: I },
        { s: 2, k: `${OLD}d:e:gone`, t: I },
      ],
    };
    const sig = (k: string) => (k === "d:e:shape" ? "B" : "A");
    const list = diffVersions(model, { "d:e:new": "New plate" }, sig);
    const by = new Map(list.map((c) => [c.key, c]));
    expect([...by.keys()].sort()).toEqual(["d:e:gone", "d:e:moved", "d:e:new", "d:e:shape", "d:e:two"]);
    expect(by.get("d:e:new")).toMatchObject({ change: "added", name: "New plate", after: { file: "f2" } });
    expect(by.get("d:e:gone")).toMatchObject({ change: "removed", before: { file: "f3", k: `${OLD}d:e:gone` } });
    expect(by.get("d:e:moved")).toMatchObject({ change: "modified", geometry: false, moved: true });
    expect(by.get("d:e:two")).toMatchObject({ change: "modified", count: { from: 1, to: 2 } });
    expect(by.get("d:e:shape")).toMatchObject({ change: "modified", geometry: true });
  });

  it("marks a file change it can't compare as a shape change", () => {
    const model = { keys: ["f1", "f2"], placements: [{ s: 0, k: "a:b:c", t: I }, { s: 1, k: `${OLD}a:b:c`, t: I }] };
    expect(diffVersions(model, {})).toMatchObject([{ change: "modified", geometry: true, note: "Shape not compared" }]);
  });
});
