/**
 * Express API server — bridges the Web UI ↔ MCP server ↔ Gemini
 * Runs on http://localhost:3000
 *
 * Debug levels:
 *   default  — startup, every request, every tool call, every Gemini round-trip
 *   DEBUG=true — full request/response bodies, history sizes, timing breakdowns
 */

import "dotenv/config";
import express from "express";
import { fileURLToPath } from "url";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_PATH = path.resolve(__dirname, "../src/index.js");
const DEBUG = process.env.DEBUG === "true" || process.env.DEBUG === "1";

// ─── Debug logger ─────────────────────────────────────────────────────────────

const log = {
  info:    (...a) => console.log("[API]", ...a),
  debug:   (...a) => { if (DEBUG) console.log("[API:debug]", ...a); },
  warn:    (...a) => console.warn("[API:warn]", ...a),
  error:   (...a) => console.error("[API:ERROR]", ...a),
  gemini:  (...a) => console.log("[Gemini]", ...a),
  mcp:     (...a) => console.log("[MCP]", ...a),
  http:    (method, path, status, ms) => console.log(`[HTTP] ${method} ${path} ${status} (${ms}ms)`),
  sep:     ()     => console.log("─".repeat(60)),
};

// ─── Validate env ─────────────────────────────────────────────────────────────

const REQUIRED = ["CLIENT_ID", "CLIENT_SECRET", "ORG_ID", "GEMINI_API_KEY"];
const missing  = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  log.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

log.info("━".repeat(60));
log.info("Adobe Launch MCP — Web API Server");
log.info(`  CLIENT_ID      : ${process.env.CLIENT_ID?.slice(0, 8)}...`);
log.info(`  ORG_ID         : ${process.env.ORG_ID}`);
log.info(`  GEMINI_API_KEY : ${process.env.GEMINI_API_KEY?.slice(0, 8)}...`);
log.info(`  DEBUG          : ${DEBUG}`);
log.info("━".repeat(60));

// ─── Direct Reactor API layer (bypasses Gemini entirely) ─────────────────────
// These are read-only / browse operations that don't need AI interpretation.

import axios from "axios";

const REACTOR_BASE  = "https://reactor.adobe.io";
const IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";

let _tokenCache = { token: null, expiresAt: 0 };

