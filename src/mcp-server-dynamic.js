/**
 * Adobe Experience Platform Tags (Launch) — Dynamic MCP Server Factory
 * Creates MCP server instances with user-provided credentials
 * Used by the multi-user configuration server
 */

import axios from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const DEBUG = process.env.DEBUG === "true" || process.env.DEBUG === "1";

const dbg = {
  info: (...a) => console.error("[MCP]", ...a),
  verbose: (...a) => { if (DEBUG) console.error("[MCP:verbose]", ...a); },
  error: (...a) => console.error("[MCP:ERROR]", ...a),
  http: (method, url, status, ms) =>
    console.error(`[MCP:HTTP] ${method.toUpperCase()} ${url} → ${status} (${ms}ms)`),
};

/**
 * Build MCP server with user-specific credentials
 * @param {Object} credentials - User's Adobe credentials
 * @param {string} credentials.clientId - Adobe OAuth client ID
 * @param {string} credentials.clientSecret - Adobe OAuth client secret
 * @param {string} credentials.orgId - Adobe organization ID
 */
export async function buildMcpServerWithCredentials(credentials) {
  const { clientId, clientSecret, orgId } = credentials;

  if (!clientId || !clientSecret || !orgId) {
    throw new Error("Missing required credentials: clientId, clientSecret, orgId");
  }

  const SCOPES = "AdobeID,openid,read_organizations,additional_info.job_function,additional_info.projectedProductContext,additional_info.roles";
  const REACTOR_BASE = "https://reactor.adobe.io";
  const IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";

  // Token cache for this user
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
        dbg.info(`   scope     : ${payload.scope}`);
        dbg.info(`   client_id : ${payload.client_id}`);
        dbg.info(`   expires   : ${Math.round(res.data.expires_in / 3600)}h`);
        if (!payload.scope?.includes("reactor")) {
          dbg.error("⚠️  WARNING: Token scope does NOT include 'reactor'.");
          dbg.error("   Reactor API calls will return 403 api-key-invalid.");
          dbg.error("   Fix: Add 'Experience Platform Launch API' to your credential");
          dbg.error("   at https://developer.adobe.com/console");
        }
      } catch { /* JWT decode is best-effort */ }

      return _tokenCache.token;
    } catch (err) {
      dbg.error(`IMS token fetch failed in ${Date.now() - t0}ms:`, err.response?.data || err.message);
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

    dbg.verbose(`→ ${method.toUpperCase()} ${path}`, params && Object.keys(params).length ? params : "");
    if (data && DEBUG) dbg.verbose("  body:", JSON.stringify(data).slice(0, 300));

    const t0 = Date.now();
    try {
      const res = await axios({ method, url, headers, data, params });
      const ms = Date.now() - t0;
      dbg.http(method, path, res.status, ms);

      const d = res.data?.data;
      if (Array.isArray(d)) dbg.verbose(`  ← ${d.length} items`);
      else if (d?.id) dbg.verbose(`  ← id: ${d.id} type: ${d.type}`);

      return res.data;
    } catch (err) {
      const ms = Date.now() - t0;
      const status = err.response?.status || "ERR";
      const body = err.response?.data;
      dbg.http(method, path, status, ms);

      if (body?.errors) {
        const msgs = body.errors.map((e) => `[${e.status}] ${e.title}: ${e.code}`).join("; ");
        dbg.error(`Reactor error on ${method.toUpperCase()} ${path}: ${msgs}`);
        throw new Error(`Reactor API ${status}: ${msgs}`);
      }
      dbg.error(`Reactor error on ${method.toUpperCase()} ${path}:`, body || err.message);
      throw new Error(body ? JSON.stringify(body) : err.message);
    }
  }

  // Import the full tool definitions from the original mcp-server.js
  // For now, we'll inline a simplified version. In production, you'd want to
  // refactor mcp-server.js to export the tool registration function
  
  const server = new McpServer({
    name: "adobe-launch-mcp",
    version: "2.0.0",
  });

  let _toolCallCount = 0;

  function tool(name, description, schema, handler) {
    server.tool(name, description, schema, async (args) => {
      const callId = ++_toolCallCount;
      const t0 = Date.now();
      dbg.info(`┌─ [#${callId}] Tool: ${name}`);
      dbg.verbose(`   args: ${JSON.stringify(args).slice(0, 200)}`);
      try {
        const result = await handler(args);
        const ms = Date.now() - t0;
        const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        dbg.info(`└─ [#${callId}] ${name} ✅ (${ms}ms) → ${text.slice(0, 80).replace(/\n/g, " ")}...`);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const ms = Date.now() - t0;
        dbg.error(`└─ [#${callId}] ${name} ❌ (${ms}ms): ${err.message}`);
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    });
  }

  // Register all 74 tools (importing from original file would be cleaner)
  // For brevity, I'll include a few key tools. You should import all from mcp-server.js

  tool("list_companies", "List all Adobe IMS organizations/companies accessible to this credential", {}, async () => {
    return reactor("GET", "/companies");
  });

  tool("list_properties", "List all tag properties for a company", {
    company_id: z.string().describe("Company ID from list_companies"),
    page_size: z.number().optional().describe("Results per page (default 25)"),
  }, async ({ company_id, page_size }) => {
    return reactor("GET", `/companies/${company_id}/properties`, null, {
      "page[size]": page_size || 25,
    });
  });

  // ... (Include all other 72 tools from mcp-server.js)
  // For production, refactor mcp-server.js to export a registerTools(server, reactor) function

  return server;
}
