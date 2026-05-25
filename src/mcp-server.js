/**
 * Adobe Experience Platform Tags (Launch) — MCP Server Factory
 * Shared server instance builder used by all transports (stdio, HTTP, SSE)
 * Exposes all 74 Reactor API operations as MCP tools
 */

import "dotenv/config";
import axios from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerAepTools } from "./aep-tools.js";

// ─── Debug logger ─────────────────────────────────────────────────────────────
// All MCP server logs go to stderr so they don't pollute the stdio MCP channel

const DEBUG = process.env.DEBUG === "true" || process.env.DEBUG === "1";

const dbg = {
  // Always visible — key lifecycle events
  info:    (...a) => console.error("[MCP]", ...a),
  // Only when DEBUG=true — verbose detail
  verbose: (...a) => { if (DEBUG) console.error("[MCP:verbose]", ...a); },
  // Always visible — errors
  error:   (...a) => console.error("[MCP:ERROR]", ...a),
  // Always visible — every Reactor HTTP call
  http:    (method, url, status, ms) =>
    console.error(`[MCP:HTTP] ${method.toUpperCase()} ${url} → ${status} (${ms}ms)`),
};

// ─── Env validation ───────────────────────────────────────────────────────────

const REACTOR_BASE  = "https://reactor.adobe.io";
const IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";