async function getToken() {
  const now = Date.now();
  if (_tokenCache.token && now < _tokenCache.expiresAt - 60_000) return _tokenCache.token;
  log.info("[Direct] Refreshing Adobe IMS token...");
  const params = new URLSearchParams({
    grant_type:    "client_credentials",
    client_id:     process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    scope:         process.env.SCOPES || "AdobeID,openid,read_organizations,additional_info.job_function,additional_info.projectedProductContext,additional_info.roles",
  });
  const res = await axios.post(IMS_TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  _tokenCache = { token: res.data.access_token, expiresAt: now + res.data.expires_in * 1000 };
  log.info("[Direct] Token acquired");
  return _tokenCache.token;
}

async function reactorGet(path, params = {}) {
  const token = await getToken();
  const t0    = Date.now();
  try {
    const res = await axios.get(`${REACTOR_BASE}${path}`, {
      headers: {
        Authorization:     `Bearer ${token}`,
        "x-api-key":       process.env.CLIENT_ID,
        "x-gw-ims-org-id": process.env.ORG_ID,
        Accept:            "application/vnd.api+json;revision=1",
      },
      params,
    });
    log.info(`[Direct] GET ${path} → ${res.status} (${Date.now() - t0}ms)`);
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    const body   = err.response?.data;
    log.error(`[Direct] GET ${path} → ${status} (${Date.now() - t0}ms)`, body?.errors?.[0]?.title || err.message);
    throw err;
  }
}

let mcpClient      = null;
let geminiModel    = null;
let tools          = [];
let geminiFunctions = [];

function convertJsonSchemaType(prop) {
  if (!prop) return { type: "STRING" };
  const typeMap = { string: "STRING", number: "NUMBER", integer: "INTEGER", boolean: "BOOLEAN", array: "ARRAY", object: "OBJECT" };
  const result  = { type: typeMap[prop.type] || "STRING", description: prop.description || "" };
  if (prop.enum) result.enum = prop.enum;
  if (prop.type === "array"  && prop.items)      result.items      = convertJsonSchemaType(prop.items);
  if (prop.type === "object" && prop.properties) {
    result.properties = {};
    for (const [k, v] of Object.entries(prop.properties)) result.properties[k] = convertJsonSchemaType(v);
    if (prop.required?.length) result.required = prop.required;
  }
  return result;
}

function mcpToGemini(tool) {
  const schema     = tool.inputSchema || {};
  const properties = schema.properties || {};
  const required   = schema.required   || [];
  const geminiProps = {};
  for (const [k, v] of Object.entries(properties)) geminiProps[k] = convertJsonSchemaType(v);
  return {
    name:        tool.name,
    description: tool.description || "",
    parameters:  { type: "OBJECT", properties: geminiProps, ...(required.length ? { required } : {}) },
  };
}

async function bootstrap() {
  log.info("🔌 Step 1/3 — Spawning MCP server subprocess...");
  log.debug(`  MCP server path: ${MCP_SERVER_PATH}`);

  const transport = new StdioClientTransport({
    command: "node",
    args:    [MCP_SERVER_PATH],
    env:     { ...process.env },
  });

  mcpClient = new Client({ name: "web-ui-client", version: "1.0.0" }, { capabilities: {} });

  const t0 = Date.now();
  await mcpClient.connect(transport);
  log.mcp(`✅ Connected in ${Date.now() - t0}ms`);

  log.info("🔌 Step 2/3 — Loading MCP tools...");
  const t1     = Date.now();
  const result = await mcpClient.listTools();
  tools          = result.tools;
  geminiFunctions = tools.map(mcpToGemini);
  log.mcp(`✅ ${tools.length} tools loaded in ${Date.now() - t1}ms`);
  log.debug("  Tools: " + tools.map((t) => t.name).join(", "));

  log.info("🔌 Step 3/3 — Initializing Gemini model...");
  const t2    = Date.now();
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-lite",
    systemInstruction: `You are an expert Adobe Experience Platform Tags (Launch) assistant with full access to the Reactor API via 74 MCP tools.

CAPABILITIES:
- Properties & Companies: list, create, update, delete, full setup
- Extensions: list catalog, install, update, delete
- Data Elements: create (JS variable, DOM attribute, cookie, query param, custom code, page info), update, delete, revise
- Rules: create, update, delete, revise, enable/disable
- Rule Components: add events/conditions/actions to rules, update, delete
- Libraries: create, add resources, build, submit, approve, publish
- Environments: create dev/staging/production, update, delete
- Hosts: create Akamai or SFTP hosts, update, delete
- Secrets: create/manage secrets for edge properties
- Callbacks: create/manage webhooks for audit events
- Notes: add annotations to any resource
- Builds: trigger and monitor builds
- Search: full-text search across all resources
- Audit: view change history
- Composite tools: setup_property_complete, create_rule_with_components, clone_property_rules_to_property, publish_all_changes

HOW TO OPERATE:
1. When you need an ID, call the relevant list tool first (list_companies → list_properties → etc.)
2. For multi-step tasks, chain tools automatically — never ask the user for intermediate IDs
3. After completing actions, summarize with key IDs and names
4. For "create a page load rule" → create_rule_with_components (event=dom-ready)
5. For "publish everything" → publish_all_changes composite tool
6. For "set up a new property" → list_companies → setup_property_complete
7. For "copy rules to another property" → clone_property_rules_to_property
8. For "add a note" → list the resource first, then create_note
9. For "create a webhook" → list_properties → create_callback

COMMON delegate_descriptor_ids:
Events: core::events::dom-ready, core::events::window-loaded, core::events::click, core::events::custom-event, core::events::direct-call, core::events::history-change, core::events::element-exists, core::events::enters-viewport
Conditions: core::conditions::path-and-querystring, core::conditions::domain, core::conditions::cookie, core::conditions::custom-code, core::conditions::variable, core::conditions::browser, core::conditions::device-type
Actions: core::actions::custom-code, adobe-analytics::actions::set-variables, adobe-analytics::actions::send-beacon, adobe-analytics::actions::clear-variables
Data Elements: core::dataElements::javascript-variable, core::dataElements::dom-attribute, core::dataElements::cookie, core::dataElements::query-string-parameter, core::dataElements::custom-code, core::dataElements::page-info`,
    tools: [{ functionDeclarations: geminiFunctions }],
    generationConfig: { temperature: 0.1 },
  });
  log.gemini(`✅ Model ready in ${Date.now() - t2}ms (gemini-2.0-flash-lite, ${geminiFunctions.length} functions)`);
}

