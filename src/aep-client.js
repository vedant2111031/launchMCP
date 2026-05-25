/**
 * Adobe Experience Platform — Shared HTTP Client
 *
 * Mirrors the reactor() helper in mcp-server.js exactly:
 *   - Same credential-injection pattern (no module-level singletons)
 *   - Same axios call signature
 *   - Same dbg.http / dbg.verbose / dbg.error logging
 *   - Same error normalisation
 *
 * Usage (inside registerAepTools or any future AEP module):
 *
 *   import { createAepClient } from "./aep-client.js";
 *
 *   const { aep, aepHeaders } = createAepClient({
 *     getAccessToken, CLIENT_ID, ORG_ID, dbg, axios,
 *     sandboxNameOverride: "tothenew3",   // optional per-session override
 *   });
 *
 *   // Standard JSON call
 *   const data = await aep("GET", "/data/foundation/catalog/datasets");
 *
 *   // Call with a different Accept header (schema registry, etc.)
 *   const schemas = await aep("GET", "/data/foundation/schemaregistry/tenant/schemas", null, { limit: 20 }, {
 *     Accept: "application/vnd.adobe.xed-id+json",
 *   });
 *
 *   // Streaming / batch-upload — build headers manually and use your own fetch/axios call
 *   const headers = await aepHeaders("POST");
 *   await fetch("https://dcs.adobedc.net/collection/...", { method: "POST", headers, body });
 *
 * Environment variables read at call-time (not import-time):
 *   AEP_SANDBOX_NAME   — sandbox to target (default: "prod")
 */

export const AEP_BASE = "https://platform.adobe.io";

/**
 * Create a bound AEP HTTP client for one credential set.
 *
 * @param {object}   opts
 * @param {Function} opts.getAccessToken      async () => string — IMS Bearer token
 * @param {string}   opts.CLIENT_ID           Adobe credential client_id (= x-api-key)
 * @param {string}   opts.ORG_ID              Adobe IMS org id (= x-gw-ims-org-id)
 * @param {object}   opts.dbg                 Logger: { info, verbose, error, http }
 * @param {Function} opts.axios               axios function (passed in to avoid re-importing)
 * @param {string}   [opts.sandboxNameOverride] Per-session sandbox name (never mutates process.env)
 *
 * @returns {{ aep: Function, aepHeaders: Function }}
 */
export function createAepClient({ getAccessToken, CLIENT_ID, ORG_ID, dbg, axios, sandboxNameOverride }) {
  // Resolve sandbox: per-session override → env var → default "prod"
  function sandboxName() {
    return sandboxNameOverride || process.env.AEP_SANDBOX_NAME || "prod";
  }

  // ─── aepHeaders ─────────────────────────────────────────────────────────────
  /**
   * Build the standard AEP request headers.
   *
   * Content-Type is intentionally omitted for GET/DELETE/HEAD — sending it on
   * body-less requests causes some AEP gateway endpoints to return 400
   * "Request body could not be parsed".
   *
   * @param {string}  [method="GET"]  HTTP verb — controls whether Content-Type is included
   * @param {object}  [extra={}]      Headers to merge / override (e.g. Accept for schema registry)
   * @returns {Promise<object>}       Plain header object ready for fetch / axios.
   */
  async function aepHeaders(method = "GET", extra = {}) {
    const token = await getAccessToken();
    const base = {
      Authorization:     `Bearer ${token}`,
      "x-api-key":       CLIENT_ID,
      "x-gw-ims-org-id": ORG_ID,
      "x-sandbox-name":  sandboxName(),
      Accept:            "application/json",
    };
    // Only attach Content-Type when there is a body
    const verb = (method || "GET").toUpperCase();
    if (verb !== "GET" && verb !== "DELETE" && verb !== "HEAD") {
      base["Content-Type"] = "application/json";
    }
    return { ...base, ...extra };
  }

  // ─── aep ────────────────────────────────────────────────────────────────────
  /**
   * Make an authenticated AEP API call.
   *
   * @param {string}  method        HTTP verb (GET, POST, PATCH, PUT, DELETE)
   * @param {string}  path          Path relative to AEP_BASE
   * @param {*}       [data=null]   Request body (serialised to JSON by axios)
   * @param {object}  [params={}]   URL query parameters
   * @param {object}  [extra={}]    Extra / override headers (e.g. Accept for schema registry)
   * @returns {Promise<*>}          Parsed response body (res.data)
   */
  async function aep(method, path, data = null, params = {}, extra = {}) {
    const headers = await aepHeaders(method, extra);
    const url     = `${AEP_BASE}${path}`;

    dbg.verbose(`→ AEP ${method.toUpperCase()} ${path}`, Object.keys(params).length ? params : "");
    if (data && process.env.DEBUG === "true") {
      dbg.verbose("  body:", JSON.stringify(data).slice(0, 300));
    }

    const t0 = Date.now();
    try {
      const res = await axios({ method, url, headers, data, params });
      const ms  = Date.now() - t0;
      dbg.http(method, `[AEP]${path}`, res.status, ms);
      return res.data;
    } catch (err) {
      const ms        = Date.now() - t0;
      const status    = err.response?.status || "ERR";
      const body      = err.response?.data;
      const requestId = err.response?.headers?.["x-request-id"] || null;
      dbg.http(method, `[AEP]${path}`, status, ms);

      // Normalise AEP error shapes: { type, title, detail, status }, { message }, { errors: [...] }
      const aepTitle  = body?.title;
      const aepDetail = body?.detail;
      const aepType   = body?.type;

      const msg =
        aepDetail ||
        aepTitle  ||
        body?.message ||
        (body?.errors ? JSON.stringify(body.errors) : null) ||
        (body         ? JSON.stringify(body)         : null) ||
        err.message;

      const parts = [`AEP API ${status}`];
      if (aepType)                      parts.push(`type=${aepType}`);
      if (aepTitle && aepTitle !== msg) parts.push(`title=${aepTitle}`);
      parts.push(msg);
      if (requestId)                    parts.push(`x-request-id=${requestId}`);

      const fullMsg = parts.join(" | ");
      dbg.error(`AEP error on ${method.toUpperCase()} ${path}: ${fullMsg}`);
      throw new Error(fullMsg);
    }
  }

  return { aep, aepHeaders };
}
