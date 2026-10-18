import { describe, expect, it } from "vitest";
import { apiPath, onshapeUrl, parseOnshapeUrl } from "./url";

const did = "0123456789abcdef01234567";
const wid = "89abcdef0123456789abcdef";
const eid = "fedcba9876543210fedcba98";

describe("parseOnshapeUrl", () => {
  it("parses a workspace element URL", () => {
    const ref = parseOnshapeUrl(`https://cad.onshape.com/documents/${did}/w/${wid}/e/${eid}`);
    expect(ref).toEqual({ baseUrl: "https://cad.onshape.com", did, wvm: "w", wvmid: wid, eid });
    expect(apiPath(ref!)).toBe(`d/${did}/w/${wid}/e/${eid}`);
  });

  it("keeps an Enterprise host and ignores query strings", () => {
    const ref = parseOnshapeUrl(
      `https://orbit1690.onshape.com/documents/${did}/v/${wid}/e/${eid}?renderMode=0`,
    );
    expect(ref?.baseUrl).toBe("https://orbit1690.onshape.com");
    expect(ref?.wvm).toBe("v");
    expect(onshapeUrl(ref!)).toBe(
      `https://orbit1690.onshape.com/documents/${did}/v/${wid}/e/${eid}`,
    );
  });

  it("accepts a document URL with no element", () => {
    expect(parseOnshapeUrl(`https://cad.onshape.com/documents/${did}/w/${wid}`)?.eid).toBeUndefined();
  });

  it("rejects other hosts and malformed paths", () => {
    expect(parseOnshapeUrl(`https://evil.com/documents/${did}/w/${wid}/e/${eid}`)).toBeNull();
    expect(parseOnshapeUrl(`https://notonshape.com/documents/${did}/w/${wid}`)).toBeNull();
    expect(parseOnshapeUrl(`http://cad.onshape.com/documents/${did}/w/${wid}`)).toBeNull();
    expect(parseOnshapeUrl("https://cad.onshape.com/documents/abc/w/def")).toBeNull();
    expect(parseOnshapeUrl("not a url")).toBeNull();
  });
});