// ─── Session store (in-memory, keyed by sessionId) ───────────────────────────

const sessions = new Map();

function getHistory(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId);
}

// ─── Agentic chat loop with retry on 429 ─────────────────────────────────────

let _chatCount = 0;

async function callGeminiWithRetry(model, contents, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const t0 = Date.now();
    try {
      const res = await model.generateContent({ contents });
      log.gemini(`✅ generateContent OK in ${Date.now() - t0}ms (attempt ${attempt + 1})`);
      return res;
    } catch (err) {
      const ms    = Date.now() - t0;
      const is429 = err.message?.includes("429") || err.message?.includes("Too Many Requests");
      const delayMatch  = err.message?.match(/retryDelay['":\s]+(\d+)s/);
      const retryAfter  = delayMatch ? parseInt(delayMatch[1]) * 1000 : Math.pow(2, attempt) * 5000;

      if (is429 && attempt < maxRetries) {
        const waitSec = Math.ceil(retryAfter / 1000);
        log.gemini(`⏳ 429 Rate limit (${ms}ms). Waiting ${waitSec}s before retry ${attempt + 1}/${maxRetries}...`);
        await new Promise((r) => setTimeout(r, retryAfter));
        continue;
      }
      log.error(`Gemini generateContent failed (${ms}ms, attempt ${attempt + 1}): ${err.message.slice(0, 200)}`);
      throw err;
    }
  }
}

async function agentChat(sessionId, userMessage, onToolCall) {
  const chatId  = ++_chatCount;
  const history = getHistory(sessionId);
  history.push({ role: "user", parts: [{ text: userMessage }] });

  log.sep();
  log.info(`[Chat #${chatId}] session=${sessionId} msg="${userMessage.slice(0, 80)}"`);
  log.debug(`  history length: ${history.length} turns`);

  const MAX = 10;
  for (let i = 0; i < MAX; i++) {
    const round = i + 1;
    log.gemini(`[Chat #${chatId}] Round ${round}/${MAX} — calling Gemini...`);
    log.debug(`  history turns: ${history.length}`);

    const response  = await callGeminiWithRetry(geminiModel, history);
    const candidate = response.response.candidates?.[0];
    if (!candidate) {
      log.warn(`[Chat #${chatId}] No candidate returned from Gemini`);
      return "No response from Gemini.";
    }

    const parts         = candidate.content?.parts || [];
    const functionCalls = parts.filter((p) => p.functionCall);
    const textParts     = parts.filter((p) => p.text);

    log.gemini(`[Chat #${chatId}] Round ${round} → ${functionCalls.length} tool call(s), ${textParts.length} text part(s)`);

    if (functionCalls.length === 0) {
      const finalText = textParts.map((p) => p.text).join("\n");
      history.push({ role: "model", parts: [{ text: finalText }] });
      log.info(`[Chat #${chatId}] ✅ Final answer after ${round} round(s) — ${finalText.length} chars`);
      log.sep();
      return finalText;
    }

    // Log each function call Gemini wants to make
    functionCalls.forEach(({ functionCall: { name, args } }) => {
      log.gemini(`[Chat #${chatId}]   → wants to call: ${name}(${Object.keys(args || {}).join(", ")})`);
      log.debug(`     args: ${JSON.stringify(args).slice(0, 200)}`);
    });

    history.push({ role: "model", parts });

    // Execute all tool calls
    const t0 = Date.now();
    const functionResults = await Promise.all(
      functionCalls.map(async ({ functionCall: { name, args } }) => {
        onToolCall?.(name, args);
        log.mcp(`[Chat #${chatId}]   ⚙  Executing: ${name}`);
        const toolT0 = Date.now();
        try {
          const result = await mcpClient.callTool({ name, arguments: args || {} });
          const text   = result.content?.[0]?.text || JSON.stringify(result);
          log.mcp(`[Chat #${chatId}]   ✅ ${name} done in ${Date.now() - toolT0}ms → ${text.slice(0, 80).replace(/\n/g, " ")}...`);
          return { functionResponse: { name, response: { content: text } } };
        } catch (err) {
          log.error(`[Chat #${chatId}]   ❌ ${name} failed in ${Date.now() - toolT0}ms: ${err.message}`);
          return { functionResponse: { name, response: { content: `Error: ${err.message}` } } };
        }
      })
    );

    log.mcp(`[Chat #${chatId}]   All ${functionCalls.length} tool(s) done in ${Date.now() - t0}ms`);
    history.push({ role: "user", parts: functionResults });
  }

  log.warn(`[Chat #${chatId}] Hit max iterations (${MAX})`);
  return "Reached maximum tool iterations. Please try a more specific request.";
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.resolve(__dirname, "../public")));

