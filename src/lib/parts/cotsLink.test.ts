import { describe, expect, it } from "vitest";
import { COTS_LINK_KEPT, COTS_LINK_REQUIRED, cotsLinkDenied } from "./cotsLink";

const cots = { classification: "cots", inventoryItemId: null, designState: null };
const linked = { ...cots, inventoryItemId: "item" };

describe("cotsLinkDenied", () => {
  it("blocks Released and Order List statuses on unlinked COTS parts", () => {
    expect(cotsLinkDenied(cots, { status: "Released" })).toBe(COTS_LINK_REQUIRED);
    expect(cotsLinkDenied(cots, { status: "In Order List" })).toBe(COTS_LINK_REQUIRED);
    expect(cotsLinkDenied(cots, { status: "Ordered" })).toBe(COTS_LINK_REQUIRED);
    expect(cotsLinkDenied(cots, { status: "Not Started" })).toBeNull();
  });
  it("allows linked parts, made parts, and linking in the same change", () => {
    expect(cotsLinkDenied(linked, { status: "Released" })).toBeNull();
    expect(cotsLinkDenied({ ...cots, classification: "inhouse" }, { status: "Released" })).toBeNull();
    expect(cotsLinkDenied(cots, { status: "Released", inventoryItemId: "item" })).toBeNull();
  });
  it("keeps the link while the part is in Released or the Order List", () => {
    expect(cotsLinkDenied({ ...linked, designState: "Released" }, { inventoryItemId: null })).toBe(COTS_LINK_KEPT);
    expect(cotsLinkDenied({ ...linked, designState: "Not Started" }, { inventoryItemId: null })).toBeNull();
    expect(cotsLinkDenied({ ...linked, designState: "Released" }, { inventoryItemId: null, status: "Not Started" })).toBeNull();
  });
});
