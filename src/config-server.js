/**
 * Adobe Launch MCP — Multi-User Configuration & HTTP Server
 *
 * Flow:
 *   1. User visits  GET /          → config UI (enter Adobe credentials)
 *   2. User POSTs   POST /api/config → credentials validated, session created
 *   3. User gets    MCP URL: https://<host>/mcp/<sessionId>
 *   4. User pastes that URL into Claude.ai → Settings → Connectors → + → Create app
 *
 * Each session runs a real MCP SDK StreamableHTTPServerTransport so Claude's
 * Connectors feature (and any other MCP client) works out of the box.
 */

import "dotenv/config";
import express from "express";
import { randomUUID } from "crypto";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServerWithCredentials } from "./mcp-server-dynamic.js";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || "4000", 10);
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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, X-Session-Id, Authorization");
    res.setHeader("Access-Control-Expose-Headers","Mcp-Session-Id, X-Session-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ─── Session store ────────────────────────────────────────────────────────────
// userSessionId -> { transport, server, orgId, createdAt, lastAccess, mcpSessions: Map }
const userSessions = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getBaseUrl(req) {
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  return `${proto}://${req.get("host")}`;
}

async function validateAdobeCredentials(clientId, clientSecret, orgId) {
  const IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";
  const SCOPES = "AdobeID,openid,read_organizations,additional_info.job_function,additional_info.projectedProductContext,additional_info.roles";
  try {
    const params = new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     clientId,
      client_secret: clientSecret,
      scope:         SCOPES,
    });
    const res = await axios.post(IMS_TOKEN_URL, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000,
    });
    if (!res.data.access_token) return { valid: false, error: "No access token received" };
    const payload = JSON.parse(Buffer.from(res.data.access_token.split(".")[1], "base64").toString());
    return {
      valid: true,
      hasReactorScope: !!payload.scope?.includes("reactor"),
    };
  } catch (err) {
    return { valid: false, error: err.response?.data?.error_description || err.message };
  }
}

// ─── Static UI ────────────────────────────────────────────────────────────────
app.get("/",        (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "config.html")));
app.get("/config",  (_req, res) => res.redirect("/"));
app.get("/style.css", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "style.css")));
app.get("/app.js",    (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "app.js")));

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({
  status: "ok",
  activeSessions: userSessions.size,
  timestamp: new Date().toISOString(),
}));

// ─── Registration store ───────────────────────────────────────────────────────
// Stored in registrations.json next to the server file (persists across restarts)
const REG_FILE = path.join(__dirname, "..", "registrations.json");

function loadRegistrations() {
  try {
    if (fs.existsSync(REG_FILE)) return JSON.parse(fs.readFileSync(REG_FILE, "utf8"));
  } catch {}
  return [];
}

function saveRegistration(entry) {
  const list = loadRegistrations();
  list.push(entry);
  try { fs.writeFileSync(REG_FILE, JSON.stringify(list, null, 2)); } catch (e) {
    console.error("[REG] Could not write registrations.json:", e.message);
  }
}

// ─── POST /api/register — collect user info ───────────────────────────────────
app.post("/api/register", (req, res) => {
  const { name, email, company, title, useCase, description, source } = req.body;

  if (!name || !email || !company || !useCase || !description) {
    return res.status(400).json({ error: "All required fields must be filled." });
  }

  const entry = {
    id:          randomUUID(),
    name,
    email,
    company,
    title:       title || "",
    useCase,
    description,
    source:      source || "",
    ip:          req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown",
    userAgent:   req.headers["user-agent"] || "",
    registeredAt: new Date().toISOString(),
  };

  saveRegistration(entry);
  console.log(`[REG] New registration: ${name} <${email}> — ${company} (${useCase})`);

  res.json({ success: true, message: "Registration recorded." });
});

