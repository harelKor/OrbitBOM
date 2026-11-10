import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { fitPose } from "./camera";

const box = new THREE.Box3(new THREE.Vector3(-1, 0, 2), new THREE.Vector3(1, 4, 6));

describe("fitPose", () => {
  it("aims at the box centre and backs off so its sphere fills the field of view", () => {
    const pose = fitPose(box, new THREE.Vector3(0, 0, 5), 60)!;
    expect(pose.target.toArray()).toEqual([0, 2, 4]);
    // radius = |size| / 2 = √(4 + 16 + 16) / 2 = 3; distance = r / sin(30°) = 6.
    expect(pose.position.x).toBeCloseTo(0);
    expect(pose.position.y).toBeCloseTo(2);
    expect(pose.position.z).toBeCloseTo(10);
  });

  it("keeps the direction it's given, at any length", () => {
    const a = fitPose(box, new THREE.Vector3(1, 1, 1), 40)!;
    const b = fitPose(box, new THREE.Vector3(7, 7, 7), 40)!;
    expect(a.position.distanceTo(b.position)).toBeCloseTo(0);
    const dir = a.position.clone().sub(a.target).normalize();
    expect(dir.x).toBeCloseTo(1 / Math.sqrt(3));
    expect(dir.x).toBeCloseTo(dir.z);
  });

  it("holds a tiny part at the minimum radius", () => {
    const tiny = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.001, 0.001, 0.001));
    const pose = fitPose(tiny, new THREE.Vector3(0, 0, 1), 60, 0.5)!;
    expect(pose.position.distanceTo(pose.target)).toBeCloseTo(1);
  });

  it("falls back to a three-quarter view with no direction, and to nothing for an empty box", () => {
    const pose = fitPose(box, new THREE.Vector3(), 60)!;
    const dir = pose.position.clone().sub(pose.target).normalize();
    expect(dir.toArray().map((x) => Math.sign(x))).toEqual([1, 1, 1]);
    expect(fitPose(new THREE.Box3(), new THREE.Vector3(0, 0, 1), 60)).toBeNull();
  });
});
