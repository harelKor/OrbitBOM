import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Looks } from "./paint";
import type { Gone, PartMesh } from "./types";
import { createVisibility } from "./visibility";

// Two 10 cm cubes of part "a" at x = 0 and x = 1 m, and one of part "b" at x = 2 m, all on the
// x axis; looking down -z from z = 5 at x = 0 meets a's first copy.
function scene() {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  const mk = (xs: number[], key: string, g: number): PartMesh => {
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial(), xs.length);
    xs.forEach((x, i) => mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0, 0)));
    root.add(mesh);
    return { mesh, keys: xs.map(() => key), g };
  };
  const meshes = [mk([0, 1], "a", 0), mk([2], "b", 1)];
  root.updateMatrixWorld(true);
  const looks = { ghost: new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.14 }) } as Looks;
  const log = { hidden: [] as Gone[], isolated: undefined as string[] | null | undefined, fit: 0 };
  const v = createVisibility(meshes, root, looks, {
    changed: () => {},
    hidden: (g) => (log.hidden = g),
    isolated: (k) => (log.isolated = k),
    hoverOff: () => {},
    fit: () => log.fit++,
  });
  const ray = (x: number) => {
    const r = new THREE.Raycaster();
    r.set(new THREE.Vector3(x, 0, 5), new THREE.Vector3(0, 0, -1));
    return r;
  };
  return { v, meshes, root, ray, log };
}

describe("visibility", () => {
  it("finds the hidden copy under the pointer at its kept place (Shift+Y), and only there", () => {
    const { v, ray, log } = scene();
    v.hideOne({ m: 0, i: 1, key: "a" });
    expect(log.hidden).toHaveLength(1);
    expect(v.hiddenAt(ray(1))?.g).toEqual({ m: 0, i: 1, key: "a" });
    expect(v.hiddenAt(ray(0))).toBeNull(); // a shown copy there, nothing hidden
    v.show([v.hiddenAt(ray(1))!.g]);
    expect(log.hidden).toHaveLength(0);
    expect(v.hiddenAt(ray(1))).toBeNull();
  });

  it("isolates with see-through ghosts of the rest, or hides them", () => {
    const { v, meshes, root, log } = scene();
    v.tools.isolate(["b"]);
    expect(meshes.map((p) => p.mesh.visible)).toEqual([false, true]);
    expect(log.isolated).toEqual(["b"]);
    const ghosts = root.children.find((c) => c.type === "Group")!;
    expect(ghosts.children).toHaveLength(1);
    expect((ghosts.children[0] as THREE.InstancedMesh).instanceMatrix).toBe(meshes[0].mesh.instanceMatrix);
    v.tools.isolate(["b"], { ghost: false });
    expect(ghosts.children).toHaveLength(0);
    v.tools.showAll();
    expect(meshes.map((p) => p.mesh.visible)).toEqual([true, true]);
    expect(log.isolated).toBeNull();
  });

  it("makes a part see-through and back, over whatever the paint gave it", () => {
    const { v, meshes } = scene();
    const painted = meshes[0].mesh.material as THREE.Material;
    v.tools.setClear(["a"], true);
    const clear = meshes[0].mesh.material as THREE.Material;
    expect(clear).not.toBe(painted);
    expect(clear.transparent && clear.opacity).toBeLessThan(1);
    expect(v.tools.isClear("a")).toBe(true);
    v.tools.setClear(["a"], false);
    expect(meshes[0].mesh.material).toBe(painted);
  });

  it("saves and restores what's hidden by part and place, not by mesh order", () => {
    const { v, log } = scene();
    v.hideOne({ m: 0, i: 1, key: "a" });
    v.tools.setClear(["b"], true);
    v.tools.isolate(["a", "b"], { ghost: false });
    const saved = JSON.parse(JSON.stringify(v.tools.visibilityState()));
    expect(saved.hidden).toEqual([{ key: "a", at: [1, 0, 0] }]);
    v.tools.showAll();
    v.tools.setClear(["b"], false);
    expect(log.hidden).toHaveLength(0);
    v.tools.setVisibilityState(saved);
    expect(log.hidden).toEqual([{ m: 0, i: 1, key: "a" }]);
    expect(v.tools.isClear("b")).toBe(true);
    expect(v.isolated()).toEqual({ keys: ["a", "b"], ghost: false });
  });
});
