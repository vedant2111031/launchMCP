/**
 * Adobe Launch MCP — Configuration & Multi-User HTTP Server
 * Allows users to configure their own Adobe credentials via web interface
 * Each user gets a unique session with their own credentials
 */
import "dotenv/config";
import express from "express";
import { randomUUID } from "crypto";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || process.env.MCP_HTTP_PORT || "4000", 10);
const app = express();

app.use(express.json());

// Serve config.html as the main page, not the entire public directory
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "config.html"));
});

// Serve static assets (CSS, JS) but not index.html
app.get("/config.css", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "style.css"));
});

app.get("/config.js", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "app.js"));
});

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const allowed = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
    : [];
  const origin = req.headers.origin;
  if (!origin || allowed.length === 0 || allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Session-Id, Authorization");
    res.setHeader("Access-Control-Expose-Headers", "X-Session-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ─── User Sessions Store ──────────────────────────────────────────────────────
// sessionId -> { clientId, clientSecret, orgId, mcpServer, transport, createdAt }
const userSessions = new Map();

// ─── Helper: Validate Adobe Credentials ──────────────────────────────────────
async function validateAdobeCredentials(clientId, clientSecret, orgId) {
  const IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";
  const SCOPES = "AdobeID,openid,read_organizations,additional_info.job_function,additional_info.projectedProductContext,additional_info.roles";

  try {
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: SCOPES,
    });

    const res = await axios.post(IMS_TOKEN_URL, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000,
    });

    if (res.data.access_token) {
      // Decode JWT to check scope
      const payload = JSON.parse(
        Buffer.from(res.data.access_token.split(".")[1], "base64").toString()
      );
      
      return {
        valid: true,
        token: res.data.access_token,
        expiresIn: res.data.expires_in,
        scope: payload.scope,
        hasReactorScope: payload.scope?.includes("reactor") || false,
      };
    }
    return { valid: false, error: "No access token received" };
  } catch (err) {
    console.error("Credential validation failed:", err.response?.data || err.message);
    return {
      valid: false,
      error: err.response?.data?.error_description || err.message,
    };
  }
}

// ─── Helper: Create MCP Server Instance for User ─────────────────────────────
async function createUserMcpServer(sessionId, credentials) {
  // For simplicity, we'll use the existing mcp-server.js by temporarily setting env vars
  // In production, you'd want to refactor mcp-server.js to accept credentials as parameters
  
  // Store original env vars
  const originalEnv = {
    CLIENT_ID: process.env.CLIENT_ID,
    CLIENT_SECRET: process.env.CLIENT_SECRET,
    ORG_ID: process.env.ORG_ID,
  };

  // Set user's credentials temporarily
  process.env.CLIENT_ID = credentials.clientId;
  process.env.CLIENT_SECRET = credentials.clientSecret;
  process.env.ORG_ID = credentials.orgId;
  process.env.SKIP_ENV_VALIDATION = "true";

  try {
    // Import fresh instance
    const { buildMcpServer } = await import(`./mcp-server.js?t=${Date.now()}`);
    
    const server = await buildMcpServer();
    
    console.log(`[MCP] ✅ Adobe Launch MCP server instance created with 74 tools`);
    
    return { server };
  } finally {
    // Restore original env vars
    Object.keys(originalEnv).forEach(key => {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    });
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Serve config.html as the main page, not the entire public directory
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "config.html"));
});

// Serve static assets (CSS, JS) but not index.html
app.get("/config.css", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "style.css"));
});

app.get("/config.js", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "app.js"));
});

// Redirect /config to main page
app.get("/config", (_req, res) => {
  res.redirect("/");
});

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    activeSessions: userSessions.size,
    timestamp: new Date().toISOString(),
  });
});

// Check configuration status
app.get("/api/config/status", (req, res) => {
  const sessionId = req.headers["x-session-id"];
  
  if (sessionId && userSessions.has(sessionId)) {
    // Detect protocol - use HTTPS if behind a proxy (like Render)
    const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
    const baseUrl = `${protocol}://${req.get("host")}`;
    return res.json({
      configured: true,
      mcpUrl: `${baseUrl}/mcp/${sessionId}`,
    });
  }

  res.json({ configured: false });
});

