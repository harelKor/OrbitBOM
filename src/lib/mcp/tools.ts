// The MCP tools (plan §6), one file per area in toolsets/: each registers its tools with the
// registry (registry.ts: read / write, the preview-then-confirm flow, listTools and callTool).
// Importing them here, in this order, is what puts them in the tool list.
import "./toolsets/reference";
import "./toolsets/parts";
import "./toolsets/review";
import "./toolsets/inventory";
import "./toolsets/drawings";
import "./toolsets/cots";
import "./toolsets/cadReview";
import "./toolsets/assembly";

export { ToolError, callTool, listTools } from "./registry";
