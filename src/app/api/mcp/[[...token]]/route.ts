import { NextResponse } from "next/server";
import { memberForToken } from "@/lib/mcp/tokens";
import { ToolError, callTool, listTools } from "@/lib/mcp/tools";

// link_inventory_products reads up to 40 store pages and pictures.
export const maxDuration = 300;

// OrbitParts's MCP server (plan §6), over Streamable HTTP without sessions: every POST is a
// JSON-RPC message (or batch) answered with JSON. The member's personal token comes either as
// a Bearer header or as the last path segment (/api/mcp/<token>), because claude.ai's custom
// connectors take only a URL.

const PROTOCOL = "2025-06-18";
const INSTRUCTIONS =
  "OrbitParts is FRC team 1690's BOM and inventory. Use list_statuses, list_machines and list_materials for exact names. " +
  "Write tools always preview first: show the member the preview and apply with the confirm_token only after they agree. " +
  "Every write tool needs ai_name: your own name (for example \"Claude Opus 5.5\"), which the team sees on To Review and AI logs. " +
  "Every applied change returns a batch_id that undo_batch can revert. " +
  "To set up parts' material and processes yourself, read parts_to_set_up and apply with set_up_parts: those parts wait in To Review for their designer, as do parts changed with update_parts or set_cots_info. " +
  "To fill in COTS parts' official names, product links and prices, read cots_parts_to_look_up, search FRCDesign.org and the vendors' sites, and apply with set_cots_info. " +
  "Inventory: every active robot shares one shelf. Link COTS parts to items with inventory_to_link and link_inventory, see what to buy with inventory_shortages, add items in bulk with add_inventory_items, and fill in specs with inventory_to_look_up and set_inventory_info (categories and their fields come from list_inventory_categories). To link items to their exact product pages and pictures, find them with search_inventory (has_image) and search_online_products, and apply with link_inventory_products (applies at once, no To Review). " +
  "New items are added at once and show in AI logs. set_inventory_info also renames items and moves them to another category or location, so you can clean up a messy inventory; those edits to existing items wait in To Review's Inventory section until a member approves (Reject puts the old values back). " +
  "When items fit no category, add one with add_inventory_category (it waits in To Review too). " +
  "The site suggests links from BOM parts to items (auto-link); like yours, they wait in To Review until a member approves. " +
  "Members can revert any of your runs from the AI logs page.";

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

export async function POST(request: Request, { params }: { params: Promise<{ token?: string[] }> }) {
  const { token: path } = await params;
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const member = await memberForToken(bearer ?? path?.at(-1) ?? "");
  if (!member) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Invalid or revoked OrbitParts token. Make a new one on your profile page." } },
      { status: 401 },
    );
  }

  let body: Rpc | Rpc[];
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  const handle = async (msg: Rpc) => {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
    const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
    switch (msg.method) {
      case "initialize":
        return reply({
          protocolVersion: (msg.params?.protocolVersion as string) ?? PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "orbitbom", title: "OrbitParts (Team 1690)", version: "1.0.0" },
          instructions: INSTRUCTIONS,
        });
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: listTools() });
      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        try {
          const result = await callTool(name, msg.params?.arguments, { member });
          return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 1) }] });
        } catch (err) {
          if (err instanceof ToolError) return reply({ content: [{ type: "text", text: err.message }], isError: true });
          console.error(`MCP tool ${name} failed`, err);
          return reply({ content: [{ type: "text", text: "The tool failed on the server. Try again or tell an admin." }], isError: true });
        }
      }
      default:
        return msg.method?.startsWith("notifications/") ? null : fail(-32601, `Method not found: ${msg.method}`);
    }
  };

  const messages = Array.isArray(body) ? body : [body];
  const replies = (await Promise.all(messages.map(handle))).filter((r) => r !== null);
  if (!replies.length) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? replies : replies[0], {
    headers: { "mcp-protocol-version": PROTOCOL },
  });
}

// No server-sent stream: this server never sends requests to the client.
export function GET() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
}
