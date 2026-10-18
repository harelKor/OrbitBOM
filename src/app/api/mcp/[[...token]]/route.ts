import { NextResponse } from "next/server";
import { memberForToken } from "@/lib/mcp/tokens";
import { ToolError, callTool, listTools } from "@/lib/mcp/tools";

export const maxDuration = 60;

// OrbitBOM's MCP server (plan §6), over Streamable HTTP without sessions: every POST is a
// JSON-RPC message (or batch) answered with JSON. The member's personal token comes either as
// a Bearer header or as the last path segment (/api/mcp/<token>), because claude.ai's custom
// connectors take only a URL.

const PROTOCOL = "2025-06-18";
const INSTRUCTIONS =
  "OrbitBOM is FRC team 1690's BOM and inventory. Use list_statuses, list_machines and list_materials for exact names. " +
  "Write tools always preview first: show the member the preview and apply with the confirm_token only after they agree. " +
  "Every applied change returns a batch_id that undo_batch can revert.";

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

export async function POST(request: Request, { params }: { params: Promise<{ token?: string[] }> }) {
  const { token: path } = await params;
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const member = await memberForToken(bearer ?? path?.at(-1) ?? "");
  if (!member) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Invalid or revoked OrbitBOM token. Make a new one on your profile page." } },
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
          serverInfo: { name: "orbitbom", title: "OrbitBOM (Team 1690)", version: "1.0.0" },
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
