/**
 * Adobe Experience Platform Tags (Launch) — MCP Server (stdio transport)
 * This is the stdio entry point used by Claude Desktop, Cursor, Kiro, etc.
 * Run: node src/index.js
 */

import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "./mcp-server.js";

const DEBUG = process.env.DEBUG === "true" || process.env.DEBUG === "1";

const REQUIRED_ENV = ["CLIENT_ID", "CLIENT_SECRET", "ORG_ID"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[ERROR] Missing required env vars: ${missing.join(", ")}`);
  console.error("Set them in .env or pass via the mcpServers env block in your AI client config.");
  process.exit(1);
}

console.error("━".repeat(60));
console.error("Adobe Launch MCP Server — stdio transport");
console.error(`  CLIENT_ID : ${process.env.CLIENT_ID?.slice(0, 8)}...`);
console.error(`  ORG_ID    : ${process.env.ORG_ID}`);
console.error(`  DEBUG     : ${DEBUG}`);
console.error(`  Tools     : 74`);
console.error("━".repeat(60));

const server = await buildMcpServer({
  clientId:     process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  orgId:        process.env.ORG_ID,
});
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("🚀 Adobe Launch MCP server running on stdio — ready for tool calls");
