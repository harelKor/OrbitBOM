import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The tools live in one file per area (toolsets/); this checks every one still reaches the list.
describe("MCP tool list", async () => {
  process.env.DATABASE_URL ??= "postgres://test@localhost:5432/test";
  const { listTools } = await import("./tools");
  const { tools, capabilityDenied } = await import("./registry");
  const names = listTools().map((t) => t.name);

  it("registers every tool once", () => {
    expect(names).toHaveLength(41);
    expect(new Set(names).size).toBe(names.length);
    for (const n of ["list_statuses", "find_parts", "update_parts", "set_up_parts", "undo_batch", "adjust_stock", "set_inventory_info", "update_bom_from_onshape", "edit_drawing", "set_cots_info"]) {
      expect(names).toContain(n);
    }
  });

  it("marks the tools that overwrite or remove as destructive", () => {
    const hint = (n: string) => listTools().find((t) => t.name === n)!.annotations.destructiveHint;
    for (const n of ["undo_batch", "update_parts", "update_bom_from_onshape", "adjust_stock"]) expect(hint(n)).toBe(true);
    for (const n of ["find_parts", "add_inventory_item"]) expect(hint(n)).toBe(false);
  });

  // The app's own role rules (mode.ts): a member's token can't do more than their buttons can.
  const none = { isAdmin: false, team: null };
  const build = { isAdmin: false, team: "build" as const };
  const cad = { isAdmin: false, team: "cad" as const };
  const admin = { isAdmin: true, team: null };
  const tool = (n: string) => tools.find((t) => t.name === n)!;

  it("refuses every write to a member without a team, except CAD Review comments", () => {
    const open = new Set(["add_review_comment", "reply_to_review_comment", "set_review_comment_status"]);
    for (const t of tools.filter((t) => t.write && !open.has(t.name))) {
      const args = t.name === "update_parts" ? { changes: { status: "Released" } } : t.name === "set_up_parts" ? { parts: [{}] } : t.name === "set_cots_info" ? { items: [{ links: [] }] } : {};
      expect(capabilityDenied(t, args, none), t.name).toBeTruthy();
    }
    for (const t of tools.filter((t) => !t.write)) expect(capabilityDenied(t, {}, none), t.name).toBeNull();
  });

  it("refuses through callTool before anything runs", async () => {
    const { callTool } = await import("./registry");
    const member = { ...none, id: "00000000-0000-0000-0000-000000000001" } as never;
    const args = { part_ids: ["00000000-0000-0000-0000-000000000002"], changes: { status: "Released" }, ai_name: "Test" };
    await expect(callTool("update_parts", args, { member })).rejects.toThrow("Ask an admin");
    await expect(callTool("adjust_stock", { item_id: "00000000-0000-0000-0000-000000000002", delta: 5, ai_name: "Test" }, { member })).rejects.toThrow("Ask an admin");
  });

  it("asks the same capability as the app's buttons", () => {
    expect(capabilityDenied(tool("update_parts"), { changes: { status: "Released" } }, build)).toBeNull();
    expect(capabilityDenied(tool("update_parts"), { changes: { description: "x" } }, build)).toMatch("admin");
    expect(capabilityDenied(tool("update_parts"), { changes: { classification: "cots" } }, build)).toMatch("CAD Team");
    expect(capabilityDenied(tool("update_parts"), { changes: { classification: "cots" } }, cad)).toBeNull();
    expect(capabilityDenied(tool("set_up_parts"), { parts: [{ type: "cots" }] }, build)).toMatch("CAD Team");
    expect(capabilityDenied(tool("update_bom_from_onshape"), {}, build)).toMatch("CAD Team");
    expect(capabilityDenied(tool("update_bom_from_onshape"), {}, cad)).toBeNull();
    expect(capabilityDenied(tool("undo_batch"), {}, cad)).toMatch("admin");
    expect(capabilityDenied(tool("undo_batch"), {}, admin)).toBeNull();
    expect(capabilityDenied(tool("add_manual_part"), {}, build)).toMatch("CAD Team");
    expect(capabilityDenied(tool("create_drawings"), {}, build)).toMatch("drawings");
    expect(capabilityDenied(tool("adjust_stock"), {}, build)).toBeNull();
    expect(capabilityDenied(tool("set_cots_info"), { items: [{ links: [] }] }, build)).toBeNull();
    expect(capabilityDenied(tool("set_cots_info"), { items: [{ official_name: "x" }] }, cad)).toMatch("admin");
  });
});
