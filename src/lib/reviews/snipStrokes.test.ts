import { describe, expect, it } from "vitest";
import { cleanStrokes, mergeStrokes } from "./snipStrokes";

const snip = {
  path: "review-snips/a.jpg",
  w: 400,
  h: 300,
  strokes: [
    { by: "author", c: "#ef4444", s: 4, p: [0, 0, 10, 10] },
    { by: "noa", c: "#22c55e", s: 2, p: [5, 5, 20, 20] },
  ],
};

describe("snip lines", () => {
  it("keeps only real lines, inside the picture", () => {
    const out = cleanStrokes(
      [
        { c: "#EF4444", s: 300, p: [-5, 10, 500, 20] },
        { c: "red", s: 3, p: [1, 2, 3, 4] },
        { c: "#111827", s: 3, p: [1] },
        { by: "someone-else", c: "#3b82f6", s: 2.4, p: [1.234, 2, 3, 4] },
      ],
      400,
      300,
    );
    expect(out).toEqual([
      { c: "#ef4444", s: 64, p: [0, 10, 400, 20] },
      { c: "#3b82f6", s: 2, p: [1.2, 2, 3, 4] },
    ]);
  });

  it("someone else adds lines and erases only their own: tagged as changed", () => {
    const next = mergeStrokes(snip, { id: "ido", name: "Ido" }, false, { own: [{ c: "#3b82f6", s: 3, p: [1, 1, 2, 2] }] }, new Date("2026-11-10T10:00:00Z"));
    expect(next.strokes.map((s) => s.by)).toEqual(["author", "noa", "ido"]);
    expect(next.changed).toEqual([{ by: "ido", name: "Ido", at: "2026-11-10T10:00:00.000Z" }]);
    // Noa redraws: her old line goes, the author's and Ido's stay.
    const noa = mergeStrokes(next, { id: "noa", name: "Noa" }, false, { own: [] });
    expect(noa.strokes.map((s) => s.by)).toEqual(["author", "ido"]);
    expect(noa.changed?.map((c) => c.name)).toEqual(["Ido", "Noa"]);
  });

  it("the author erases anyone's line, untagged", () => {
    const next = mergeStrokes(snip, { id: "author", name: "Harel" }, true, { own: [{ c: "#111827", s: 2, p: [0, 0, 1, 1] }], keep: [1, 7] });
    expect(next.strokes).toEqual([
      { by: "noa", c: "#22c55e", s: 2, p: [5, 5, 20, 20] },
      { by: "author", c: "#111827", s: 2, p: [0, 0, 1, 1] },
    ]);
    expect(next.changed).toEqual([]);
  });
});
