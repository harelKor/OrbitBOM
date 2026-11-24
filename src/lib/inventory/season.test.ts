import { describe, expect, it } from "vitest";
import { missing, neededFor, newestOpenOrders, orderHref, standing } from "./season";

const item = (inStock: number, seasonNeed: number | null, robotNeed = 0, extra: Partial<{ sheet: boolean; openOrder: { partId: string; status: string } | null }> = {}) => ({
  inStock,
  seasonNeed,
  sheet: false,
  usage: robotNeed ? { need: robotNeed } : null,
  openOrder: null,
  ...extra,
});

describe("season needs", () => {
  it("uses the view's need, or the bigger one", () => {
    const i = item(3, 6, 4);
    expect(neededFor(i, "season")).toBe(6);
    expect(neededFor(i, "robots")).toBe(4);
    expect(neededFor(i, "any")).toBe(6);
    expect(neededFor(item(3, null), "any")).toBeNull();
    expect(neededFor(item(3, 0), "season")).toBeNull();
  });

  it("counts what's missing, sheets rounded up to whole sheets", () => {
    expect(missing(item(3, 6, 4), "robots")).toBe(1);
    expect(missing(item(3, 6, 4), "any")).toBe(3);
    expect(missing(item(7, 6), "season")).toBe(0);
    expect(missing(item(1.25, 2, 0, { sheet: true }), "season")).toBe(1);
  });

  it("is short by whichever misses more: the whole season need or its New part", () => {
    const v = [{}, {}];
    // 10 in stock, 2 of them New; the season wants 8, 5 of them New.
    const i = { ...item(10, 8), seasonNeedNew: 5, newStock: 2, variants: v };
    expect(missing(i, "season")).toBe(3);
    expect(missing(i, "any")).toBe(3);
    expect(missing(i, "robots")).toBe(0);
    expect(standing(i, "season")).toBe("short");
    // The whole need misses more than the New one.
    expect(missing({ ...item(4, 8), seasonNeedNew: 3, newStock: 2, variants: v }, "season")).toBe(4);
    // Without variants the New need counts for nothing.
    expect(missing({ ...item(10, 8), seasonNeedNew: 5, newStock: 0, variants: [] }, "season")).toBe(0);
  });

  it("colours red short, orange on order, green covered", () => {
    expect(standing(item(1, 3), "season")).toBe("short");
    expect(standing(item(3, 3), "season")).toBe("ok");
    expect(standing(item(1, 3, 0, { openOrder: { partId: "p", status: "Released" } }), "season")).toBe("ordered");
    expect(standing(item(3, 3, 0, { openOrder: { partId: "p", status: "In Route" } }), "season")).toBe("ok");
  });

  it("finds each item's newest open order", () => {
    const at = (n: number) => new Date(2026, 9, n);
    const orders = newestOpenOrders([
      { itemId: "a", partId: "robot-released", status: "Released", systemId: "s1", restock: false, at: at(5) },
      { itemId: "a", partId: "old", status: "In Order List", systemId: "s1", restock: false, at: at(1) },
      { itemId: "a", partId: "new", status: "Released", systemId: null, restock: true, at: at(3) },
      { itemId: "b", partId: "done", status: "In Stock", systemId: null, restock: true, at: at(4) },
    ]);
    expect(orders.get("a")).toEqual({ partId: "new", status: "Released" });
    expect(orders.has("b")).toBe(false);
    expect(orderHref({ partId: "new", status: "Released" })).toBe("/cots/released?part=new");
    expect(orderHref({ partId: "x", status: "Seen" })).toBe("/cots/order-list?part=x");
  });
});
