import { describe, expect, it } from "vitest";
import { contentDisposition } from "./disposition";

describe("contentDisposition", () => {
  it("keeps plain names", () => {
    expect(contentDisposition("1690-26-401 Plate.step")).toBe(`attachment; filename="1690-26-401 Plate.step"; filename*=UTF-8''1690-26-401%20Plate.step`);
  });
  it("can't be broken out of", () => {
    const h = contentDisposition('a"\r\nSet-Cookie: x=1\.step');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.split('"').length).toBe(3);
  });
  it("gives Hebrew names in filename*", () => {
    const h = contentDisposition("לוח.dxf", true);
    expect(h.startsWith('inline; filename="')).toBe(true);
    expect(h).toContain(`filename*=UTF-8''${encodeURIComponent("לוח.dxf")}`);
  });
});
