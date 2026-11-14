import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { cronAllowed } = await import("./cron");

const req = (auth?: string) => new Request("http://x/api/cron/keep-alive", { headers: auth ? { authorization: auth } : {} });
const SECRET = "a-long-enough-cron-secret";

describe("cronAllowed", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lets the timer's Bearer secret through", () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect(cronAllowed(req(`Bearer ${SECRET}`))).toBe(true);
    expect(cronAllowed(req(`Bearer ${SECRET}x`))).toBe(false);
    expect(cronAllowed(req(SECRET))).toBe(false);
    expect(cronAllowed(req())).toBe(false);
  });

  it("fails closed without a secret", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(cronAllowed(req("Bearer undefined"))).toBe(false);
    expect(cronAllowed(req("Bearer "))).toBe(false);
    vi.stubEnv("CRON_SECRET", "short");
    expect(cronAllowed(req("Bearer short"))).toBe(false);
  });
});
