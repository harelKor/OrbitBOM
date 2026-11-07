import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { publicOrigin } from "./origin";

describe("publicOrigin", () => {
  it("uses the proxy's forwarded host and protocol, not the local listen address", () => {
    const req = new NextRequest("http://localhost:3000/auth/callback", {
      headers: { host: "localhost:3000", "x-forwarded-host": "parts.example.org", "x-forwarded-proto": "https" },
    });
    expect(publicOrigin(req)).toBe("https://parts.example.org");
  });

  it("falls back to the Host header with the request's own protocol", () => {
    const req = new NextRequest("http://localhost:3000/x", { headers: { host: "parts.example.org" } });
    expect(publicOrigin(req)).toBe("http://parts.example.org");
  });

  it("takes the first value of a forwarded list", () => {
    const req = new NextRequest("http://localhost:3000/x", {
      headers: { "x-forwarded-host": "a.example.org, b.example.org", "x-forwarded-proto": "https,http" },
    });
    expect(publicOrigin(req)).toBe("https://a.example.org");
  });
});