// POST /api/chat  — main chat endpoint (SSE streaming)
app.post("/api/chat", async (req, res) => {
  const reqT0 = Date.now();
  const { message, sessionId = "default" } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });

  log.http("POST", "/api/chat", 200, 0);
  log.info(`[/api/chat] session=${sessionId} message="${message.slice(0, 80)}"`);

  // SSE headers
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");

  const send = (event, data) => {
    log.debug(`  SSE → event:${event} data:${JSON.stringify(data).slice(0, 100)}`);
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const toolCalls = [];
    const answer = await agentChat(sessionId, message, (name, args) => {
      toolCalls.push({ name, args });
      send("tool_call", { name, args });
    });
    send("answer", { text: answer, toolCalls });
    log.info(`[/api/chat] ✅ Done in ${Date.now() - reqT0}ms — ${toolCalls.length} tool call(s)`);
  } catch (err) {
    log.error(`[/api/chat] ❌ Failed in ${Date.now() - reqT0}ms: ${err.message}`);
    send("error", { message: err.message });
  }

  res.end();
});

// GET /api/tools — return tool list for the UI
app.get("/api/tools", (req, res) => {
  log.http("GET", "/api/tools", 200, 0);
  res.json({ tools: tools.map((t) => ({ name: t.name, description: t.description })) });
});

// GET /api/health — full connectivity status
app.get("/api/health", (_req, res) => {
  log.http("GET", "/api/health", 200, 0);
  res.json({
    status:    "ok",
    mcp:       mcpClient ? "connected" : "disconnected",
    gemini:    geminiModel ? "ready" : "not initialized",
    tools:     tools.length,
    sessions:  sessions.size,
    debug:     DEBUG,
    timestamp: new Date().toISOString(),
  });
});

// DELETE /api/session/:id — clear conversation history
app.delete("/api/session/:id", (req, res) => {
  const { id } = req.params;
  const existed = sessions.has(id);
  sessions.delete(id);
  log.info(`[/api/session] Cleared session: ${id} (existed: ${existed})`);
  res.json({ cleared: true, sessionId: id });
});

// ─── Direct REST endpoints (no Gemini, no MCP — straight to Reactor API) ─────

// POST/PATCH/DELETE helpers for direct layer
async function reactorPost(apiPath, body) {
  const token = await getToken();
  const t0    = Date.now();
  try {
    const res = await axios.post(`${REACTOR_BASE}${apiPath}`, body, {
      headers: { Authorization:`Bearer ${token}`, "x-api-key":process.env.CLIENT_ID, "x-gw-ims-org-id":process.env.ORG_ID, "Content-Type":"application/vnd.api+json", Accept:"application/vnd.api+json;revision=1" },
    });
    log.info(`[Direct] POST ${apiPath} → ${res.status} (${Date.now()-t0}ms)`);
    return res.data;
  } catch (err) {
    log.error(`[Direct] POST ${apiPath} → ${err.response?.status}`, err.response?.data?.errors?.[0]?.title || err.message);
    throw err;
  }
}

