import { expect, test } from "vitest";
import { fromWire, toWire } from "./wire";

test("keeps Dates, Maps and Sets as a server action's reply would", () => {
  const value = { at: new Date("2026-11-13T10:00:00.000Z"), byId: new Map([["a", { n: 1, seen: new Set(["x"]) }]]), list: [new Date(0), null], gone: undefined, text: "2026-11-13T10:00:00.000Z" };
  const back = fromWire<typeof value>(toWire(value));
  expect(back.at).toBeInstanceOf(Date);
  expect(back.at.toISOString()).toBe("2026-11-13T10:00:00.000Z");
  expect(back.byId.get("a")?.seen.has("x")).toBe(true);
  expect(back.list[0]).toEqual(new Date(0));
  expect(back.text).toBe("2026-11-13T10:00:00.000Z");
  expect("gone" in back).toBe(false);
  expect(fromWire(toWire(null))).toBe(null);
});