// Configure credentials and create session
app.post("/api/config", async (req, res) => {
  const { clientId, clientSecret, orgId } = req.body;

  if (!clientId || !clientSecret || !orgId) {
    return res.status(400).json({ error: "All fields are required" });
  }

  if (!orgId.includes("@AdobeOrg")) {
    return res.status(400).json({
      error: "Organization ID must be in format: YOUR_ORG_ID@AdobeOrg",
    });
  }

  console.log(`[CONFIG] Validating credentials for org: ${orgId}`);

  // Validate credentials with Adobe
  const validation = await validateAdobeCredentials(clientId, clientSecret, orgId);

  if (!validation.valid) {
    return res.status(401).json({
      error: `Adobe authentication failed: ${validation.error}`,
    });
  }

  if (!validation.hasReactorScope) {
    console.warn(`[CONFIG] Warning: Token does not include 'reactor' scope`);
  }

  // Create new session
  const sessionId = randomUUID();
  const credentials = { clientId, clientSecret, orgId };

  try {
    const { server } = await createUserMcpServer(sessionId, credentials);

    userSessions.set(sessionId, {
      ...credentials,
      server,
      createdAt: new Date(),
      lastAccess: new Date(),
    });

    // Auto-cleanup after 24 hours of inactivity
    setTimeout(() => {
      const session = userSessions.get(sessionId);
      if (session) {
        const inactiveHours = (Date.now() - session.lastAccess.getTime()) / (1000 * 60 * 60);
        if (inactiveHours >= 24) {
          console.log(`[CLEANUP] Removing inactive session: ${sessionId}`);
          userSessions.delete(sessionId);
        }
      }
    }, 24 * 60 * 60 * 1000);

    // Detect protocol - use HTTPS if behind a proxy (like Render)
    const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
    const baseUrl = `${protocol}://${req.get("host")}`;
    const mcpUrl = `${baseUrl}/mcp/${sessionId}`;

    console.log(`[CONFIG] ✅ Session created: ${sessionId}`);
    console.log(`[CONFIG] MCP URL: ${mcpUrl}`);

    res.json({
      success: true,
      sessionId,
      mcpUrl,
      message: "Configuration successful! Use the MCP URL to connect your AI assistant.",
      warning: validation.hasReactorScope
        ? null
        : "Token scope does not include 'reactor'. Add 'Experience Platform Launch API' in Adobe Developer Console.",
    });
  } catch (err) {
    console.error("[CONFIG] Error creating MCP server:", err);
    res.status(500).json({
      error: "Failed to initialize MCP server. Please try again.",
    });
  }
});

// MCP endpoint with session routing
app.all("/mcp/:sessionId", async (req, res) => {
  const { sessionId } = req.params;

  if (!userSessions.has(sessionId)) {
    return res.status(404).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Session not found. Please configure your credentials first.",
      },
      id: null,
    });
  }

  const session = userSessions.get(sessionId);
  session.lastAccess = new Date();

  console.log(`[MCP] ${req.method} /mcp/${sessionId.slice(0, 8)}...`);

  try {
    // Handle JSON-RPC request directly
    const request = req.body;
    
    if (!request || !request.method) {
      return res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Invalid Request: missing method",
        },
        id: request?.id || null,
      });
    }

    // Handle different MCP methods
    if (request.method === "tools/list") {
      // Get list of tools from the server
      const tools = Array.from(session.server._tools.values()).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

      return res.json({
        jsonrpc: "2.0",
        result: { tools },
        id: request.id,
      });
    } else if (request.method === "tools/call") {
      // Call a specific tool
      const { name, arguments: args } = request.params || {};
      
      if (!name) {
        return res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32602,
            message: "Invalid params: missing tool name",
          },
          id: request.id,
        });
      }

      const tool = session.server._tools.get(name);
      if (!tool) {
        return res.status(404).json({
          jsonrpc: "2.0",
          error: {
            code: -32601,
            message: `Tool not found: ${name}`,
          },
          id: request.id,
        });
      }

      // Execute the tool
      const result = await tool.handler(args || {});
      
      return res.json({
        jsonrpc: "2.0",
        result,
        id: request.id,
      });
    } else if (request.method === "initialize") {
      // Handle initialization
      return res.json({
        jsonrpc: "2.0",
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "adobe-launch-mcp",
            version: "2.0.0",
          },
        },
        id: request.id,
      });
    } else {
      return res.status(501).json({
        jsonrpc: "2.0",
        error: {
          code: -32601,
          message: `Method not implemented: ${request.method}`,
        },
        id: request.id,
      });
    }
  } catch (err) {
    console.error(`[MCP] Error handling request:`, err.message);
    return res.status(500).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: err.message,
      },
      id: req.body?.id || null,
    });
  }
});

// Delete session
app.delete("/api/session/:sessionId", (req, res) => {
  const { sessionId } = req.params;

  if (userSessions.has(sessionId)) {
    userSessions.delete(sessionId);
    console.log(`[SESSION] Deleted: ${sessionId}`);
    return res.json({ success: true, message: "Session deleted" });
  }

  res.status(404).json({ error: "Session not found" });
});

// List active sessions (admin endpoint - optional)
app.get("/api/sessions", (_req, res) => {
  const sessions = Array.from(userSessions.entries()).map(([id, session]) => ({
    sessionId: id,
    orgId: session.orgId,
    createdAt: session.createdAt,
    lastAccess: session.lastAccess,
  }));

  res.json({ count: sessions.length, sessions });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("=".repeat(70));
  console.log("  🚀 Adobe Launch MCP — Multi-User Configuration Server");
  console.log("=".repeat(70));
  console.log(`  Configuration UI : http://localhost:${PORT}/`);
  console.log(`  Health Check     : http://localhost:${PORT}/health`);
  console.log(`  MCP Endpoint     : http://localhost:${PORT}/mcp/{sessionId}`);
  console.log(`  Tools Available  : 74`);
  console.log("=".repeat(70));
  console.log("  📋 Instructions:");
  console.log("  1. Open the configuration UI in your browser");
  console.log("  2. Enter your Adobe credentials");
  console.log("  3. Copy the generated MCP URL");
  console.log("  4. Add it to your AI assistant's MCP configuration");
  console.log("=".repeat(70));
});