async function reactorPatch(apiPath, body) {
  const token = await getToken();
  const t0    = Date.now();
  try {
    const res = await axios.patch(`${REACTOR_BASE}${apiPath}`, body, {
      headers: { Authorization:`Bearer ${token}`, "x-api-key":process.env.CLIENT_ID, "x-gw-ims-org-id":process.env.ORG_ID, "Content-Type":"application/vnd.api+json", Accept:"application/vnd.api+json;revision=1" },
    });
    log.info(`[Direct] PATCH ${apiPath} → ${res.status} (${Date.now()-t0}ms)`);
    return res.data;
  } catch (err) {
    log.error(`[Direct] PATCH ${apiPath} → ${err.response?.status}`, err.response?.data?.errors?.[0]?.title || err.message);
    throw err;
  }
}

async function reactorDel(apiPath) {
  const token = await getToken();
  const t0    = Date.now();
  try {
    await axios.delete(`${REACTOR_BASE}${apiPath}`, {
      headers: { Authorization:`Bearer ${token}`, "x-api-key":process.env.CLIENT_ID, "x-gw-ims-org-id":process.env.ORG_ID, Accept:"application/vnd.api+json;revision=1" },
    });
    log.info(`[Direct] DELETE ${apiPath} → 204 (${Date.now()-t0}ms)`);
    return { deleted: true };
  } catch (err) {
    log.error(`[Direct] DELETE ${apiPath} → ${err.response?.status}`, err.response?.data?.errors?.[0]?.title || err.message);
    throw err;
  }
}

function directRoute(handler) {
  return async (req, res) => {
    const t0 = Date.now();
    try {
      const data = await handler(req);
      log.info(`[Direct] ${req.method} ${req.path} ✅ (${Date.now() - t0}ms)`);
      res.json({ ok: true, data });
    } catch (err) {
      const status  = err.response?.status || 500;
      const message = err.response?.data?.errors?.[0]?.title || err.message;
      log.error(`[Direct] ${req.method} ${req.path} ❌ ${status}: ${message}`);
      res.status(status).json({ ok: false, error: message, status });
    }
  };
}

// GET /api/direct/companies
app.get("/api/direct/companies", directRoute(async () => {
  const data = await reactorGet("/companies");
  return data.data.map((c) => ({
    id:       c.id,
    name:     c.attributes.name,
    org_id:   c.attributes.org_id,
    created:  c.attributes.created_at,
  }));
}));

// GET /api/direct/properties?company_id=CO...
app.get("/api/direct/properties", directRoute(async (req) => {
  const { company_id, page_size = 25 } = req.query;
  if (!company_id) throw Object.assign(new Error("company_id query param required"), { response: { status: 400, data: { errors: [{ title: "company_id query param required" }] } } });
  const data = await reactorGet(`/companies/${company_id}/properties`, { "page[size]": page_size });
  return data.data.map((p) => ({
    id:       p.id,
    name:     p.attributes.name,
    platform: p.attributes.platform,
    domains:  p.attributes.domains,
    enabled:  p.attributes.enabled,
    created:  p.attributes.created_at,
    updated:  p.attributes.updated_at,
  }));
}));

// GET /api/direct/extensions?property_id=PR...
app.get("/api/direct/extensions", directRoute(async (req) => {
  const { property_id } = req.query;
  if (!property_id) throw Object.assign(new Error("property_id required"), { response: { status: 400, data: { errors: [{ title: "property_id query param required" }] } } });
  const data = await reactorGet(`/properties/${property_id}/extensions`);
  return data.data.map((e) => ({
    id:           e.id,
    name:         e.attributes.display_name || e.attributes.name,
    version:      e.attributes.version,
    enabled:      e.attributes.enabled,
    package_id:   e.relationships?.extension_package?.data?.id,
    created:      e.attributes.created_at,
    updated:      e.attributes.updated_at,
  }));
}));

