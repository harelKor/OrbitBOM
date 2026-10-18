import { describe, expect, it } from "vitest";
import { guessColumns, parseCsv, parseImportRows } from "./import";

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
      { name: "Bearing, flanged 1/2 hex", inStock: 12, location: "A1", groupPath: ["Hardware", "Bearings"], condition: "New", material: null },
      { name: "Tube 25x25", inStock: 0, location: "B2", groupPath: ["Raw stock"], condition: "Used", material: "6061" },
    ]);
  });

  it("handles semicolons and doubled quotes", () => {
    expect(parseCsv('a;"b ""c"""\r\n1;2')).toEqual([
      ["a", 'b "c"'],
      ["1", "2"],
    ]);
  });
});
