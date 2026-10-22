import { expect, it } from "vitest";
import { checkSpecs } from "./specs";

it("keeps a type's own fields and checks their options", () => {
  expect(checkSpecs("pulleys", { teeth: "24", Bore: "1/2In HEX" })).toEqual({ values: { teeth: "24", bore: "1/2In HEX" } });
  expect(checkSpecs("pulleys", { bore: "round" })).toHaveProperty("error");
  expect(checkSpecs("pulleys", { colour: "red" })).toHaveProperty("error");
  expect(checkSpecs("nope", {})).toHaveProperty("error");
});