// GET /api/direct/extension-packages?name=analytics&page_size=25
app.get("/api/direct/extension-packages", directRoute(async (req) => {
  const { name, page_size = 25 } = req.query;
  const params = { "page[size]": page_size };
  if (name) params["filter[name]"] = `CONTAINS ${name}`;
  const data = await reactorGet("/extension_packages", params);
  return data.data.map((p) => ({
    id:          p.id,
    name:        p.attributes.name,
    display_name: p.attributes.display_name,
    version:     p.attributes.version,
    author:      p.attributes.author?.name,
    description: p.attributes.description,
  }));
}));

// GET /api/direct/rules?property_id=PR...
app.get("/api/direct/rules", directRoute(async (req) => {
  const { property_id } = req.query;
  if (!property_id) throw Object.assign(new Error("property_id required"), { response: { status: 400, data: { errors: [{ title: "property_id query param required" }] } } });
  const data = await reactorGet(`/properties/${property_id}/rules`);
  return data.data.map((r) => ({
    id:      r.id,
    name:    r.attributes.name,
    enabled: r.attributes.enabled,
    created: r.attributes.created_at,
    updated: r.attributes.updated_at,
  }));
}));

// GET /api/direct/rule-components?rule_id=RL...
app.get("/api/direct/rule-components", directRoute(async (req) => {
  const { rule_id } = req.query;
  if (!rule_id) throw Object.assign(new Error("rule_id required"), { response: { status: 400, data: { errors: [{ title: "rule_id query param required" }] } } });
  const data = await reactorGet(`/rules/${rule_id}/rule_components`);
  return data.data.map((rc) => ({
    id:                    rc.id,
    name:                  rc.attributes.name,
    delegate_descriptor_id: rc.attributes.delegate_descriptor_id,
    order:                 rc.attributes.order,
    created:               rc.attributes.created_at,
  }));
}));

// GET /api/direct/data-elements?property_id=PR...
app.get("/api/direct/data-elements", directRoute(async (req) => {
  const { property_id } = req.query;
  if (!property_id) throw Object.assign(new Error("property_id required"), { response: { status: 400, data: { errors: [{ title: "property_id query param required" }] } } });
  const data = await reactorGet(`/properties/${property_id}/data_elements`);
  return data.data.map((d) => ({
    id:                    d.id,
    name:                  d.attributes.name,
    delegate_descriptor_id: d.attributes.delegate_descriptor_id,
    storage_duration:      d.attributes.storage_duration,
    created:               d.attributes.created_at,
    updated:               d.attributes.updated_at,
  }));
}));

// GET /api/direct/libraries?property_id=PR...
app.get("/api/direct/libraries", directRoute(async (req) => {
  const { property_id } = req.query;
  if (!property_id) throw Object.assign(new Error("property_id required"), { response: { status: 400, data: { errors: [{ title: "property_id query param required" }] } } });
  const data = await reactorGet(`/properties/${property_id}/libraries`);
  return data.data.map((l) => ({
    id:      l.id,
    name:    l.attributes.name,
    state:   l.attributes.state,
    created: l.attributes.created_at,
    updated: l.attributes.updated_at,
  }));
}));

// GET /api/direct/environments?property_id=PR...
app.get("/api/direct/environments", directRoute(async (req) => {
  const { property_id } = req.query;
  if (!property_id) throw Object.assign(new Error("property_id required"), { response: { status: 400, data: { errors: [{ title: "property_id query param required" }] } } });
  const data = await reactorGet(`/properties/${property_id}/environments`);
  return data.data.map((e) => ({
    id:      e.id,
    name:    e.attributes.name,
    stage:   e.attributes.stage,
    created: e.attributes.created_at,
  }));
}));

// GET /api/direct/hosts?property_id=PR...
app.get("/api/direct/hosts", directRoute(async (req) => {
  const { property_id } = req.query;
  if (!property_id) throw Object.assign(new Error("property_id required"), { response: { status: 400, data: { errors: [{ title: "property_id query param required" }] } } });
  const data = await reactorGet(`/properties/${property_id}/hosts`);
  return data.data.map((h) => ({
    id:      h.id,
    name:    h.attributes.name,
    type_of: h.attributes.type_of,
    status:  h.attributes.status,
    created: h.attributes.created_at,
  }));
}));

