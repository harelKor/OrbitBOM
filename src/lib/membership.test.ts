import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {}, schema: {} }));

const { isBootstrapAdmin } = await import("./membership");

describe("isBootstrapAdmin", () => {
  it("matches a listed email, ignoring case and spaces", () => {
    expect(isBootstrapAdmin("Harel@Example.com", " a@b.com, harel@example.com ")).toBe(true);
  });

  it("rejects everyone when the list is empty", () => {
    expect(isBootstrapAdmin("a@b.com", "")).toBe(false);
  });
});
