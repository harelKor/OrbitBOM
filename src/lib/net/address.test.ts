import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "./address";

describe("isPrivateAddress", () => {
  it("refuses this machine, private networks, metadata and CGNAT", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.254", "0.0.0.0", "224.0.0.1", "255.255.255.255"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("refuses IPv6 loopback, local, link-local and IPv4 hidden in IPv6", () => {
    for (const ip of ["::1", "::", "fd00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "64:ff9b::10.0.0.1", "2001:db8::1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("lets public addresses through", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
  it("refuses what isn't an address", () => {
    expect(isPrivateAddress("example.com")).toBe(true);
  });
});