// GET /api/direct/audit-events?property_id=PR...
app.get("/api/direct/audit-events", directRoute(async (req) => {
  const { property_id, page_size = 25 } = req.query;
  if (!property_id) throw Object.assign(new Error("property_id required"), { response: { status: 400, data: { errors: [{ title: "property_id query param required" }] } } });
  const data = await reactorGet("/audit_events", { "filter[property_id]": property_id, "page[size]": page_size });
  return data.data.map((a) => ({
    id:           a.id,
    type:         a.attributes.type_of,
    action:       a.attributes.action,
    resource_id:  a.attributes.resource_id,
    resource_type: a.attributes.resource_type,
    created:      a.attributes.created_at,
  }));
}));

// GET /api/direct/notes?resource_type=rules&resource_id=RL...
app.get("/api/direct/notes", directRoute(async (req) => {
  const { resource_type, resource_id } = req.query;
  if (!resource_type || !resource_id) throw Object.assign(new Error("resource_type and resource_id required"), { response: { status: 400, data: { errors: [{ title: "resource_type and resource_id required" }] } } });
  const data = await reactorGet(`/${resource_type}/${resource_id}/notes`);
  return data.data.map((n) => ({ id: n.id, text: n.attributes.text, author: n.attributes.author_display_name, created: n.attributes.created_at }));
}));

// POST /api/direct/notes
app.post("/api/direct/notes", directRoute(async (req) => {
  const { resource_type, resource_id, text } = req.body;
  if (!resource_type || !resource_id || !text) throw Object.assign(new Error("resource_type, resource_id, text required"), { response: { status: 400, data: { errors: [{ title: "resource_type, resource_id, text required" }] } } });
  const data = await reactorPost(`/${resource_type}/${resource_id}/notes`, { data: { type: "notes", attributes: { text } } });
  return { id: data.data.id, text: data.data.attributes.text, created: data.data.attributes.created_at };
}));

// GET /api/direct/callbacks?property_id=PR...
app.get("/api/direct/callbacks", directRoute(async (req) => {
  const { property_id } = req.query;
  if (!property_id) throw Object.assign(new Error("property_id required"), { response: { status: 400, data: { errors: [{ title: "property_id required" }] } } });
  const data = await reactorGet(`/properties/${property_id}/callbacks`);
  return data.data.map((c) => ({ id: c.id, url: c.attributes.url, subscriptions: c.attributes.subscriptions, created: c.attributes.created_at }));
}));

// POST /api/direct/callbacks
app.post("/api/direct/callbacks", directRoute(async (req) => {
  const { property_id, url, subscriptions } = req.body;
  if (!property_id || !url) throw Object.assign(new Error("property_id and url required"), { response: { status: 400, data: { errors: [{ title: "property_id and url required" }] } } });
  const attrs = { url };
  if (subscriptions) attrs.subscriptions = subscriptions;
  const data = await reactorPost(`/properties/${property_id}/callbacks`, { data: { type: "callbacks", attributes: attrs } });
  return { id: data.data.id, url: data.data.attributes.url };
}));

// DELETE /api/direct/callbacks/:id
app.delete("/api/direct/callbacks/:id", directRoute(async (req) => {
  await reactorDel(`/callbacks/${req.params.id}`);
  return { deleted: true, id: req.params.id };
}));

// GET /api/direct/builds?property_id=PR...
app.get("/api/direct/builds", directRoute(async (req) => {
  const { property_id, library_id, page_size = 25 } = req.query;
  let path;
  if (library_id)       path = `/libraries/${library_id}/builds`;
  else if (property_id) path = `/properties/${property_id}/builds`;
  else throw Object.assign(new Error("property_id or library_id required"), { response: { status: 400, data: { errors: [{ title: "property_id or library_id required" }] } } });
  const data = await reactorGet(path, { "page[size]": page_size });
  return data.data.map((b) => ({ id: b.id, status: b.attributes.status, created: b.attributes.created_at, updated: b.attributes.updated_at }));
}));

