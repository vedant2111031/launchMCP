/**
 * MCP Server Factory - Creates server instances with custom credentials
 * This is a simplified wrapper that reuses the full tool definitions from mcp-server.js
 */

import axios from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DEBUG = process.env.DEBUG === "true" || process.env.DEBUG === "1";

const dbg = {
  info: (...a) => console.error("[MCP]", ...a),
  verbose: (...a) => { if (DEBUG) console.error("[MCP:verbose]", ...a); },
  error: (...a) => console.error("[MCP:ERROR]", ...a),
  http: (method, url, status, ms) =>
    console.error(`[MCP:HTTP] ${method.toUpperCase()} ${url} → ${status} (${ms}ms)`),
};

/**
 * Create an MCP server instance with user-specific credentials
 * @param {Object} credentials - User's Adobe credentials
 * @returns {Promise<McpServer>} Configured MCP server instance
 */
export async function createMcpServerInstance(credentials) {
  const { clientId, clientSecret, orgId } = credentials;

  if (!clientId || !clientSecret || !orgId) {
    throw new Error("Missing required credentials");
  }

  const SCOPES = "AdobeID,openid,read_organizations,additional_info.job_function,additional_info.projectedProductContext,additional_info.roles";
  const REACTOR_BASE = "https://reactor.adobe.io";
  const IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";

  // Token cache for this specific user
  let _tokenCache = { token: null, expiresAt: 0 };

  async function getAccessToken() {
    const now = Date.now();
    if (_tokenCache.token && now < _tokenCache.expiresAt - 60_000) {
      const remainSec = Math.round((_tokenCache.expiresAt - now) / 1000);
      dbg.verbose(`Token cache hit — expires in ${remainSec}s`);
      return _tokenCache.token;
    }

    dbg.info("🔑 Fetching new Adobe IMS access token...");
    const t0 = Date.now();
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: SCOPES,
    });

    try {
      const res = await axios.post(IMS_TOKEN_URL, params.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      _tokenCache = {
        token: res.data.access_token,
        expiresAt: now + res.data.expires_in * 1000,
      };

      try {
        const payload = JSON.parse(Buffer.from(res.data.access_token.split(".")[1], "base64").toString());
        dbg.info(`✅ Token acquired in ${Date.now() - t0}ms`);
        dbg.verbose(`   scope     : ${payload.scope}`);
        dbg.verbose(`   client_id : ${payload.client_id}`);
        dbg.verbose(`   expires   : ${Math.round(res.data.expires_in / 3600)}h`);
      } catch { /* JWT decode is best-effort */ }

      return _tokenCache.token;
    } catch (err) {
      dbg.error(`IMS token fetch failed:`, err.response?.data || err.message);
      throw err;
    }
  }

  async function reactor(method, path, data = null, params = {}) {
    const token = await getAccessToken();
    const url = `${REACTOR_BASE}${path}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "x-api-key": clientId,
      "x-gw-ims-org-id": orgId,
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json;revision=1",
    };

    dbg.verbose(`→ ${method.toUpperCase()} ${path}`);

    const t0 = Date.now();
    try {
      const res = await axios({ method, url, headers, data, params });
      const ms = Date.now() - t0;
      dbg.http(method, path, res.status, ms);
      return res.data;
    } catch (err) {
      const ms = Date.now() - t0;
      const status = err.response?.status || "ERR";
      const body = err.response?.data;
      dbg.http(method, path, status, ms);

      if (body?.errors) {
        const msgs = body.errors.map((e) => `[${e.status}] ${e.title}: ${e.code}`).join("; ");
        throw new Error(`Reactor API ${status}: ${msgs}`);
      }
      throw new Error(body ? JSON.stringify(body) : err.message);
    }
  }

  // Import and register all tools from the main mcp-server file
  // For now, we'll dynamically import the tool registration
  const { registerAllTools } = await import("./mcp-tools.js");
  
  const server = new McpServer({
    name: "adobe-launch-mcp",
    version: "2.0.0",
  });

  // Register all 74 tools with this server instance
  await registerAllTools(server, reactor, dbg);

  return server;
}
