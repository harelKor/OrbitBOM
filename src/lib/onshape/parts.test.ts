import { expect, it } from "vitest";
import { studioPath, thumbnailHref } from "./parts";

it("builds the part studio path", () => {
  const p = { sourceDid: "d1", sourceWvm: "w", sourceWid: "w1", sourceEid: "e1", onshapePartId: "JHD" };
  expect(studioPath(p)).toBe("d/d1/w/w1/e/e1");
  expect(studioPath({ ...p, sourceWvm: "version" })).toBe("d/d1/v/w1/e/e1");
  expect(studioPath({ ...p, sourceDid: null })).toBeNull();
});

it("picks the thumbnail size", () => {
  const sizes = [
    { size: "70x40", href: "a" },
    { size: "600x340", href: "b" },
  ];
  expect(thumbnailHref({ partId: "x", thumbnailInfo: { sizes } })).toBe("b");
  expect(thumbnailHref({ partId: "x", thumbnailInfo: { sizes: [...sizes, { size: "300x300", href: "c" }] } })).toBe("c");
  expect(thumbnailHref({ partId: "x" })).toBeNull();
});