// GET /api/direct/secrets?property_id=PR...
app.get("/api/direct/secrets", directRoute(async (req) => {
  const { property_id } = req.query;
  if (!property_id) throw Object.assign(new Error("property_id required"), { response: { status: 400, data: { errors: [{ title: "property_id required" }] } } });
  const data = await reactorGet(`/properties/${property_id}/secrets`);
  return data.data.map((s) => ({ id: s.id, name: s.attributes.name, type_of: s.attributes.type_of, status: s.attributes.status, created: s.attributes.created_at }));
}));

// GET /api/direct/profile
app.get("/api/direct/profile", directRoute(async () => {
  const data = await reactorGet("/profile");
  return { id: data.data.id, display_name: data.data.attributes.display_name, email: data.data.attributes.email };
}));

// GET /api/direct/library-resources?library_id=LB...
app.get("/api/direct/library-resources", directRoute(async (req) => {
  const { library_id } = req.query;
  if (!library_id) throw Object.assign(new Error("library_id required"), { response: { status: 400, data: { errors: [{ title: "library_id required" }] } } });
  const data = await reactorGet(`/libraries/${library_id}/resources`);
  return data.data.map((r) => ({ id: r.id, type: r.type, name: r.attributes?.name, revision: r.attributes?.revision_number }));
}));

// GET /api/direct/rule-component?id=RC...
app.get("/api/direct/rule-component", directRoute(async (req) => {
  const { id } = req.query;
  if (!id) throw Object.assign(new Error("id required"), { response: { status: 400, data: { errors: [{ title: "id required" }] } } });
  const data = await reactorGet(`/rule_components/${id}`);
  const rc = data.data;
  return { id: rc.id, name: rc.attributes.name, delegate_descriptor_id: rc.attributes.delegate_descriptor_id, settings: rc.attributes.settings, order: rc.attributes.order };
}));

// GET /api/direct/extension-package?id=EP...
app.get("/api/direct/extension-package", directRoute(async (req) => {
  const { id } = req.query;
  if (!id) throw Object.assign(new Error("id required"), { response: { status: 400, data: { errors: [{ title: "id required" }] } } });
  const data = await reactorGet(`/extension_packages/${id}`);
  const ep = data.data;
  return { id: ep.id, name: ep.attributes.name, display_name: ep.attributes.display_name, version: ep.attributes.version, description: ep.attributes.description, author: ep.attributes.author, configuration: ep.attributes.configuration };
}));

// GET /api/direct/search?property_id=PR...&query=...&type_in=rules,data_elements
app.get("/api/direct/search", directRoute(async (req) => {
  const { property_id, query, type_in } = req.query;
  if (!property_id || !query) throw Object.assign(new Error("property_id and query required"), { response: { status: 400, data: { errors: [{ title: "property_id and query required" }] } } });
  const attrs = { query };
  if (type_in) attrs.type_in = type_in;
  const data = await reactorPost(`/properties/${property_id}/search`, { data: { type: "search", attributes: attrs } });
  return data.data.map((r) => ({ id: r.id, type: r.type, name: r.attributes?.name, updated: r.attributes?.updated_at }));
}));

// ─── Start ────────────────────────────────────────────────────────────────────

log.info("🚀 Bootstrapping...");
const bootT0 = Date.now();
await bootstrap();

log.sep();
log.info("✅ Bootstrap complete in " + (Date.now() - bootT0) + "ms");
log.info("");
log.info("  MCP Server  : connected (" + tools.length + " tools)");
log.info("  Gemini      : ready (gemini-2.0-flash-lite)");
log.info("  Adobe Org   : " + process.env.ORG_ID);
log.info("  Client ID   : " + process.env.CLIENT_ID?.slice(0, 8) + "...");
log.info("  Debug mode  : " + (DEBUG ? "ON (set DEBUG=true)" : "OFF"));
log.sep();

app.listen(PORT, () => {
  log.info(`🌐 Web UI     → http://localhost:${PORT}`);
  log.info(`🔍 Health     → http://localhost:${PORT}/api/health`);
  log.info(`🔧 Tools list → http://localhost:${PORT}/api/tools`);
  log.sep();
});
