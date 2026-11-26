import { beforeEach, describe, expect, it, vi } from "vitest";
import { labelFor, meterReport, recordQuery, resetMeter, shapeOf } from "./meter";

describe("egress meter", () => {
  beforeEach(() => {
    resetMeter();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("folds placeholder lists so one loader is one line", () => {
    expect(shapeOf('select "id" from "parts" where "id" in ($1, $2,\n $3)')).toBe('select "id" from "parts" where "id" in ($n)');
    expect(labelFor('select "id" from "parts" where "id" in ($1)')).toBe(labelFor('select "id" from "parts" where "id" in ($1, $2)'));
    expect(labelFor('select "id" from "parts"')).toMatch(/^parts#/);
    expect(labelFor('update "parts" set "x" = $1')).toMatch(/^update:parts#/);
  });

  it("adds up bytes and rows per label, biggest first", () => {
    recordQuery('select * from "parts"', 10, 5000);
    recordQuery('select * from "parts"', 10, 5000);
    recordQuery('select * from "robots"', 1, 300);
    const r = meterReport();
    expect(r).toMatchObject({ bytes: 10300, queries: 3 });
    expect(r.top[0]).toMatchObject({ queries: 2, rows: 20, bytes: 10000 });
    expect(r.top[0].label).toMatch(/^parts#/);
  });
});
