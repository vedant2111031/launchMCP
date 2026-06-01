/**
 * MCP Server Factory - Creates server instances with custom credentials
 * Thin wrapper around buildMcpServer() — kept for backwards compatibility.
 */
export { buildMcpServer as createMcpServerInstance } from "./mcp-server.js";