// ─── MCP Server Factory ───────────────────────────────────────────────────────
// Accepts optional credentials object; falls back to env vars (stdio / http-server usage).
export async function buildMcpServer(credentials = {}) {
  const CLIENT_ID     = credentials.clientId     || process.env.CLIENT_ID;
  const CLIENT_SECRET = credentials.clientSecret || process.env.CLIENT_SECRET;
  const ORG_ID        = credentials.orgId        || process.env.ORG_ID;

  // IMS silently drops scopes the credential isn't authorised for — safe to request all.
  // process.env.SCOPES overrides everything (set in .env or Render env vars).
  const SCOPES = process.env.SCOPES ||
    "cjm.suppression_service.client.delete,cjm.suppression_service.client.all," +
    "openid,session,AdobeID,read_organizations," +
    "additional_info.job_function,additional_info.projectedProductContext,additional_info.roles," +
    "reactor,aep.data.core.identity.read,aep.data.core.ups.read," +
    "aep.data.core.catalog.read,aep.data.core.schemaregistry.read," +
    "aep.data.core.segmentation.read,aep.data.core.flowservice.read";

  // Per-session sandbox — stored in closure, never mutates process.env
  const SANDBOX_NAME = credentials.sandboxName || process.env.AEP_SANDBOX_NAME || "prod";

  // ─── Token cache (per server instance) ──────────────────────────────────────
  let _tokenCache = { token: null, expiresAt: 0 };

  async function getAccessToken() {
    const now = Date.now();
    if (_tokenCache.token && now < _tokenCache.expiresAt - 60_000) {
      dbg.verbose(`Token cache hit — expires in ${Math.round((_tokenCache.expiresAt - now) / 1000)}s`);
      return _tokenCache.token;
    }
    dbg.info("🔑 Fetching new Adobe IMS access token...");
    const t0 = Date.now();
    const params = new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope:         SCOPES,
    });
    try {
      const res = await axios.post(IMS_TOKEN_URL, params.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      _tokenCache = { token: res.data.access_token, expiresAt: now + res.data.expires_in * 1000 };
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

  // ─── Reactor API helper ──────────────────────────────────────────────────────
  async function reactor(method, path, data = null, params = {}) {
    const token = await getAccessToken();
    const url   = `${REACTOR_BASE}${path}`;
    const headers = {
      Authorization:      `Bearer ${token}`,
      "x-api-key":        CLIENT_ID,
      "x-gw-ims-org-id":  ORG_ID,
      "Content-Type":     "application/vnd.api+json",
      Accept:             "application/vnd.api+json;revision=1",
    };
    dbg.verbose(`→ ${method.toUpperCase()} ${path}`, params && Object.keys(params).length ? params : "");
    if (data && DEBUG) dbg.verbose("  body:", JSON.stringify(data).slice(0, 300));
    const t0 = Date.now();
    try {
      const res = await axios({ method, url, headers, data, params });
      const ms  = Date.now() - t0;
      dbg.http(method, path, res.status, ms);
      const d = res.data?.data;
      if (Array.isArray(d))  dbg.verbose(`  ← ${d.length} items`);
      else if (d?.id)        dbg.verbose(`  ← id: ${d.id} type: ${d.type}`);
      return res.data;
    } catch (err) {
      const ms     = Date.now() - t0;
      const status = err.response?.status || "ERR";
      const body   = err.response?.data;
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

  const server = new McpServer({
    name:    "adobe-launch-mcp",
    version: "2.0.0",
  });

// ─── Helper: wrap handler with error surfacing ────────────────────────────────

  let _toolCallCount = 0;

  function tool(name, description, schema, handler) {
  server.tool(name, description, schema, async (args) => {
    const callId = ++_toolCallCount;
    const t0     = Date.now();
    dbg.info(`┌─ [#${callId}] Tool: ${name}`);
    dbg.verbose(`   args: ${JSON.stringify(args).slice(0, 200)}`);
    try {
      const result = await handler(args);
      const ms     = Date.now() - t0;
      const text   = typeof result === "string" ? result : JSON.stringify(result, null, 2);
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // PROPERTIES & COMPANIES
  // ═══════════════════════════════════════════════════════════════════════════════

  tool("list_companies", "List all Adobe IMS organizations/companies accessible to this credential", {}, async () => {
  return reactor("GET", "/companies");
});

tool("list_properties", "List all tag properties for a company", {
  company_id: z.string().describe("Company ID from list_companies"),
  page_size:  z.number().optional().describe("Results per page (default 25)"),
}, async ({ company_id, page_size }) => {
  return reactor("GET", `/companies/${company_id}/properties`, null, {
    "page[size]": page_size || 25,
  });
});

tool("create_property", "Create a new tag property", {
  company_id:  z.string().describe("Company ID"),
  name:        z.string().describe("Property name"),
  platform:    z.enum(["web", "mobile", "edge"]).describe("Platform type"),
  domains:     z.array(z.string()).optional().describe("Allowed domains (web only)"),
  development: z.boolean().optional().describe("Mark as development property"),
}, async ({ company_id, name, platform, domains, development }) => {
  const attributes = { name, platform, development: development ?? false };
  if (platform === "web" && domains?.length) attributes.domains = domains;
  return reactor("POST", `/companies/${company_id}/properties`, {
    data: { type: "properties", attributes },
  });
});

tool("get_property", "Get details of a specific property", {
  property_id: z.string().describe("Property ID"),
}, async ({ property_id }) => {
  return reactor("GET", `/properties/${property_id}`);
});

tool("update_property", "Update a tag property's name or domains", {
  property_id: z.string().describe("Property ID"),
  name:        z.string().optional().describe("New name"),
  domains:     z.array(z.string()).optional().describe("New domains list"),
  development: z.boolean().optional().describe("Development flag"),
}, async ({ property_id, name, domains, development }) => {
  const attributes = {};
  if (name !== undefined)        attributes.name = name;
  if (domains !== undefined)     attributes.domains = domains;
  if (development !== undefined) attributes.development = development;
  return reactor("PATCH", `/properties/${property_id}`, {
    data: { id: property_id, type: "properties", attributes },
  });
});

tool("delete_property", "Delete a tag property permanently", {
  property_id: z.string().describe("Property ID to delete"),
}, async ({ property_id }) => {
  await reactor("DELETE", `/properties/${property_id}`);
  return `Property ${property_id} deleted successfully.`;
});

tool("setup_property_complete", "Composite: create property + Akamai host + dev/staging/prod environments in one shot", {
  company_id: z.string().describe("Company ID"),
  name:       z.string().describe("Property name"),
  platform:   z.enum(["web", "mobile", "edge"]).describe("Platform"),
  domains:    z.array(z.string()).optional().describe("Domains (web only)"),
}, async ({ company_id, name, platform, domains }) => {
  dbg.info(`  [setup_property_complete] company=${company_id} name="${name}" platform=${platform}`);

  // 1. Create property
  const attributes = { name, platform, development: false };
  if (platform === "web" && domains?.length) attributes.domains = domains;
  const propRes = await reactor("POST", `/companies/${company_id}/properties`, {
    data: { type: "properties", attributes },
  });
  const property_id = propRes.data.id;
  dbg.info(`  ✅ Property created: ${property_id}`);

  // 2. Create Akamai host
  const hostRes = await reactor("POST", `/properties/${property_id}/hosts`, {
    data: { type: "hosts", attributes: { name: `${name} Akamai Host`, type_of: "akamai" } },
  });
  const host_id = hostRes.data.id;
  dbg.info(`  ✅ Host created: ${host_id}`);

  // 3. Create environments
  const envResults = {};
  for (const stage of ["development", "staging", "production"]) {
    const envRes = await reactor("POST", `/properties/${property_id}/environments`, {
      data: {
        type: "environments",
        attributes: { name: `${name} ${stage.charAt(0).toUpperCase() + stage.slice(1)}`, stage },
        relationships: { host: { data: { id: host_id, type: "hosts" } } },
      },
    });
    envResults[stage] = envRes.data.id;
    dbg.info(`  ✅ ${stage} environment: ${envRes.data.id}`);
  }

  return {
    property_id,
    host_id,
    environments: envResults,
    message: `Property "${name}" fully set up with host and 3 environments.`,
  };
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXTENSIONS
// ═══════════════════════════════════════════════════════════════════════════════

tool("list_extension_packages", "Search available extension packages in the catalog", {
  name:      z.string().optional().describe("Filter by name (partial match)"),
  page_size: z.number().optional().describe("Results per page"),
}, async ({ name, page_size }) => {
  const params = { "page[size]": page_size || 25 };
  if (name) params["filter[name]"] = `CONTAINS ${name}`;
  return reactor("GET", "/extension_packages", null, params);
});

tool("list_extensions", "List installed extensions on a property", {
  property_id: z.string().describe("Property ID"),
}, async ({ property_id }) => {
  return reactor("GET", `/properties/${property_id}/extensions`);
});

tool("install_extension", "Install an extension package onto a property", {
  property_id:          z.string().describe("Property ID"),
  extension_package_id: z.string().describe("Extension package ID from list_extension_packages"),
  settings:             z.string().optional().describe("Extension settings as JSON string"),
}, async ({ property_id, extension_package_id, settings }) => {
  const attributes = {};
  if (settings) {
    try { attributes.settings = settings; } catch { attributes.settings = settings; }
  }
  return reactor("POST", `/properties/${property_id}/extensions`, {
    data: {
      type: "extensions",
      attributes,
      relationships: {
        extension_package: { data: { id: extension_package_id, type: "extension_packages" } },
      },
    },
  });
});

tool("update_extension", "Update an installed extension (upgrade or change settings)", {
  extension_id:         z.string().describe("Extension ID"),
  extension_package_id: z.string().optional().describe("New extension package ID (for upgrade)"),
  settings:             z.string().optional().describe("New settings as JSON string"),
}, async ({ extension_id, extension_package_id, settings }) => {
  const data = { id: extension_id, type: "extensions", attributes: {} };
  if (settings) data.attributes.settings = settings;
  if (extension_package_id) {
    data.relationships = {
      extension_package: { data: { id: extension_package_id, type: "extension_packages" } },
    };
  }
  return reactor("PATCH", `/extensions/${extension_id}`, { data });
});

tool("delete_extension", "Delete/uninstall an extension from a property", {
  extension_id: z.string().describe("Extension ID to delete"),
}, async ({ extension_id }) => {
  await reactor("DELETE", `/extensions/${extension_id}`);
  return `Extension ${extension_id} deleted successfully.`;
});

// ═══════════════════════════════════════════════════════════════════════════════
// DATA ELEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

tool("list_data_elements", "List all data elements on a property", {
  property_id: z.string().describe("Property ID"),
}, async ({ property_id }) => {
  return reactor("GET", `/properties/${property_id}/data_elements`);
});

tool("create_data_element", "Create a new data element", {
  property_id:           z.string().describe("Property ID"),
  name:                  z.string().describe("Data element name"),
  delegate_descriptor_id: z.string().describe(
    "Type, e.g. core::dataElements::javascript-variable, core::dataElements::dom-attribute, core::dataElements::cookie, core::dataElements::query-string-parameter, core::dataElements::custom-code, core::dataElements::page-info"
  ),
  extension_id:          z.string().describe("Extension ID that provides this data element type"),
  settings:              z.string().optional().describe("Settings as JSON string, e.g. {\"path\":\"window.myVar\"}"),
  storage_duration:      z.enum(["none", "pageview", "session", "visitor"]).optional().describe("Cookie/storage duration"),
  default_value:         z.string().optional().describe("Default value if element returns undefined"),
  force_lowercase:       z.boolean().optional().describe("Force value to lowercase"),
  clean_text:            z.boolean().optional().describe("Strip leading/trailing whitespace"),
}, async ({ property_id, name, delegate_descriptor_id, extension_id, settings, storage_duration, default_value, force_lowercase, clean_text }) => {
  const attributes = { name, delegate_descriptor_id };
  if (settings)          attributes.settings = settings;
  if (storage_duration)  attributes.storage_duration = storage_duration;
  if (default_value)     attributes.default_value = default_value;
  if (force_lowercase !== undefined) attributes.force_lowercase = force_lowercase;
  if (clean_text !== undefined)      attributes.clean_text = clean_text;

  return reactor("POST", `/properties/${property_id}/data_elements`, {
    data: {
      type: "data_elements",
      attributes,
      relationships: {
        extension: { data: { id: extension_id, type: "extensions" } },
      },
    },
  });
});

tool("get_data_element", "Get details of a specific data element", {
  data_element_id: z.string().describe("Data element ID"),
}, async ({ data_element_id }) => {
  return reactor("GET", `/data_elements/${data_element_id}`);
});

tool("update_data_element", "Update a data element's name, settings, or storage duration", {
  data_element_id:       z.string().describe("Data element ID"),
  name:                  z.string().optional().describe("New name"),
  settings:              z.string().optional().describe("New settings as JSON string"),
  storage_duration:      z.enum(["none", "pageview", "session", "visitor"]).optional(),
  default_value:         z.string().optional(),
  force_lowercase:       z.boolean().optional(),
  clean_text:            z.boolean().optional(),
}, async ({ data_element_id, name, settings, storage_duration, default_value, force_lowercase, clean_text }) => {
  const attributes = {};
  if (name !== undefined)             attributes.name = name;
  if (settings !== undefined)         attributes.settings = settings;
  if (storage_duration !== undefined) attributes.storage_duration = storage_duration;
  if (default_value !== undefined)    attributes.default_value = default_value;
  if (force_lowercase !== undefined)  attributes.force_lowercase = force_lowercase;
  if (clean_text !== undefined)       attributes.clean_text = clean_text;

  return reactor("PATCH", `/data_elements/${data_element_id}`, {
    data: { id: data_element_id, type: "data_elements", attributes },
  });
});

tool("delete_data_element", "Delete a data element", {
  data_element_id: z.string().describe("Data element ID"),
}, async ({ data_element_id }) => {
  await reactor("DELETE", `/data_elements/${data_element_id}`);
  return `Data element ${data_element_id} deleted successfully.`;
});

tool("revise_data_element", "Create a new revision of a data element (required before adding to library)", {
  data_element_id: z.string().describe("Data element ID"),
}, async ({ data_element_id }) => {
  return reactor("POST", `/data_elements/${data_element_id}/revisions`, {
    data: { id: data_element_id, type: "data_elements" },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RULES
// ═══════════════════════════════════════════════════════════════════════════════

tool("list_rules", "List all rules on a property", {
  property_id: z.string().describe("Property ID"),
}, async ({ property_id }) => {
  return reactor("GET", `/properties/${property_id}/rules`);
});

tool("create_rule", "Create a new rule on a property", {
  property_id: z.string().describe("Property ID"),
  name:        z.string().describe("Rule name, e.g. 'Page Load - All Pages'"),
}, async ({ property_id, name }) => {
  return reactor("POST", `/properties/${property_id}/rules`, {
    data: { type: "rules", attributes: { name } },
  });
});

tool("get_rule", "Get details of a specific rule", {
  rule_id: z.string().describe("Rule ID"),
}, async ({ rule_id }) => {
  return reactor("GET", `/rules/${rule_id}`);
});

tool("update_rule", "Update a rule's name or enabled state", {
  rule_id: z.string().describe("Rule ID"),
  name:    z.string().optional().describe("New rule name"),
  enabled: z.boolean().optional().describe("Enable or disable the rule"),
}, async ({ rule_id, name, enabled }) => {
  const attributes = {};
  if (name !== undefined)    attributes.name = name;
  if (enabled !== undefined) attributes.enabled = enabled;
  return reactor("PATCH", `/rules/${rule_id}`, {
    data: { id: rule_id, type: "rules", attributes },
  });
});

tool("delete_rule", "Delete a rule permanently", {
  rule_id: z.string().describe("Rule ID"),
}, async ({ rule_id }) => {
  await reactor("DELETE", `/rules/${rule_id}`);
  return `Rule ${rule_id} deleted successfully.`;
});

tool("revise_rule", "Create a new revision of a rule (required before adding to library)", {
  rule_id: z.string().describe("Rule ID"),
}, async ({ rule_id }) => {
  return reactor("POST", `/rules/${rule_id}/revisions`, {
    data: { id: rule_id, type: "rules" },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RULE COMPONENTS (Events / Conditions / Actions)
// ═══════════════════════════════════════════════════════════════════════════════

tool("list_rule_components", "List all components (events, conditions, actions) of a rule", {
  rule_id: z.string().describe("Rule ID"),
}, async ({ rule_id }) => {
  return reactor("GET", `/rules/${rule_id}/rule_components`);
});

tool("create_rule_component", "Add an event, condition, or action to a rule", {
  rule_id:               z.string().describe("Rule ID this component belongs to"),
  extension_id:          z.string().describe("Extension ID that provides this component type"),
  delegate_descriptor_id: z.string().describe(
    "Component type. Events: core::events::dom-ready, core::events::window-loaded, core::events::click, core::events::custom-event, core::events::direct-call, core::events::history-change. Conditions: core::conditions::path-and-querystring, core::conditions::domain, core::conditions::cookie, core::conditions::custom-code, core::conditions::variable. Actions: core::actions::custom-code, adobe-analytics::actions::set-variables, adobe-analytics::actions::send-beacon, adobe-analytics::actions::clear-variables"
  ),
  name:         z.string().optional().describe("Component name/label"),
  settings:     z.string().optional().describe("Component settings as JSON string"),
  order:        z.number().optional().describe("Order within the rule (for conditions/actions)"),
  rule_order:   z.number().optional().describe("Rule execution order"),
  timeout:      z.number().optional().describe("Timeout in ms (for conditions)"),
  negate:       z.boolean().optional().describe("Negate condition result"),
}, async ({ rule_id, extension_id, delegate_descriptor_id, name, settings, order, rule_order, timeout, negate }) => {
  const attributes = { delegate_descriptor_id };
  if (name !== undefined)       attributes.name = name;
  if (settings !== undefined)   attributes.settings = settings;
  if (order !== undefined)      attributes.order = order;
  if (rule_order !== undefined) attributes.rule_order = rule_order;
  if (timeout !== undefined)    attributes.timeout = timeout;
  if (negate !== undefined)     attributes.negate = negate;

  return reactor("POST", "/rule_components", {
    data: {
      type: "rule_components",
      attributes,
      relationships: {
        extension: { data: { id: extension_id, type: "extensions" } },
        rules:     { data: [{ id: rule_id, type: "rules" }] },
      },
    },
  });
});

tool("update_rule_component", "Update a rule component's settings or order", {
  rule_component_id:     z.string().describe("Rule component ID"),
  name:                  z.string().optional(),
  settings:              z.string().optional().describe("New settings as JSON string"),
  order:                 z.number().optional(),
  negate:                z.boolean().optional(),
  delegate_descriptor_id: z.string().optional(),
}, async ({ rule_component_id, name, settings, order, negate, delegate_descriptor_id }) => {
  const attributes = {};
  if (name !== undefined)                  attributes.name = name;
  if (settings !== undefined)              attributes.settings = settings;
  if (order !== undefined)                 attributes.order = order;
  if (negate !== undefined)                attributes.negate = negate;
  if (delegate_descriptor_id !== undefined) attributes.delegate_descriptor_id = delegate_descriptor_id;

  return reactor("PATCH", `/rule_components/${rule_component_id}`, {
    data: { id: rule_component_id, type: "rule_components", attributes },
  });
});

tool("delete_rule_component", "Delete a rule component (event, condition, or action)", {
  rule_component_id: z.string().describe("Rule component ID"),
}, async ({ rule_component_id }) => {
  await reactor("DELETE", `/rule_components/${rule_component_id}`);
  return `Rule component ${rule_component_id} deleted successfully.`;
});

// ═══════════════════════════════════════════════════════════════════════════════
// LIBRARIES & PUBLISHING
// ═══════════════════════════════════════════════════════════════════════════════

tool("list_libraries", "List all libraries on a property", {
  property_id: z.string().describe("Property ID"),
}, async ({ property_id }) => {
  return reactor("GET", `/properties/${property_id}/libraries`);
});

tool("create_library", "Create a new library on a property", {
  property_id:    z.string().describe("Property ID"),
  name:           z.string().describe("Library name, e.g. 'Release 1.0'"),
  environment_id: z.string().optional().describe("Environment ID to link (development environment recommended)"),
}, async ({ property_id, name, environment_id }) => {
  const data = { type: "libraries", attributes: { name } };
  if (environment_id) {
    data.relationships = {
      environment: { data: { id: environment_id, type: "environments" } },
    };
  }
  return reactor("POST", `/properties/${property_id}/libraries`, { data });
});

tool("add_resources_to_library", "Add rules, data elements, or extensions to a library", {
  library_id: z.string().describe("Library ID"),
  resources:  z.array(z.object({
    id:     z.string().describe("Resource ID"),
    type:   z.enum(["rules", "data_elements", "extensions"]).describe("Resource type"),
    revise: z.boolean().optional().describe("Auto-revise before adding (sets meta.action to revise_and_add)"),
  })).describe("Array of resources to add"),
}, async ({ library_id, resources }) => {
  const data = resources.map(({ id, type, revise }) => {
    const item = { id, type };
    if (revise) item.meta = { action: "revise_and_add" };
    return item;
  });
  return reactor("POST", `/libraries/${library_id}/relationships/resources`, data);
});

tool("build_library", "Trigger a build for a library", {
  library_id: z.string().describe("Library ID"),
}, async ({ library_id }) => {
  return reactor("POST", `/libraries/${library_id}/builds`);
});

tool("transition_library", "Transition a library through the publishing workflow", {
  library_id: z.string().describe("Library ID"),
  action:     z.enum(["submit", "approve", "reject", "develop"]).describe(
    "submit: move to submitted | approve: approve for publishing | reject: send back | develop: move back to development"
  ),
}, async ({ library_id, action }) => {
  return reactor("PATCH", `/libraries/${library_id}`, {
    data: { id: library_id, type: "libraries", attributes: { action } },
  });
});

tool("get_library_build_status", "Get the latest build status for a library", {
  library_id: z.string().describe("Library ID"),
}, async ({ library_id }) => {
  return reactor("GET", `/libraries/${library_id}/builds`);
});

tool("full_publish_workflow", "Composite: build library → submit → approve in sequence", {
  library_id: z.string().describe("Library ID to publish"),
}, async ({ library_id }) => {
  dbg.info(`  [full_publish_workflow] library=${library_id}`);
  const results = {};

  dbg.info("  📦 Step 1/3: Building library...");
  results.build = await reactor("POST", `/libraries/${library_id}/builds`);
  dbg.info(`  build id: ${results.build?.data?.id}`);

  dbg.info("  ⏳ Waiting 2s for build to register...");
  await new Promise((r) => setTimeout(r, 2000));

  dbg.info("  📤 Step 2/3: Submitting library...");
  results.submit = await reactor("PATCH", `/libraries/${library_id}`, {
    data: { id: library_id, type: "libraries", attributes: { action: "submit" } },
  });
  dbg.info(`  state after submit: ${results.submit?.data?.attributes?.state}`);

  dbg.info("  ✅ Step 3/3: Approving library...");
  results.approve = await reactor("PATCH", `/libraries/${library_id}`, {
    data: { id: library_id, type: "libraries", attributes: { action: "approve" } },
  });
  dbg.info(`  state after approve: ${results.approve?.data?.attributes?.state}`);

  return {
    message: `Library ${library_id} built, submitted, and approved for publishing.`,
    build_id:      results.build?.data?.id,
    library_state: results.approve?.data?.attributes?.state,
  };
});

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENTS & HOSTS
// ═══════════════════════════════════════════════════════════════════════════════

tool("list_environments", "List all environments on a property", {
  property_id: z.string().describe("Property ID"),
}, async ({ property_id }) => {
  return reactor("GET", `/properties/${property_id}/environments`);
});

tool("create_environment", "Create a new environment on a property", {
  property_id: z.string().describe("Property ID"),
  name:        z.string().describe("Environment name"),
  stage:       z.enum(["development", "staging", "production"]).describe("Environment stage"),
  host_id:     z.string().optional().describe("Host ID to link to this environment"),
}, async ({ property_id, name, stage, host_id }) => {
  const data = { type: "environments", attributes: { name, stage } };
  if (host_id) {
    data.relationships = { host: { data: { id: host_id, type: "hosts" } } };
  }
  return reactor("POST", `/properties/${property_id}/environments`, { data });
});

tool("list_hosts", "List all hosts on a property", {
  property_id: z.string().describe("Property ID"),
}, async ({ property_id }) => {
  return reactor("GET", `/properties/${property_id}/hosts`);
});

tool("create_akamai_host", "Create an Akamai-managed host on a property", {
  property_id: z.string().describe("Property ID"),
  name:        z.string().describe("Host name, e.g. 'Production Akamai Host'"),
}, async ({ property_id, name }) => {
  return reactor("POST", `/properties/${property_id}/hosts`, {
    data: { type: "hosts", attributes: { name, type_of: "akamai" } },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════════════════════

tool("search_resources", "Full-text search across resources in a property", {
  property_id: z.string().describe("Property ID"),
  query:       z.string().describe("Search query string"),
  type_in:     z.string().optional().describe("Comma-separated resource types to filter: rules,data_elements,extensions,rule_components"),
}, async ({ property_id, query, type_in }) => {
  const attributes = { query };
  if (type_in) attributes.type_in = type_in;
  return reactor("POST", `/properties/${property_id}/search`, {
    data: { type: "search", attributes },
  });
});

tool("list_audit_events", "List audit events (change history) for a property", {
  property_id: z.string().describe("Property ID"),
  page_size:   z.number().optional().describe("Results per page (default 25)"),
}, async ({ property_id, page_size }) => {
  return reactor("GET", `/audit_events`, null, {
    "filter[property_id]": property_id,
    "page[size]":          page_size || 25,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NOTES  (annotations on any resource)
// ═══════════════════════════════════════════════════════════════════════════════

tool("list_notes", "List notes on a resource (rule, data_element, extension, library, property, rule_component)", {
  resource_type: z.enum(["rules","data_elements","extensions","libraries","properties","rule_components"]).describe("Resource type"),
  resource_id:   z.string().describe("Resource ID"),
}, async ({ resource_type, resource_id }) => {
  return reactor("GET", `/${resource_type}/${resource_id}/notes`);
});

tool("create_note", "Add a note/annotation to a resource", {
  resource_type: z.enum(["rules","data_elements","extensions","libraries","properties","rule_components"]).describe("Resource type"),
  resource_id:   z.string().describe("Resource ID"),
  text:          z.string().describe("Note text content"),
}, async ({ resource_type, resource_id, text }) => {
  return reactor("POST", `/${resource_type}/${resource_id}/notes`, {
    data: { type: "notes", attributes: { text } },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CALLBACKS  (webhooks for audit events)
// ═══════════════════════════════════════════════════════════════════════════════

tool("list_callbacks", "List all webhooks/callbacks on a property", {
  property_id: z.string().describe("Property ID"),
}, async ({ property_id }) => {
  return reactor("GET", `/properties/${property_id}/callbacks`);
});

tool("create_callback", "Create a webhook callback for audit events on a property", {
  property_id:  z.string().describe("Property ID"),
  url:          z.string().describe("Webhook URL to receive POST requests"),
  subscriptions: z.array(z.string()).optional().describe("Event types to subscribe to, e.g. ['rule.created','rule.updated']"),
}, async ({ property_id, url, subscriptions }) => {
  const attributes = { url };
  if (subscriptions?.length) attributes.subscriptions = subscriptions;
  return reactor("POST", `/properties/${property_id}/callbacks`, {
    data: { type: "callbacks", attributes },
  });
});

tool("get_callback", "Get details of a specific callback", {
  callback_id: z.string().describe("Callback ID"),
}, async ({ callback_id }) => {
  return reactor("GET", `/callbacks/${callback_id}`);
});

tool("update_callback", "Update a callback's URL or subscriptions", {
  callback_id:   z.string().describe("Callback ID"),
  url:           z.string().optional().describe("New webhook URL"),
  subscriptions: z.array(z.string()).optional().describe("New subscriptions list"),
}, async ({ callback_id, url, subscriptions }) => {
  const attributes = {};
  if (url)           attributes.url = url;
  if (subscriptions) attributes.subscriptions = subscriptions;
  return reactor("PATCH", `/callbacks/${callback_id}`, {
    data: { id: callback_id, type: "callbacks", attributes },
  });
});

tool("delete_callback", "Delete a webhook callback", {
  callback_id: z.string().describe("Callback ID"),
}, async ({ callback_id }) => {
  await reactor("DELETE", `/callbacks/${callback_id}`);
  return `Callback ${callback_id} deleted.`;
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUILDS  (compiled library artifacts)
// ═══════════════════════════════════════════════════════════════════════════════

tool("get_build", "Get details of a specific build", {
  build_id: z.string().describe("Build ID"),
}, async ({ build_id }) => {
  return reactor("GET", `/builds/${build_id}`);
});

tool("list_property_builds", "List all builds for a property across all libraries", {
  property_id: z.string().describe("Property ID"),
  page_size:   z.number().optional().describe("Results per page"),
}, async ({ property_id, page_size }) => {
  return reactor("GET", `/properties/${property_id}/builds`, null, {
    "page[size]": page_size || 25,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECRETS  (for event forwarding / edge properties)
// ═══════════════════════════════════════════════════════════════════════════════

tool("list_secrets", "List all secrets on an edge property", {
  property_id: z.string().describe("Property ID (must be edge platform)"),
}, async ({ property_id }) => {
  return reactor("GET", `/properties/${property_id}/secrets`);
});

tool("create_secret", "Create a secret for event forwarding authentication", {
  property_id: z.string().describe("Property ID (edge platform)"),
  name:        z.string().describe("Secret name"),
  type_of:     z.enum(["token","simple-http","oauth2-client-credentials","oauth2-google-adsapi"]).describe("Secret type"),
  value:       z.string().optional().describe("Secret value (for token type)"),
  credentials: z.string().optional().describe("Credentials as JSON string (for oauth types)"),
}, async ({ property_id, name, type_of, value, credentials }) => {
  const attributes = { name, type_of };
  if (value)       attributes.value = value;
  if (credentials) {
    try { Object.assign(attributes, JSON.parse(credentials)); } catch { attributes.credentials = credentials; }
  }
  return reactor("POST", `/properties/${property_id}/secrets`, {
    data: { type: "secrets", attributes },
  });
});

tool("get_secret", "Get details of a specific secret", {
  secret_id: z.string().describe("Secret ID"),
}, async ({ secret_id }) => {
  return reactor("GET", `/secrets/${secret_id}`);
});

tool("update_secret", "Update a secret's value", {
  secret_id: z.string().describe("Secret ID"),
  value:     z.string().optional().describe("New secret value"),
}, async ({ secret_id, value }) => {
  return reactor("PATCH", `/secrets/${secret_id}`, {
    data: { id: secret_id, type: "secrets", attributes: { value } },
  });
});

tool("delete_secret", "Delete a secret", {
  secret_id: z.string().describe("Secret ID"),
}, async ({ secret_id }) => {
  await reactor("DELETE", `/secrets/${secret_id}`);
  return `Secret ${secret_id} deleted.`;
});

// ═══════════════════════════════════════════════════════════════════════════════
// SFTP HOSTS
// ═══════════════════════════════════════════════════════════════════════════════

tool("create_sftp_host", "Create an SFTP host for self-hosting tag libraries", {
  property_id: z.string().describe("Property ID"),
  name:        z.string().describe("Host name"),
  server:      z.string().describe("SFTP server hostname"),
  username:    z.string().describe("SFTP username"),
  encrypted_private_key: z.string().optional().describe("Encrypted private key for SFTP auth"),
  path:        z.string().optional().describe("Remote path on SFTP server"),
  port:        z.number().optional().describe("SFTP port (default 22)"),
}, async ({ property_id, name, server, username, encrypted_private_key, path: remotePath, port }) => {
  const attributes = { name, type_of: "sftp", server, username };
  if (encrypted_private_key) attributes.encrypted_private_key = encrypted_private_key;
  if (remotePath) attributes.path = remotePath;
  if (port)       attributes.port = port;
  return reactor("POST", `/properties/${property_id}/hosts`, {
    data: { type: "hosts", attributes },
  });
});

tool("get_host", "Get details of a specific host", {
  host_id: z.string().describe("Host ID"),
}, async ({ host_id }) => {
  return reactor("GET", `/hosts/${host_id}`);
});

tool("update_host", "Update a host's configuration", {
  host_id: z.string().describe("Host ID"),
  name:    z.string().optional().describe("New host name"),
  server:  z.string().optional().describe("New server hostname (SFTP only)"),
  username: z.string().optional().describe("New username (SFTP only)"),
}, async ({ host_id, name, server, username }) => {
  const attributes = {};
  if (name)     attributes.name = name;
  if (server)   attributes.server = server;
  if (username) attributes.username = username;
  return reactor("PATCH", `/hosts/${host_id}`, {
    data: { id: host_id, type: "hosts", attributes },
  });
});

tool("delete_host", "Delete a host", {
  host_id: z.string().describe("Host ID"),
}, async ({ host_id }) => {
  await reactor("DELETE", `/hosts/${host_id}`);
  return `Host ${host_id} deleted.`;
});

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENTS — additional operations
// ═══════════════════════════════════════════════════════════════════════════════

tool("get_environment", "Get details of a specific environment", {
  environment_id: z.string().describe("Environment ID"),
}, async ({ environment_id }) => {
  return reactor("GET", `/environments/${environment_id}`);
});

tool("update_environment", "Update an environment's name or linked host", {
  environment_id: z.string().describe("Environment ID"),
  name:           z.string().optional().describe("New environment name"),
  host_id:        z.string().optional().describe("New host ID to link"),
}, async ({ environment_id, name, host_id }) => {
  const data = { id: environment_id, type: "environments", attributes: {} };
  if (name) data.attributes.name = name;
  if (host_id) data.relationships = { host: { data: { id: host_id, type: "hosts" } } };
  return reactor("PATCH", `/environments/${environment_id}`, { data });
});

tool("delete_environment", "Delete an environment", {
  environment_id: z.string().describe("Environment ID"),
}, async ({ environment_id }) => {
  await reactor("DELETE", `/environments/${environment_id}`);
  return `Environment ${environment_id} deleted.`;
});

// ═══════════════════════════════════════════════════════════════════════════════
// LIBRARY RESOURCES — management
// ═══════════════════════════════════════════════════════════════════════════════

tool("get_library", "Get details of a specific library", {
  library_id: z.string().describe("Library ID"),
}, async ({ library_id }) => {
  return reactor("GET", `/libraries/${library_id}`);
});

tool("update_library", "Update a library's name or linked environment", {
  library_id:     z.string().describe("Library ID"),
  name:           z.string().optional().describe("New library name"),
  environment_id: z.string().optional().describe("New environment ID to link"),
}, async ({ library_id, name, environment_id }) => {
  const data = { id: library_id, type: "libraries", attributes: {} };
  if (name) data.attributes.name = name;
  if (environment_id) data.relationships = { environment: { data: { id: environment_id, type: "environments" } } };
  return reactor("PATCH", `/libraries/${library_id}`, { data });
});

tool("delete_library", "Delete a library", {
  library_id: z.string().describe("Library ID"),
}, async ({ library_id }) => {
  await reactor("DELETE", `/libraries/${library_id}`);
  return `Library ${library_id} deleted.`;
});

tool("remove_resources_from_library", "Remove rules, data elements, or extensions from a library", {
  library_id: z.string().describe("Library ID"),
  resources:  z.array(z.object({
    id:   z.string().describe("Resource ID"),
    type: z.enum(["rules","data_elements","extensions"]).describe("Resource type"),
  })).describe("Resources to remove"),
}, async ({ library_id, resources }) => {
  return reactor("DELETE", `/libraries/${library_id}/relationships/resources`, resources);
});

tool("list_library_resources", "List all resources currently in a library", {
  library_id: z.string().describe("Library ID"),
}, async ({ library_id }) => {
  return reactor("GET", `/libraries/${library_id}/resources`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// COPY RESOURCES  (copy rules/data elements/extensions between properties)
// ═══════════════════════════════════════════════════════════════════════════════

tool("copy_resource", "Copy a resource (rule, data element, extension) to another property", {
  resource_type:       z.enum(["rules","data_elements","extensions"]).describe("Resource type to copy"),
  resource_id:         z.string().describe("Source resource ID"),
  target_property_id:  z.string().describe("Destination property ID"),
}, async ({ resource_type, resource_id, target_property_id }) => {
  return reactor("POST", `/${resource_type}/${resource_id}/copy`, {
    data: {
      type: resource_type,
      relationships: {
        property: { data: { id: target_property_id, type: "properties" } },
      },
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXTENSION PACKAGE — detailed info
// ═══════════════════════════════════════════════════════════════════════════════

tool("get_extension_package", "Get full details of a specific extension package", {
  extension_package_id: z.string().describe("Extension package ID"),
}, async ({ extension_package_id }) => {
  return reactor("GET", `/extension_packages/${extension_package_id}`);
});

tool("list_extension_package_usage_authorizations", "List properties authorized to use a private extension package", {
  extension_package_id: z.string().describe("Extension package ID"),
}, async ({ extension_package_id }) => {
  return reactor("GET", `/extension_packages/${extension_package_id}/extension_package_usage_authorizations`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE  (current user/credential info)
// ═══════════════════════════════════════════════════════════════════════════════

tool("get_profile", "Get the profile of the currently authenticated credential", {}, async () => {
  return reactor("GET", "/profile");
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSITE — advanced workflows
// ═══════════════════════════════════════════════════════════════════════════════

tool("create_rule_with_components", "Composite: create a rule and add event + optional condition + action in one shot", {
  property_id:   z.string().describe("Property ID"),
  rule_name:     z.string().describe("Rule name"),
  extension_id:  z.string().describe("Core extension ID (from list_extensions)"),
  event_type:    z.string().describe("Event delegate_descriptor_id, e.g. core::events::dom-ready"),
  event_settings: z.string().optional().describe("Event settings as JSON string"),
  condition_type: z.string().optional().describe("Condition delegate_descriptor_id (optional)"),
  condition_settings: z.string().optional().describe("Condition settings as JSON string"),
  action_type:   z.string().optional().describe("Action delegate_descriptor_id (optional)"),
  action_settings: z.string().optional().describe("Action settings as JSON string"),
}, async ({ property_id, rule_name, extension_id, event_type, event_settings, condition_type, condition_settings, action_type, action_settings }) => {
  dbg.info(`  [create_rule_with_components] property=${property_id} rule="${rule_name}"`);

  // 1. Create rule
  const ruleRes = await reactor("POST", `/properties/${property_id}/rules`, {
    data: { type: "rules", attributes: { name: rule_name } },
  });
  const rule_id = ruleRes.data.id;
  dbg.info(`  ✅ Rule created: ${rule_id}`);

  const components = [];

  // 2. Add event
  const eventRes = await reactor("POST", "/rule_components", {
    data: {
      type: "rule_components",
      attributes: {
        delegate_descriptor_id: event_type,
        name: "Event",
        ...(event_settings ? { settings: event_settings } : {}),
      },
      relationships: {
        extension: { data: { id: extension_id, type: "extensions" } },
        rules:     { data: [{ id: rule_id, type: "rules" }] },
      },
    },
  });
  components.push({ type: "event", id: eventRes.data.id });
  dbg.info(`  ✅ Event component: ${eventRes.data.id}`);

  // 3. Add condition (optional)
  if (condition_type) {
    const condRes = await reactor("POST", "/rule_components", {
      data: {
        type: "rule_components",
        attributes: {
          delegate_descriptor_id: condition_type,
          name: "Condition",
          order: 0,
          ...(condition_settings ? { settings: condition_settings } : {}),
        },
        relationships: {
          extension: { data: { id: extension_id, type: "extensions" } },
          rules:     { data: [{ id: rule_id, type: "rules" }] },
        },
      },
    });
    components.push({ type: "condition", id: condRes.data.id });
    dbg.info(`  ✅ Condition component: ${condRes.data.id}`);
  }

  // 4. Add action (optional)
  if (action_type) {
    const actRes = await reactor("POST", "/rule_components", {
      data: {
        type: "rule_components",
        attributes: {
          delegate_descriptor_id: action_type,
          name: "Action",
          order: 0,
          ...(action_settings ? { settings: action_settings } : {}),
        },
        relationships: {
          extension: { data: { id: extension_id, type: "extensions" } },
          rules:     { data: [{ id: rule_id, type: "rules" }] },
        },
      },
    });
    components.push({ type: "action", id: actRes.data.id });
    dbg.info(`  ✅ Action component: ${actRes.data.id}`);
  }

  return {
    rule_id,
    rule_name,
    components,
    message: `Rule "${rule_name}" created with ${components.length} component(s).`,
  };
});

tool("clone_property_rules_to_property", "Composite: copy all rules from one property to another", {
  source_property_id: z.string().describe("Source property ID to copy rules from"),
  target_property_id: z.string().describe("Target property ID to copy rules to"),
}, async ({ source_property_id, target_property_id }) => {
  dbg.info(`  [clone_rules] ${source_property_id} → ${target_property_id}`);
  const rulesRes = await reactor("GET", `/properties/${source_property_id}/rules`);
  const rules    = rulesRes.data || [];
  const results  = [];

  for (const rule of rules) {
    try {
      const copied = await reactor("POST", `/rules/${rule.id}/copy`, {
        data: {
          type: "rules",
          relationships: { property: { data: { id: target_property_id, type: "properties" } } },
        },
      });
      results.push({ source_id: rule.id, target_id: copied.data?.id, name: rule.attributes.name, status: "copied" });
      dbg.info(`  ✅ Copied rule: ${rule.attributes.name}`);
    } catch (err) {
      results.push({ source_id: rule.id, name: rule.attributes.name, status: "failed", error: err.message });
      dbg.error(`  ❌ Failed to copy rule ${rule.attributes.name}: ${err.message}`);
    }
  }

  return {
    total: rules.length,
    copied: results.filter((r) => r.status === "copied").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
});

tool("publish_all_changes", "Composite: create library with ALL unpublished rules+data elements+extensions, build and publish", {
  property_id:    z.string().describe("Property ID"),
  library_name:   z.string().describe("Library name, e.g. 'Release 2.0'"),
  environment_id: z.string().describe("Development environment ID to build against"),
}, async ({ property_id, library_name, environment_id }) => {
  dbg.info(`  [publish_all_changes] property=${property_id} library="${library_name}"`);

  // 1. Create library
  const libRes = await reactor("POST", `/properties/${property_id}/libraries`, {
    data: {
      type: "libraries",
      attributes: { name: library_name },
      relationships: { environment: { data: { id: environment_id, type: "environments" } } },
    },
  });
  const library_id = libRes.data.id;
  dbg.info(`  ✅ Library created: ${library_id}`);

  // 2. Gather all resources
  const [rulesRes, deRes, extRes] = await Promise.all([
    reactor("GET", `/properties/${property_id}/rules`),
    reactor("GET", `/properties/${property_id}/data_elements`),
    reactor("GET", `/properties/${property_id}/extensions`),
  ]);

  const resources = [
    ...rulesRes.data.map((r) => ({ id: r.id, type: "rules", meta: { action: "revise_and_add" } })),
    ...deRes.data.map((d) => ({ id: d.id, type: "data_elements", meta: { action: "revise_and_add" } })),
    ...extRes.data.map((e) => ({ id: e.id, type: "extensions", meta: { action: "revise_and_add" } })),
  ];
  dbg.info(`  📦 Adding ${resources.length} resources to library...`);

  // 3. Add all resources
  await reactor("POST", `/libraries/${library_id}/relationships/resources`, resources);

  // 4. Build
  dbg.info("  🔨 Building...");
  const buildRes = await reactor("POST", `/libraries/${library_id}/builds`);
  await new Promise((r) => setTimeout(r, 2000));

  // 5. Submit
  dbg.info("  📤 Submitting...");
  await reactor("PATCH", `/libraries/${library_id}`, {
    data: { id: library_id, type: "libraries", attributes: { action: "submit" } },
  });

  // 6. Approve
  dbg.info("  ✅ Approving...");
  const approveRes = await reactor("PATCH", `/libraries/${library_id}`, {
    data: { id: library_id, type: "libraries", attributes: { action: "approve" } },
  });

  return {
    library_id,
    library_name,
    build_id:      buildRes.data?.id,
    library_state: approveRes.data?.attributes?.state,
    resources_added: resources.length,
    message: `All ${resources.length} resources packaged, built, and approved for publishing.`,
  };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AEP (Adobe Experience Platform) TOOLS
  // ═══════════════════════════════════════════════════════════════════════════
  registerAepTools({ tool, getAccessToken, CLIENT_ID, ORG_ID, dbg, axios, sandboxName: SANDBOX_NAME });

  dbg.info("✅ Adobe Launch + AEP MCP server instance created (74 Reactor + 196 AEP = 270 tools total)");
  return server;
}
