/**
 * Adobe Launch MCP — Streamable HTTP Transport (port 4000)
 *
 * Connect any MCP-compatible AI client via URL:
 *   http://localhost:4000/mcp
 *
 * Claude Desktop:  { "url": "http://localhost:4000/mcp" }
 * Cursor:          { "url": "http://localhost:4000/mcp" }
 * Kiro:            { "url": "http://localhost:4000/mcp" }
 * Windsurf:        { "serverUrl": "http://localhost:4000/mcp" }
 * MCP Inspector:   npx @modelcontextprotocol/inspector --transport http --url http://localhost:4000/mcp
 */
import "dotenv/config";
import express from "express";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "./mcp-server.js";

const PORT = parseInt(process.env.MCP_HTTP_PORT || "4000", 10);
const app  = express();
app.use(express.json());

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const allowed = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
    : [];
  const origin = req.headers.origin;
  if (!origin || allowed.length === 0 || allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin",  origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, Authorization");
    res.setHeader("Access-Control-Expose-Headers","Mcp-Session-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ─── Session store ────────────────────────────────────────────────────────────
const sessions = new Map(); // sessionId -> { transport, server }

// ─── Health / info ────────────────────────────────────────────────────────────
app.get("/", (_req, res) => res.json({
  name: "adobe-launch-mcp", version: "2.0.0",
  transport: "streamable-http",
  mcp_endpoint: `http://localhost:${PORT}/mcp`,
  tools: 74, status: "ok",
}));

app.get("/health", (_req, res) => res.json({
  status: "ok", sessions: sessions.size, timestamp: new Date().toISOString()
}));

// ─── MCP endpoint ─────────────────────────────────────────────────────────────
app.all("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  console.log(`[HTTP] ${req.method} /mcp session=${sessionId || "new"}`);

  try {
    let transport;

    if (sessionId && sessions.has(sessionId)) {
      // Existing session
      transport = sessions.get(sessionId).transport;
    } else if (!sessionId && req.method === "POST") {
      // New session — initialize
      const newId = randomUUID();
      transport   = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newId,
        onsessioninitialized: (id) => {
          console.log(`[HTTP] Session initialized: ${id}`);
          sessions.set(id, { transport });
        },
      });
      transport.onclose = () => {
        console.log(`[HTTP] Session closed: ${newId}`);
        sessions.delete(newId);
      };
      const server = await buildMcpServer();
      await server.connect(transport);
    } else if (req.method === "DELETE" && sessionId) {
      // Client ending session
      const entry = sessions.get(sessionId);
      if (entry) { await entry.transport.close(); sessions.delete(sessionId); }
      return res.sendStatus(204);
    } else {
      return res.status(400).json({ error: "Bad request: missing or invalid session" });
    }

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[HTTP] Error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("=".repeat(62));
  console.log("  Adobe Launch MCP — Streamable HTTP Transport");
  console.log("=".repeat(62));
  console.log(`  MCP endpoint : http://localhost:${PORT}/mcp`);
  console.log(`  Health       : http://localhost:${PORT}/health`);
  console.log(`  Tools        : 74`);
  console.log("=".repeat(62));
  console.log("  Claude Desktop / Cursor / Kiro / Windsurf:");
  console.log(`    { "url": "http://localhost:${PORT}/mcp" }`);
  console.log("  MCP Inspector:");
  console.log(`    npx @modelcontextprotocol/inspector --transport http --url http://localhost:${PORT}/mcp`);
  console.log("=".repeat(62));
});
