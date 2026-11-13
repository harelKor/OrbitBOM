import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { clipPlanes, cubeMatrix, fitPose, keyCommand, lookFrom, orbitDir } from "./camera";

const key = (code: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; key: string }> = {}) =>
  keyCommand({ code, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe("keyCommand", () => {
  it("maps Onshape's view keys by key position", () => {
    expect(key("KeyF")).toEqual({ kind: "fit" });
    expect(key("Digit1", { shiftKey: true, key: "!" })).toEqual({ kind: "view", name: "front" });
    expect(key("Digit5", { shiftKey: true })).toEqual({ kind: "view", name: "top" });
    expect(key("Digit7", { shiftKey: true })).toEqual({ kind: "view", name: "iso" });
    expect(key("ArrowLeft")).toEqual({ kind: "orbit", right: -15, up: 0 });
    expect(key("ArrowUp", { shiftKey: true })).toEqual({ kind: "orbit", right: 0, up: 90 });
    expect(key("Slash", { shiftKey: true, key: "." })).toEqual({ kind: "help" });
  });

  it("turns 5° with Ctrl, moves with Ctrl+Shift and zooms with Z like Onshape", () => {
    expect(key("ArrowRight", { ctrlKey: true })).toEqual({ kind: "orbit", right: 5, up: 0 });
    expect(key("ArrowDown", { ctrlKey: true, shiftKey: true })).toEqual({ kind: "pan", right: 0, up: -1 });
    expect(key("KeyZ")).toEqual({ kind: "zoom", by: 1.25 });
    expect(key("KeyZ", { shiftKey: true })).toEqual({ kind: "zoom", by: 0.8 });
    expect(key("KeyZ", { ctrlKey: true })).toBeNull(); // undo
  });

  it("leaves other keys and browser shortcuts alone", () => {
    expect(key("Digit1")).toBeNull();
    expect(key("Digit8", { shiftKey: true })).toBeNull();
    expect(key("KeyF", { ctrlKey: true })).toBeNull();
    expect(key("ArrowLeft", { altKey: true })).toBeNull();
    expect(key("KeyY")).toBeNull();
  });
});

describe("orbitDir", () => {
  it("turns right about the vertical and up towards the top, stopping short of the pole", () => {
    const right = orbitDir(new THREE.Vector3(0, 0, 1), 90, 0);
    expect(right.x).toBeCloseTo(1);
    expect(right.z).toBeCloseTo(0);
    const up = orbitDir(new THREE.Vector3(0, 0, 1), 0, 90);
    expect(up.y).toBeCloseTo(1, 4);
    expect(up.y).toBeLessThan(1);
    const over = orbitDir(up, 0, 90);
    expect(over.y).toBeCloseTo(up.y, 6);
  });
});

describe("lookFrom", () => {
  it("looks back along the direction with the scene's up on top, even straight down", () => {
    const back = new THREE.Vector3(0, 0, 1);
    for (const d of [new THREE.Vector3(1, 1, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)]) {
      const q = lookFrom(d);
      const seen = back.clone().applyQuaternion(q);
      expect(seen.dot(d.clone().normalize())).toBeCloseTo(1, 4);
    }
    // Top view: the model's front (scene +Z) at the bottom of the screen.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(lookFrom(new THREE.Vector3(0, 1, 0)));
    expect(up.z).toBeLessThan(-0.99);
  });
});

describe("clipPlanes", () => {
  it("hugs the model from outside", () => {
    const { near, far } = clipPlanes(10, 1, 10, false);
    expect(near).toBeCloseTo(8.95);
    expect(far).toBeCloseTo(11.05);
  });

  it("close up inside the model, keeps the near plane at a fiftieth of the way to the centre", () => {
    const { near, far } = clipPlanes(0.2, 1, 0.05, false);
    expect(near).toBeCloseTo(0.001);
    expect(far).toBeCloseTo(1.25);
  });

  it("in ortho, never lets the near plane reach zero", () => {
    const { near } = clipPlanes(0.5, 1, 1, true);
    expect(near).toBeGreaterThan(0);
  });
});

describe("cubeMatrix", () => {
  it("is the identity, Y flipped twice, for a camera looking at the front", () => {
    expect(cubeMatrix(new THREE.Quaternion())).toBe("matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)");
  });

  it("brings the right face to the viewer when the camera is on the right", () => {
    const q = lookFrom(new THREE.Vector3(1, 0, 0));
    const m = new THREE.Matrix4().fromArray(cubeMatrix(q).slice(9, -1).split(",").map(Number));
    // The right face's normal (scene +X; CSS +X too) now points at the viewer (CSS +Z).
    const n = new THREE.Vector3(1, 0, 0).applyMatrix4(m);
    expect(n.z).toBeCloseTo(1);
  });
});

describe("fitPose on a tall screen", () => {
  it("backs off further so the sphere fits the narrower width", () => {
    const box = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    const wide = fitPose(box, new THREE.Vector3(0, 0, 1), 40)!;
    const tall = fitPose(box, new THREE.Vector3(0, 0, 1), 40, 0.02, 0.5)!;
    expect(tall.position.z).toBeGreaterThan(wide.position.z * 1.5);
    expect(tall.radius).toBeCloseTo(Math.sqrt(3));
  });
});
