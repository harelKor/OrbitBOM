import { expect, test } from "vitest";
import { decodeVisit, encodeVisit } from "./visit";

const id = "3f2b6c1e-8a4d-4c2a-9f1e-0b7d5e6a1c22";

test("a visit round-trips through the cookie", () => {
  expect(decodeVisit(encodeVisit(id, "/robots/x/fab?machine=laser"))).toEqual({ id, page: "/robots/x/fab?machine=laser" });
});

test("bad visits are ignored", () => {
  expect(decodeVisit(undefined)).toBeNull();
  expect(decodeVisit(`not-a-uuid|${encodeURIComponent("/robots")}`)).toBeNull();
  expect(decodeVisit(encodeVisit(id, "//evil.example"))).toBeNull();
  expect(decodeVisit(encodeVisit(id, "https://evil.example"))).toBeNull();
  expect(decodeVisit(`${id}|%E0%A4%A`)).toBeNull();
});
