import { BlockList, isIP } from "node:net";

// Addresses a link from the web must never reach: this machine, the VM's own network and
// Oracle's metadata service (169.254.169.254), Docker, CGNAT, and the reserved and multicast
// ranges. Checked on the address a host name resolves to, so a public name pointing inside fails too.
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const)
  blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10],
  ["ff00::", 8], // multicast
] as const)
  blocked.addSubnet(net, bits, "ipv6");

// The IPv4 address inside an IPv4-mapped (::ffff:a.b.c.d), NAT64 (64:ff9b::) or IPv4-compatible
// IPv6 address, so ::ffff:127.0.0.1 is judged as 127.0.0.1.
function embeddedV4(ip: string): string | null {
  const m = /^(?:::ffff:|64:ff9b::|::)(?:0:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (m) return m[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (!hex) return null;
  const a = parseInt(hex[1], 16);
  const b = parseInt(hex[2], 16);
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}

// True for any address that isn't plainly on the public internet (and for anything that isn't an IP).
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return blocked.check(ip, "ipv4");
  if (kind !== 6) return true;
  const v4 = embeddedV4(ip.toLowerCase());
  if (v4) return isIP(v4) !== 4 || blocked.check(v4, "ipv4");
  return blocked.check(ip, "ipv6");
}
