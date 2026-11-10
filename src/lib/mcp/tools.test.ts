import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The tools live in one file per area (toolsets/); this checks every one still reaches the list.
describe("MCP tool list", async () => {
  process.env.DATABASE_URL ??= "postgres://test@localhost:5432/test";
  const { listTools } = await import("./tools");
  const names = listTools().map((t) => t.name);

  it("registers every tool once", () => {
    expect(names).toHaveLength(39);
    expect(new Set(names).size).toBe(names.length);
    for (const n of ["list_statuses", "find_parts", "update_parts", "set_up_parts", "undo_batch", "adjust_stock", "set_inventory_info", "update_bom_from_onshape", "edit_drawing", "set_cots_info"]) {
      expect(names).toContain(n);
    }
  });
});
