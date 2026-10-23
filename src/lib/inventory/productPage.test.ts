import { describe, expect, it } from "vitest";
import { readProductPage } from "./productPage";

describe("readProductPage", () => {
  it("reads Open Graph tags", () => {
    const html = `<html><head><title>x</title>
      <meta property="og:title" content="Kraken X60 Powered by TalonFX | WCP">
      <meta property="og:image" content="//cdn.shopify.com/kraken.png?v=1">
      <meta property="product:price:amount" content="199.99"><meta property="product:price:currency" content="USD"></head></html>`;
    expect(readProductPage(html, "https://wcproducts.com/products/kraken")).toEqual({
      url: "https://wcproducts.com/products/kraken",
      site: "wcproducts.com",
      title: "Kraken X60 Powered by TalonFX",
      image: "https://cdn.shopify.com/kraken.png?v=1",
      price: 199.99,
      currency: "USD",
      sku: null,
    });
  });
  it("prefers schema.org Product data", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"Product","name":"36T HTD Pulley","sku":"WCP-0123","image":["/p.jpg"],"offers":[{"@type":"Offer","price":"12.50","priceCurrency":"USD"}]}]}</script>`;
    expect(readProductPage(html, "https://www.example.com/a")).toMatchObject({ title: "36T HTD Pulley", sku: "WCP-0123", image: "https://www.example.com/p.jpg", price: 12.5, site: "example.com" });
  });
  it("falls back to the page title", () => {
    expect(readProductPage("<title>Bearing &amp; Co</title>", "https://shop.test/x")).toMatchObject({ title: "Bearing & Co", image: null, price: null });
  });
});
