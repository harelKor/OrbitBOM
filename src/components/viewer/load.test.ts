import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { placementsBox, refitNeeded } from "./load";
import { staleKeys } from "./meshCache";

const at = (x: number, y: number, z: number, g?: number) => ({ s: 0, k: "a:b:c", t: [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1], g });

describe("placementsBox", () => {
  it("spans the placements' origins, padded, leaving hidden subsystems out", () => {
    const box = placementsBox([at(0, 0, 0, 0), at(1, 0, 0, 0), at(0, 1, 0, 0), at(9, 9, 9, 1)], new Set([1]))!;
    expect(box.min.x).toBeLessThan(0);
    expect(box.max.x).toBeGreaterThan(1);
    expect(box.max.z).toBeGreaterThan(0);
    expect(box.max.x).toBeLessThan(2);
  });

  it("gives up on parts all placed at one spot (Part Studios drawn in place)", () => {
    expect(placementsBox([at(0, 0, 0), at(0, 0, 0), at(0.01, 0, 0)])).toBeNull();
    expect(placementsBox([])).toBeNull();
  });
});

describe("refitNeeded", () => {
  const box = (cx: number, size: number) => new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(cx, 0, 0), new THREE.Vector3(size, size, size));
  it("keeps a close guess and frames again when it was well off", () => {
    expect(refitNeeded(box(0, 1), box(0.05, 1.1))).toBe(false);
    expect(refitNeeded(box(0, 1), box(0, 2))).toBe(true);
    expect(refitNeeded(box(0, 1), box(0.6, 1))).toBe(true);
    expect(refitNeeded(box(0, 1), new THREE.Box3())).toBe(false);
  });
});

describe("staleKeys", () => {
  const now = 1000;
  it("drops other revisions of a Part Studio this model uses once they sit unused for two days", () => {
    const cached = [
      { key: "models/studios/D/E/new.bin.gz", used: now },
      { key: "models/studios/D/E/old.bin.gz", used: now - 3 },
      { key: "models/studios/D/E/yesterday.bin.gz", used: now - 1 },
      { key: "models/studios/D/F/other-robot.bin.gz", used: now - 10 },
      { key: "models/studios/X/Y/forgotten.bin.gz", used: now - 31 },
    ];
    expect(staleKeys(cached, ["models/studios/D/E/new.bin.gz"], now)).toEqual(["models/studios/D/E/old.bin.gz", "models/studios/X/Y/forgotten.bin.gz"]);
  });

  it("never drops a file the model uses, however old", () => {
    expect(staleKeys([{ key: "a/b", used: 0 }], ["a/b"], now)).toEqual([]);
  });
});
