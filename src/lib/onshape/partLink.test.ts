import { describe, expect, it } from "vitest";
import { partOnshapeUrl, sourceOfKey } from "./partLink";

const A = "a".repeat(24); // assembly document
const C = "c".repeat(24); // another (CAD) document
const E = "e".repeat(24);
const S = "f".repeat(24); // Part Studio tab
const asm = { base: "https://team.onshape.com", did: A, eid: E };

describe("partOnshapeUrl", () => {
  it("opens the Part Studio at the version the BOM keeps for its document", () => {
    expect(partOnshapeUrl({ did: C, eid: S }, { asm, at: { wvm: "v", wvmid: "1".repeat(24) }, docs: { [C]: { versionId: "2".repeat(24) } } })).toBe(
      `https://team.onshape.com/documents/${C}/v/${"2".repeat(24)}/e/${S}`,
    );
  });

  it("opens a Part Studio in the assembly's document at the assembly's state", () => {
    expect(partOnshapeUrl({ did: A, eid: S }, { asm, at: { wvm: "m", wvmid: "3".repeat(24) } })).toBe(`https://team.onshape.com/documents/${A}/m/${"3".repeat(24)}/e/${S}`);
  });

  it("falls back to the assembly at that state, and to nothing without a state", () => {
    expect(partOnshapeUrl({ did: C, eid: S }, { asm, at: { wvm: "v", wvmid: "1".repeat(24) } })).toBe(`https://team.onshape.com/documents/${A}/v/${"1".repeat(24)}/e/${E}`);
    expect(partOnshapeUrl({ did: C, eid: S }, { asm, at: null })).toBeNull();
  });

  it("reads the Part Studio from a 3D model key", () => {
    expect(sourceOfKey(`${C}:${S}:JHD#2`)).toEqual({ did: C, eid: S });
    expect(sourceOfKey("x")).toBeNull();
  });
});
