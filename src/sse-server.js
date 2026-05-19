/**
 * Adobe Launch MCP — SSE Transport (port 4001)
 * Legacy transport for clients that use SSE (older Claude Desktop, etc.)
 *
 * Connect: { "url": "http://localhost:4001/sse" }
 */
import "dotenv/config";
import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { buildMcpServer } from "./mcp-server.js";

const PORT = parseInt(process.env.MCP_SSE_PORT || "4001", 10);
const app  = express();
app.use(express.json());

// CORS
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// One SSE transport per session
const transports = new Map();

app.get("/sse", async (req, res) => {
  console.log("[SSE] New client connected");
  const transport = new SSEServerTransport("/messages", res);
  const server    = await buildMcpServer();
  transports.set(transport.sessionId, transport);
  res.on("close", () => { transports.delete(transport.sessionId); console.log("[SSE] Client disconnected"); });
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId  = req.query.sessionId;
  const transport  = transports.get(sessionId);
  if (!transport) return res.status(404).json({ error: "Session not found" });
  await transport.handlePostMessage(req, res);
});

app.get("/health", (_req, res) => res.json({ status: "ok", transport: "sse", timestamp: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log("  Adobe Launch MCP — SSE Transport (legacy)");
  console.log("=".repeat(60));
  console.log(`  SSE endpoint : http://localhost:${PORT}/sse`);
  console.log(`  Tools        : 74`);
  console.log("=".repeat(60));
  console.log("  Connect: { \"url\": \"http://localhost:" + PORT + "/sse\" }");
  console.log("=".repeat(60));
});
