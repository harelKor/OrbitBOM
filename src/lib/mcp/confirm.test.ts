import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.MCP_SECRET = "test-secret";
const { canonical, checkConfirmToken, confirmToken } = await import("./confirm");

it("binds a confirm token to the member, tool and exact arguments", () => {
  const args = { ids: ["a", "b"], changes: { status: "Gcoded" } };
  const t = confirmToken("m1", "update_parts", args, 1000);
  expect(checkConfirmToken(t, "m1", "update_parts", { changes: { status: "Gcoded" }, ids: ["a", "b"], confirm_token: t }, 2000)).toBe(true);
  expect(checkConfirmToken(t, "m2", "update_parts", args, 2000)).toBe(false);
  expect(checkConfirmToken(t, "m1", "update_parts", { ...args, ids: ["a"] }, 2000)).toBe(false);
  expect(checkConfirmToken(t, "m1", "update_parts", args, 1000 + 16 * 60_000)).toBe(false);
  expect(canonical({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
});
