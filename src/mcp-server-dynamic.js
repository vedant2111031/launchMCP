/**
 * Adobe Launch MCP — Dynamic server factory (credential injection)
 * Thin wrapper around buildMcpServer() for the multi-user config server.
 * All 74 tools come from mcp-server.js.
 */
export { buildMcpServer as buildMcpServerWithCredentials } from "./mcp-server.js";
