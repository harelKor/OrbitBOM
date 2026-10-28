// The stores the Inventory add box searches: FRCDesignLib's vendors (Harel, 2026-10-23), plus shop
// supply stores for glue, wire, tools and 3D printing (Harel, 2026-10-28). A `shopify` store answers
// its own public search (/search/suggest.json) and a `woo` store its WooCommerce one
// (/wp-json/wc/store/v1/products), so their results show in the box with photo and price. Each
// was checked to answer with titles, photos and prices in dollars. The others can't be searched
// for free from the site (or block servers); the box links to their own search, and a product
// link pasted back is read like any other. `hebrew` stores get the query as typed.
// Edit here; there is no settings UI.

export type Vendor = { id: string; name: string; host: string; api: "shopify" | "woo" | null; hebrew?: boolean; searchUrl: (q: string) => string };

const shop = (id: string, name: string, host: string, api: "shopify" | "woo" = "shopify"): Vendor => ({
  id,
  name,
  host,
  api,
  searchUrl: (q) => (api === "woo" ? `https://${host}/?s=${encodeURIComponent(q)}&post_type=product` : `https://${host}/search?q=${encodeURIComponent(q)}`),
});
const link = (id: string, name: string, host: string, searchUrl: (q: string) => string, hebrew?: boolean): Vendor => ({ id, name, host, api: null, hebrew, searchUrl });

export const VENDORS: Vendor[] = [
  shop("wcp", "WCP", "wcproducts.com"),
  shop("andymark", "AndyMark", "www.andymark.com"),
  shop("ttb", "ThriftyBot", "www.thethriftybot.com"),
  shop("sds", "SDS", "www.swervedrivespecialties.com"),
  shop("ctre", "CTRE", "store.ctr-electronics.com"),
  // Shop supplies: CA glue, silicone wire and connectors, taps and hand tools, filament.
  shop("starbond", "Starbond", "www.starbond.com"),
  shop("bitsbits", "BitsBits", "bitsbits.com", "woo"),
  shop("toolnut", "ToolNut", "www.toolnut.com"),
  shop("rdq", "RaceDayQuads", "www.racedayquads.com"),
  shop("pyrodrone", "Pyrodrone", "www.pyrodrone.com"),
  shop("printedsolid", "Printed Solid", "www.printedsolid.com"),
  shop("lulzbot", "LulzBot", "shop.lulzbot.com"),
  // Redux left Shopify; its new store has no search.
  link("redux", "Redux", "shop.reduxrobotics.com", () => "https://shop.reduxrobotics.com/products"),
  link("vex", "VEX", "www.vexrobotics.com", (q) => `https://www.vexrobotics.com/catalogsearch/result/?q=${encodeURIComponent(q)}`),
  link("rev", "REV", "www.revrobotics.com", (q) => `https://www.revrobotics.com/search.php?search_query=${encodeURIComponent(q)}`),
  // 4Project blocks servers (Cloudflare), so it's a link (through Google, its own search has no
  // address to link to), searched in Hebrew as typed.
  link("4project", "4Project", "www.4project.co.il", (q) => `https://www.google.com/search?q=${encodeURIComponent(`site:4project.co.il ${q}`)}`, true),
  link("aliexpress", "AliExpress", "www.aliexpress.com", (q) => `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(q.replace(/\s+/g, "-"))}.html`),
  link("amazon", "Amazon", "www.amazon.com", (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`),
  // Shop supplies, tools and electronics the FRC stores don't sell (Harel, 2026-10-28).
  link("mcmaster", "McMaster", "www.mcmaster.com", (q) => `https://www.mcmaster.com/products/${encodeURIComponent(q.replace(/\s+/g, "-"))}/`),
  link("digikey", "DigiKey", "www.digikey.com", (q) => `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(q)}`),
  link("mouser", "Mouser", "www.mouser.com", (q) => `https://www.mouser.com/c/?q=${encodeURIComponent(q)}`),
];

export const vendorOfUrl = (url: string) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return VENDORS.find((v) => v.host.replace(/^www\./, "") === host)?.name ?? host;
  } catch {
    return url;
  }
};