// ─── GET /api/registrations — view all registrations (admin) ─────────────────
app.get("/api/registrations", (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (adminKey && req.headers["x-admin-key"] !== adminKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.json(loadRegistrations());
});


app.get("/api/config/status", (req, res) => {
  const sessionId = req.headers["x-session-id"];
  if (sessionId && userSessions.has(sessionId)) {
    return res.json({
      configured: true,
      mcpUrl: `${getBaseUrl(req)}/mcp/${sessionId}`,
    });
  }
  res.json({ configured: false });
});

// ─── POST /api/config — validate credentials & create session ─────────────────
app.post("/api/config", async (req, res) => {
  const { clientId, clientSecret, orgId, password } = req.body;

  // ── Password gate ──────────────────────────────────────────────────────────
  const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;
  if (ACCESS_PASSWORD) {
    if (!password) {
      return res.status(401).json({ error: "Access password is required." });
    }
    if (password !== ACCESS_PASSWORD) {
      console.log(`[AUTH] Wrong password attempt from ${req.headers["x-forwarded-for"] || req.socket.remoteAddress}`);
      return res.status(401).json({ error: "Incorrect access password. Please contact the admin." });
    }
  }

  if (!clientId || !clientSecret || !orgId) {
    return res.status(400).json({ error: "All fields are required" });
  }
  if (!orgId.includes("@AdobeOrg")) {
    return res.status(400).json({ error: "Organization ID must be in format: YOUR_ORG_ID@AdobeOrg" });
  }

  console.log(`[CONFIG] Validating credentials for org: ${orgId}`);
  const validation = await validateAdobeCredentials(clientId, clientSecret, orgId);
  if (!validation.valid) {
    return res.status(401).json({ error: `Adobe authentication failed: ${validation.error}` });
  }

  const sessionId = randomUUID();

  try {
    // Build a real MCP server with these credentials
    const server = await buildMcpServerWithCredentials({ clientId, clientSecret, orgId });

    userSessions.set(sessionId, {
      orgId,
      _credentials: { clientId, clientSecret, orgId },
      server,
      mcpSessions: new Map(), // inner MCP SDK sessions keyed by mcp-session-id
      createdAt:  new Date(),
      lastAccess: new Date(),
    });

    // Auto-cleanup after 24 h of inactivity
    setTimeout(() => {
      const s = userSessions.get(sessionId);
      if (s && (Date.now() - s.lastAccess.getTime()) >= 24 * 60 * 60 * 1000) {
        console.log(`[CLEANUP] Removing inactive session: ${sessionId}`);
        userSessions.delete(sessionId);
      }
    }, 24 * 60 * 60 * 1000);

    const mcpUrl = `${getBaseUrl(req)}/mcp/${sessionId}`;
    console.log(`[CONFIG] ✅ Session created: ${sessionId.slice(0, 8)}... → ${mcpUrl}`);

    res.json({
      success: true,
      sessionId,
      mcpUrl,
      message: "Configuration successful! Copy the MCP URL and add it to Claude → Settings → Connectors.",
      warning: validation.hasReactorScope
        ? null
        : "Token scope does not include 'reactor'. Add 'Experience Platform Launch API' in Adobe Developer Console.",
    });
  } catch (err) {
    console.error("[CONFIG] Error creating MCP server:", err.message);
    res.status(500).json({ error: "Failed to initialize MCP server. Please try again." });
  }
});

// ─── MCP endpoint — per-user session routing ──────────────────────────────────
// Claude.ai Connectors will POST to: https://<host>/mcp/<sessionId>
app.all("/mcp/:userSessionId", async (req, res) => {
  const { userSessionId } = req.params;
  const userSession = userSessions.get(userSessionId);

  if (!userSession) {
    return res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Session not found. Please configure your credentials at the root URL." },
      id: null,
    });
  }

  userSession.lastAccess = new Date();
  const mcpSessionId = req.headers["mcp-session-id"];
  console.log(`[MCP] ${req.method} /mcp/${userSessionId.slice(0, 8)}... sdk-session=${mcpSessionId || "new"}`);

  try {
    let transport;

    if (mcpSessionId && userSession.mcpSessions.has(mcpSessionId)) {
      // Reuse existing SDK transport for this MCP session
      transport = userSession.mcpSessions.get(mcpSessionId);
    } else if (!mcpSessionId && req.method === "POST") {
      // New MCP session — create a fresh transport and connect the server
      const newMcpId = randomUUID();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newMcpId,
        onsessioninitialized: (id) => {
          console.log(`[MCP] SDK session initialized: ${id}`);
          userSession.mcpSessions.set(id, transport);
        },
      });
      transport.onclose = () => {
        console.log(`[MCP] SDK session closed: ${newMcpId}`);
        userSession.mcpSessions.delete(newMcpId);
      };
      // Each MCP session gets its own server connection
      const server = await buildMcpServerWithCredentials(
        // Re-use the same credentials — pull them from the already-built server's closure
        // by building a fresh server (cheap, no network call until first tool use)
        userSession._credentials
      );
      await server.connect(transport);
    } else if (req.method === "DELETE" && mcpSessionId) {
      const t = userSession.mcpSessions.get(mcpSessionId);
      if (t) { await t.close(); userSession.mcpSessions.delete(mcpSessionId); }
      return res.sendStatus(204);
    } else {
      return res.status(400).json({ error: "Bad request: missing or invalid MCP session" });
    }

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[MCP] Error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ─── Delete user session ──────────────────────────────────────────────────────
app.delete("/api/session/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  if (userSessions.has(sessionId)) {
    userSessions.delete(sessionId);
    console.log(`[SESSION] Deleted: ${sessionId}`);
    return res.json({ success: true });
  }
  res.status(404).json({ error: "Session not found" });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("=".repeat(70));
  console.log("  🚀 Adobe Launch MCP — Multi-User Server");
  console.log("=".repeat(70));
  console.log(`  Config UI  : http://localhost:${PORT}/`);
  console.log(`  Health     : http://localhost:${PORT}/health`);
  console.log(`  MCP URL    : http://localhost:${PORT}/mcp/<sessionId>`);
  console.log(`  Tools      : 74`);
  console.log("=".repeat(70));
  console.log("  Claude.ai integration:");
  console.log("  1. Open the Config UI and enter your Adobe credentials");
  console.log("  2. Copy the generated MCP URL");
  console.log("  3. Claude.ai → Settings → Connectors → + → Create app");
  console.log("  4. Paste the MCP URL and save");
  console.log("=".repeat(70));
});
