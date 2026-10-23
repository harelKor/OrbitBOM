// The stores the Inventory add box searches: FRCDesignLib's vendors (Harel, 2026-10-23). A
// `shopify` store answers its own public search (/search/suggest.json), so its results show in
// the box with photo and price. The others can't be searched for free from the site; the box
// links to their own search, and a product link pasted back is read like any other.
// Edit here; there is no settings UI.

export type Vendor = { id: string; name: string; host: string; shopify: boolean; searchUrl: (q: string) => string };

const shop = (id: string, name: string, host: string): Vendor => ({
  id,
  name,
  host,
  shopify: true,
  searchUrl: (q) => `https://${host}/search?q=${encodeURIComponent(q)}`,
});

export const VENDORS: Vendor[] = [
  shop("wcp", "WCP", "wcproducts.com"),
  shop("andymark", "AndyMark", "www.andymark.com"),
  shop("ttb", "ThriftyBot", "www.thethriftybot.com"),
  shop("sds", "SDS", "www.swervedrivespecialties.com"),
  shop("ctre", "CTRE", "store.ctr-electronics.com"),
  shop("redux", "Redux", "shop.reduxrobotics.com"),
  shop("vex", "VEX", "www.vexrobotics.com"),
  { id: "rev", name: "REV", host: "www.revrobotics.com", shopify: false, searchUrl: (q) => `https://www.revrobotics.com/search.php?search_query=${encodeURIComponent(q)}` },
  { id: "aliexpress", name: "AliExpress", host: "www.aliexpress.com", shopify: false, searchUrl: (q) => `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(q.replace(/\s+/g, "-"))}.html` },
  { id: "amazon", name: "Amazon", host: "www.amazon.com", shopify: false, searchUrl: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}` },
];

export const vendorOfUrl = (url: string) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return VENDORS.find((v) => v.host.replace(/^www\./, "") === host)?.name ?? host;
  } catch {
    return url;
  }
};
