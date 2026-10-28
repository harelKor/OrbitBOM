import { describe, expect, it } from "vitest";
import { EXPORT_HEADERS } from "./export";
import { guessColumns, isOrbitExport, parseCsv, parseImportRows } from "./import";

const blank = { seasonNeed: null, price: null, url: null, note: null };

describe("inventory import", () => {
  it("reads the FRCBOM template layout", () => {
    const [header, ...rows] = parseCsv(
      'Item,Size / spec,Quantity,Location,Category,Condition,Material\n' +
        '"Bearing, flanged",1/2 hex,12,A1,Hardware > Bearings,New,\n' +
        "Tube,25x25,x,B2,Raw stock,Used,6061\n" +
        ",,,,,,\n",
    );
    const map = guessColumns(header);
    expect(map).toEqual({ item: 0, spec: 1, quantity: 2, location: 3, category: 4, condition: 5, material: 6 });
    expect(parseImportRows(rows, map, true)).toEqual([
      { name: "Bearing, flanged 1/2 hex", inStock: 12, location: "A1", groupPath: ["Hardware", "Bearings"], condition: "New", material: null, ...blank },
      { name: "Tube 25x25", inStock: null, location: "B2", groupPath: ["Raw stock"], condition: "Used", material: "6061", ...blank },
    ]);
  });

  it("reads back an exported spreadsheet", () => {
    const header = [...EXPORT_HEADERS];
    const map = guessColumns(header);
    expect(isOrbitExport(header)).toBe(true);
    expect(map).toMatchObject({ item: 2, spec: 3, quantity: 4, category: 1, seasonNeed: 5, condition: 9, location: 10, price: 11, url: 13, note: 14 });
    const row = ["COTS", "Bearings", "Flanged bearing", "1/2 hex", "2 ¾", 10, null, 8, "Short", "New", "A1", 1.5, "WCP", "https://wcproducts.com/x", "שמור"];
    expect(parseImportRows([row], map, false)).toEqual([
      { name: "Flanged bearing", inStock: 2.75, location: "A1", groupPath: ["Bearings"], condition: "New", material: null, seasonNeed: 10, price: 1.5, url: "https://wcproducts.com/x", note: "שמור" },
    ]);
  });

  it("handles semicolons and doubled quotes", () => {
    expect(parseCsv('a;"b ""c"""\r\n1;2')).toEqual([
      ["a", 'b "c"'],
      ["1", "2"],
    ]);
  });
});
