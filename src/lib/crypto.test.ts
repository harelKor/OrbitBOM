import { randomBytes } from "node:crypto";
import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.ONSHAPE_TOKEN_KEY = randomBytes(32).toString("base64");
const { decrypt, encrypt } = await import("./crypto");

it("round-trips and rejects tampering", () => {
  const sealed = encrypt("token-123");
  expect(sealed).not.toContain("token-123");
  expect(decrypt(sealed)).toBe("token-123");
  const [iv, tag, data] = sealed.split(".");
  const flipped = data[0] === "A" ? "B" + data.slice(1) : "A" + data.slice(1);
  expect(() => decrypt([iv, tag, flipped].join("."))).toThrow();
});
