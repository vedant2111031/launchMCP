/**
 * Adobe Experience Platform (AEP) — MCP Tool Definitions
 * Registered into the shared McpServer instance built by mcp-server.js.
 *
 * Patterns followed exactly from mcp-server.js:
 *   - tool(name, description, zodSchema, asyncHandler)
 *   - aep(method, path, data, params) — mirrors reactor() but targets platform.adobe.io
 *   - All logs via dbg.info / dbg.verbose / dbg.error / dbg.http
 *   - Zod schemas inline, no external schema files
 *
 * Auth headers (same IMS token, same CLIENT_ID / ORG_ID):
 *   Authorization: Bearer <token>
 *   x-api-key: <CLIENT_ID>
 *   x-gw-ims-org-id: <ORG_ID>
 *   x-sandbox-name: <AEP_SANDBOX_NAME>   ← new, defaults to "prod"
 *
 * New env var:
 *   AEP_SANDBOX_NAME   (optional, default "prod")
 */

import { z } from "zod";
import { createAepClient } from "./aep-client.js";

/**
 * Register all AEP tools onto an existing McpServer instance.
 *
 * @param {object}   opts
 * @param {Function} opts.tool           - the local tool() wrapper from mcp-server.js
 * @param {Function} opts.getAccessToken - async () => string  (IMS Bearer token)
 * @param {string}   opts.CLIENT_ID      - Adobe credential client_id
 * @param {string}   opts.ORG_ID         - Adobe IMS org id
 * @param {object}   opts.dbg            - { info, verbose, error, http }
 * @param {Function} opts.axios          - axios function
 */
export function registerAepTools({ tool, getAccessToken, CLIENT_ID, ORG_ID, dbg, axios }) {
  // ─── Shared AEP HTTP client ─────────────────────────────────────────────────
  // aep(method, path, data?, params?, extraHeaders?) — authenticated, logged
  // aepHeaders(extra?)                               — raw headers for custom fetch
  const { aep, aepHeaders } = createAepClient({ getAccessToken, CLIENT_ID, ORG_ID, dbg, axios }); // eslint-disable-line no-unused-vars

  // Convenience alias used in composite tools that need the sandbox name in logs
  const SANDBOX = process.env.AEP_SANDBOX_NAME || "prod";

  // ═══════════════════════════════════════════════════════════════════════════
  // SANDBOXES
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_sandboxes", "Lists all sandboxes in the AEP organization. Use to discover available sandbox names before targeting a specific environment. No required params.", {}, async () => {
    return aep("GET", "/data/foundation/sandbox-management/sandboxes");
  });

  tool("aep_get_sandbox", "Gets details (type, state, region) of a specific AEP sandbox by name. Use to verify a sandbox exists and is active before running operations against it. Required: sandbox_name.", {
    sandbox_name: z.string().describe("Sandbox name, e.g. 'prod' or 'dev'"),
  }, async ({ sandbox_name }) => {
    return aep("GET", `/data/foundation/sandbox-management/sandboxes/${sandbox_name}`);
  });

  tool("aep_create_sandbox", "Creates a new AEP sandbox (development or production). Use when provisioning a new isolated environment for a team or project. Required: name (lowercase, no spaces), title, type.", {
    name:  z.string().describe("Unique sandbox name (lowercase, no spaces)"),
    title: z.string().describe("Human-readable sandbox title"),
    type:  z.enum(["development", "production"]).describe("Sandbox type"),
  }, async ({ name, title, type }) => {
    return aep("POST", "/data/foundation/sandbox-management/sandboxes", { name, title, type });
  });

  tool("aep_reset_sandbox", "Resets a development sandbox, deleting all objects inside it (schemas, datasets, segments, etc.). Use with caution — irreversible. Only works on type=development sandboxes. Required: sandbox_name.", {
    sandbox_name: z.string().describe("Sandbox name to reset (must be type=development)"),
  }, async ({ sandbox_name }) => {
    return aep("PUT", `/data/foundation/sandbox-management/sandboxes/${sandbox_name}`, {});
  });

  tool("aep_delete_sandbox", "Permanently deletes a development sandbox and all its contents. Irreversible — use only when decommissioning an environment. Required: sandbox_name.", {
    sandbox_name: z.string().describe("Sandbox name to delete"),
  }, async ({ sandbox_name }) => {
    return aep("DELETE", `/data/foundation/sandbox-management/sandboxes/${sandbox_name}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEMAS (XDM Schema Registry)
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_schemas", "Lists XDM schemas in the Schema Registry. Use to browse or search available schemas before creating datasets or segments. Optionally filter by container (tenant/global) and paginate with limit/start.", {
    container: z.enum(["global", "tenant"]).optional().describe("Registry container (default: tenant)"),
    limit:     z.number().optional().describe("Max results (default 20)"),
    start:     z.string().optional().describe("Pagination offset token"),
  }, async ({ container = "tenant", limit = 20, start }) => {
    const params = { limit };
    if (start) params.start = start;
    return aep("GET", `/schemaregistry/${container}/schemas`, null, params, {
      Accept: "application/vnd.adobe.xed-id+json",
    });
  });

  tool("aep_get_schema", "Retrieves the full definition of a specific XDM schema by its $id or short ID. Use to inspect field structure before building datasets or mappings. Required: schema_id.", {
    schema_id: z.string().describe("Schema $id (URL-encoded) or short ID like _tenant.schemas.abc123"),
    container: z.enum(["global", "tenant"]).optional().describe("Registry container (default: tenant)"),
  }, async ({ schema_id, container = "tenant" }) => {
    const encoded = encodeURIComponent(schema_id);
    return aep("GET", `/schemaregistry/${container}/schemas/${encoded}`, null, {}, {
      Accept: "application/vnd.adobe.xed+json;version=1",
    });
  });

  tool("aep_create_schema", "Creates a new XDM schema in the tenant container. Use when defining a new data model for a dataset or profile. Required: title. Provide meta_class ($id of the XDM class) and allOf (JSON array of field group $refs) to build a complete schema.", {
    title:       z.string().describe("Schema title"),
    description: z.string().optional().describe("Schema description"),
    type:        z.string().optional().describe("JSON Schema type, usually 'object'"),
    allOf:       z.string().optional().describe("JSON array of $ref mixins/classes as JSON string"),
    meta_class:  z.string().optional().describe("XDM class $id this schema extends"),
  }, async ({ title, description, type = "object", allOf, meta_class }) => {
    const body = { title, type };
    if (description) body.description = description;
    if (allOf)       body.allOf = JSON.parse(allOf);
    if (meta_class)  body["meta:class"] = meta_class;
    return aep("POST", "/schemaregistry/tenant/schemas", body);
  });

  tool("aep_update_schema", "Applies a JSON Patch to an existing XDM schema (e.g. add description, add field group reference). Use when modifying a schema without recreating it. Required: schema_id, patch (JSON Patch array as string).", {
    schema_id:   z.string().describe("Schema $id or short ID"),
    patch:       z.string().describe("JSON Patch array as JSON string, e.g. [{\"op\":\"add\",\"path\":\"/description\",\"value\":\"...\"}]"),
    container:   z.enum(["global", "tenant"]).optional(),
  }, async ({ schema_id, patch, container = "tenant" }) => {
    const encoded = encodeURIComponent(schema_id);
    return aep("PATCH", `/schemaregistry/${container}/schemas/${encoded}`, JSON.parse(patch), {}, {
      "Content-Type": "application/json-patch+json",
    });
  });

  tool("aep_delete_schema", "Permanently deletes an XDM schema from the tenant container. Only possible if no datasets reference it. Required: schema_id.", {
    schema_id: z.string().describe("Schema $id or short ID"),
  }, async ({ schema_id }) => {
    const encoded = encodeURIComponent(schema_id);
    await aep("DELETE", `/schemaregistry/tenant/schemas/${encoded}`);
    return `Schema ${schema_id} deleted.`;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CLASSES & MIXINS (Field Groups)
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_classes", "List XDM classes in the schema registry", {
    container: z.enum(["global", "tenant"]).optional(),
    limit:     z.number().optional(),
  }, async ({ container = "tenant", limit = 20 }) => {
    return aep("GET", `/schemaregistry/${container}/classes`, null, { limit }, {
      Accept: "application/vnd.adobe.xed-id+json",
    });
  });

  tool("aep_get_class", "Get a specific XDM class by ID", {
    class_id:  z.string().describe("Class $id or short ID"),
    container: z.enum(["global", "tenant"]).optional(),
  }, async ({ class_id, container = "tenant" }) => {
    const encoded = encodeURIComponent(class_id);
    return aep("GET", `/schemaregistry/${container}/classes/${encoded}`, null, {}, {
      Accept: "application/vnd.adobe.xed+json;version=1",
    });
  });

  tool("aep_list_field_groups", "List XDM field groups (mixins) in the schema registry", {
    container: z.enum(["global", "tenant"]).optional(),
    limit:     z.number().optional(),
  }, async ({ container = "tenant", limit = 20 }) => {
    return aep("GET", `/schemaregistry/${container}/fieldgroups`, null, { limit }, {
      Accept: "application/vnd.adobe.xed-id+json",
    });
  });

  tool("aep_get_field_group", "Get a specific XDM field group by ID", {
    field_group_id: z.string().describe("Field group $id or short ID"),
    container:      z.enum(["global", "tenant"]).optional(),
  }, async ({ field_group_id, container = "tenant" }) => {
    const encoded = encodeURIComponent(field_group_id);
    return aep("GET", `/schemaregistry/${container}/fieldgroups/${encoded}`, null, {}, {
      Accept: "application/vnd.adobe.xed+json;version=1",
    });
  });

  tool("aep_create_field_group", "Create a new XDM field group (mixin) in the tenant container", {
    title:       z.string().describe("Field group title"),
    description: z.string().optional(),
    meta_intendedToExtend: z.string().optional().describe("JSON array of class $ids this field group extends, as JSON string"),
    properties:  z.string().optional().describe("JSON object of field definitions"),
  }, async ({ title, description, meta_intendedToExtend, properties }) => {
    const body = { title, type: "object" };
    if (description)           body.description = description;
    if (meta_intendedToExtend) body["meta:intendedToExtend"] = JSON.parse(meta_intendedToExtend);
    if (properties)            body.properties = JSON.parse(properties);
    return aep("POST", "/schemaregistry/tenant/fieldgroups", body);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DATASETS
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_datasets", "Lists all datasets in the AEP catalog. Use to discover existing datasets before ingesting data or building segments. Supports pagination (limit, start) and sorting (orderBy, e.g. 'created:desc').", {
    limit:  z.number().optional().describe("Max results (default 20)"),
    start:  z.string().optional().describe("Pagination offset"),
    orderBy: z.string().optional().describe("Sort field, e.g. 'created:desc'"),
  }, async ({ limit = 20, start, orderBy }) => {
    const params = { limit };
    if (start)   params.start = start;
    if (orderBy) params.orderBy = orderBy;
    return aep("GET", "/data/foundation/catalog/datasets", null, params);
  });

  tool("aep_get_dataset", "Retrieves full metadata for a specific AEP dataset including schema reference, tags, and status. Use to inspect a dataset before ingesting data or enabling it for Profile. Required: dataset_id.", {
    dataset_id: z.string().describe("Dataset ID"),
  }, async ({ dataset_id }) => {
    return aep("GET", `/data/foundation/catalog/datasets/${dataset_id}`);
  });

  tool("aep_create_dataset", "Creates a new AEP dataset linked to an XDM schema. Use after creating a schema when you need a storage container for data ingestion. Required: name, schema_ref (schema $id).", {
    name:        z.string().describe("Dataset name"),
    description: z.string().optional(),
    schema_ref:  z.string().describe("Schema $id to link this dataset to"),
    tags:        z.string().optional().describe("JSON object of tags, e.g. {\"adobe/pqs/table\":[\"my_table\"]}"),
  }, async ({ name, description, schema_ref, tags }) => {
    const body = {
      name,
      schemaRef: { id: schema_ref, contentType: "application/vnd.adobe.xed+json;version=1" },
    };
    if (description) body.description = description;
    if (tags)        body.tags = JSON.parse(tags);
    return aep("POST", "/data/foundation/catalog/datasets", body);
  });

  tool("aep_delete_dataset", "Delete an AEP dataset", {
    dataset_id: z.string().describe("Dataset ID"),
  }, async ({ dataset_id }) => {
    await aep("DELETE", `/data/foundation/catalog/datasets/${dataset_id}`);
    return `Dataset ${dataset_id} deleted.`;
  });

  tool("aep_enable_dataset_for_profile", "Enables a dataset for Real-Time Customer Profile and Identity Service ingestion by adding the required unifiedProfile and unifiedIdentity tags. Run this after creating a dataset that should contribute to profile data. Required: dataset_id.", {
    dataset_id: z.string().describe("Dataset ID"),
  }, async ({ dataset_id }) => {
    return aep("PATCH", `/data/foundation/catalog/datasets/${dataset_id}`, [
      { op: "add", path: "/tags/unifiedProfile", value: ["enabled:true"] },
      { op: "add", path: "/tags/unifiedIdentity", value: ["enabled:true"] },
    ], {}, { "Content-Type": "application/json-patch+json" });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCHES & DATA INGESTION
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_batches", "List data ingestion batches in AEP", {
    dataset_id: z.string().optional().describe("Filter by dataset ID"),
    status:     z.string().optional().describe("Filter by status: success, failed, processing, staged"),
    limit:      z.number().optional(),
    start:      z.string().optional(),
  }, async ({ dataset_id, status, limit = 20, start }) => {
    const params = { limit };
    if (dataset_id) params.dataSet = dataset_id;
    if (status)     params.status = status;
    if (start)      params.start = start;
    return aep("GET", "/data/foundation/import/batches", null, params);
  });

  tool("aep_get_batch", "Get details of a specific ingestion batch", {
    batch_id: z.string().describe("Batch ID"),
  }, async ({ batch_id }) => {
    return aep("GET", `/data/foundation/import/batches/${batch_id}`);
  });

  tool("aep_create_batch", "Create a new ingestion batch for a dataset", {
    dataset_id:   z.string().describe("Target dataset ID"),
    input_format: z.enum(["json", "parquet", "csv", "delimited"]).optional().describe("Input file format (default: json)"),
  }, async ({ dataset_id, input_format = "json" }) => {
    return aep("POST", "/data/foundation/import/batches", {
      datasetId: dataset_id,
      inputFormat: { format: input_format },
    });
  });

  tool("aep_close_batch", "Signal that a batch upload is complete (triggers processing)", {
    batch_id: z.string().describe("Batch ID to close/complete"),
  }, async ({ batch_id }) => {
    return aep("POST", `/data/foundation/import/batches/${batch_id}?action=COMPLETE`);
  });

  tool("aep_get_batch_failed_files", "Get the list of failed files for a batch", {
    batch_id: z.string().describe("Batch ID"),
  }, async ({ batch_id }) => {
    return aep("GET", `/data/foundation/import/batches/${batch_id}/failed`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // REAL-TIME CUSTOMER PROFILE
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_get_profile", "Look up a Real-Time Customer Profile by identity", {
    entity_id:        z.string().describe("Identity value, e.g. an email or ECID"),
    entity_id_ns:     z.string().describe("Identity namespace code, e.g. 'Email', 'ECID', 'CRMID'"),
    schema_class_id:  z.string().optional().describe("XDM class $id (default: XDM Individual Profile)"),
  }, async ({ entity_id, entity_id_ns, schema_class_id }) => {
    const params = {
      entityId:    entity_id,
      entityIdNS:  entity_id_ns,
      schema_class_id: schema_class_id || "_xdm.context.profile",
    };
    return aep("GET", "/data/core/ups/access/entities", null, params);
  });

  tool("aep_get_profile_experiences", "Get ExperienceEvent records for a profile identity", {
    entity_id:    z.string().describe("Identity value"),
    entity_id_ns: z.string().describe("Identity namespace code"),
    limit:        z.number().optional().describe("Max events to return (default 1000)"),
  }, async ({ entity_id, entity_id_ns, limit = 1000 }) => {
    return aep("GET", "/data/core/ups/access/entities", null, {
      entityId:   entity_id,
      entityIdNS: entity_id_ns,
      "schema.name": "_xdm.context.experienceevent",
      resultType: "events",
      limit,
    });
  });

  tool("aep_delete_profile", "Delete a profile and all its data by identity (GDPR / privacy)", {
    entity_id:    z.string().describe("Identity value"),
    entity_id_ns: z.string().describe("Identity namespace code"),
  }, async ({ entity_id, entity_id_ns }) => {
    return aep("DELETE", "/data/core/ups/access/entities", null, {
      entityId:   entity_id,
      entityIdNS: entity_id_ns,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY NAMESPACES
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_identity_namespaces", "List all identity namespaces in the AEP organization", {}, async () => {
    return aep("GET", "/data/core/idnamespace/identities");
  });

  tool("aep_get_identity_namespace", "Get a specific identity namespace by code", {
    namespace_code: z.string().describe("Namespace code, e.g. 'Email', 'ECID', 'CRMID'"),
  }, async ({ namespace_code }) => {
    return aep("GET", `/data/core/idnamespace/identities/${namespace_code}`);
  });

  tool("aep_create_identity_namespace", "Create a custom identity namespace", {
    name:        z.string().describe("Display name"),
    code:        z.string().describe("Unique code (no spaces)"),
    id_type:     z.enum(["Cross_device", "Cookie", "Device", "Email", "Phone", "People"]).describe("Identity type"),
    description: z.string().optional(),
  }, async ({ name, code, id_type, description }) => {
    const body = { name, code, idType: id_type };
    if (description) body.description = description;
    return aep("POST", "/data/core/idnamespace/identities", body);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY GRAPH
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_get_identity_cluster", "Get all identities in the same identity cluster as a given identity", {
    entity_id:    z.string().describe("Identity value"),
    entity_id_ns: z.string().describe("Identity namespace code"),
    graph_type:   z.enum(["None", "Private"]).optional().describe("Graph type (default: Private)"),
  }, async ({ entity_id, entity_id_ns, graph_type = "Private" }) => {
    return aep("POST", "/data/core/identity/clusters/members", {
      xid: { nsid: entity_id_ns, id: entity_id },
      graph: { type: graph_type },
    });
  });

  tool("aep_get_identity_mapping", "Get all linked identities for a given identity (identity graph lookup)", {
    entity_id:    z.string().describe("Identity value"),
    entity_id_ns: z.string().describe("Identity namespace code"),
  }, async ({ entity_id, entity_id_ns }) => {
    return aep("GET", "/data/core/identity/mapping", null, {
      nsid:  entity_id_ns,
      id:    entity_id,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SEGMENTS / AUDIENCES
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_segments", "List all audience segment definitions in AEP", {
    limit:  z.number().optional(),
    start:  z.number().optional().describe("Pagination start index"),
  }, async ({ limit = 100, start = 0 }) => {
    return aep("GET", "/data/core/ups/segment/definitions", null, { limit, start });
  });

  tool("aep_get_segment", "Get a specific segment definition by ID", {
    segment_id: z.string().describe("Segment definition ID"),
  }, async ({ segment_id }) => {
    return aep("GET", `/data/core/ups/segment/definitions/${segment_id}`);
  });

  tool("aep_create_segment", "Create a new audience segment definition using PQL", {
    name:        z.string().describe("Segment name"),
    description: z.string().optional(),
    expression:  z.string().describe("PQL expression, e.g. \"workAddress.country = \\\"US\\\"\""),
    schema_name: z.string().optional().describe("XDM schema class name (default: _xdm.context.profile)"),
    merge_policy_id: z.string().optional().describe("Merge policy ID to use"),
  }, async ({ name, description, expression, schema_name, merge_policy_id }) => {
    const body = {
      name,
      expression: { type: "PQL", format: "pql/text", value: expression },
      schema: { name: schema_name || "_xdm.context.profile" },
    };
    if (description)     body.description = description;
    if (merge_policy_id) body.mergePolicyId = merge_policy_id;
    return aep("POST", "/data/core/ups/segment/definitions", body);
  });

  tool("aep_update_segment", "Update an existing segment definition", {
    segment_id:  z.string().describe("Segment definition ID"),
    name:        z.string().optional(),
    description: z.string().optional(),
    expression:  z.string().optional().describe("New PQL expression"),
  }, async ({ segment_id, name, description, expression }) => {
    const existing = await aep("GET", `/data/core/ups/segment/definitions/${segment_id}`);
    const body = { ...existing };
    if (name)        body.name = name;
    if (description) body.description = description;
    if (expression)  body.expression = { type: "PQL", format: "pql/text", value: expression };
    return aep("PUT", `/data/core/ups/segment/definitions/${segment_id}`, body);
  });

  tool("aep_delete_segment", "Delete a segment definition", {
    segment_id: z.string().describe("Segment definition ID"),
  }, async ({ segment_id }) => {
    await aep("DELETE", `/data/core/ups/segment/definitions/${segment_id}`);
    return `Segment ${segment_id} deleted.`;
  });

  tool("aep_estimate_segment", "Get an estimated profile count for a PQL expression", {
    expression:  z.string().describe("PQL expression to estimate"),
    schema_name: z.string().optional().describe("XDM schema class name (default: _xdm.context.profile)"),
  }, async ({ expression, schema_name }) => {
    return aep("POST", "/data/core/ups/estimate", {
      expression: { type: "PQL", format: "pql/text", value: expression },
      schema: { name: schema_name || "_xdm.context.profile" },
    });
  });

  tool("aep_preview_segment", "Preview profiles matching a PQL expression (sample results)", {
    expression:  z.string().describe("PQL expression"),
    schema_name: z.string().optional(),
  }, async ({ expression, schema_name }) => {
    return aep("POST", "/data/core/ups/preview", {
      expression: { type: "PQL", format: "pql/text", value: expression },
      schema: { name: schema_name || "_xdm.context.profile" },
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SEGMENT JOBS (batch segmentation)
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_segment_jobs", "List segment evaluation jobs", {
    status: z.string().optional().describe("Filter by status: QUEUED, PROCESSING, SUCCEEDED, FAILED"),
    limit:  z.number().optional(),
  }, async ({ status, limit = 100 }) => {
    const params = { limit };
    if (status) params.status = status;
    return aep("GET", "/data/core/ups/segment/jobs", null, params);
  });

  tool("aep_get_segment_job", "Get details of a specific segment job", {
    job_id: z.string().describe("Segment job ID"),
  }, async ({ job_id }) => {
    return aep("GET", `/data/core/ups/segment/jobs/${job_id}`);
  });

  tool("aep_create_segment_job", "Trigger a batch segment evaluation job for one or more segments", {
    segment_ids: z.array(z.string()).describe("Array of segment definition IDs to evaluate"),
  }, async ({ segment_ids }) => {
    return aep("POST", "/data/core/ups/segment/jobs", {
      segmentIds: segment_ids,
    });
  });

  tool("aep_cancel_segment_job", "Cancel a running segment job", {
    job_id: z.string().describe("Segment job ID to cancel"),
  }, async ({ job_id }) => {
    await aep("DELETE", `/data/core/ups/segment/jobs/${job_id}`);
    return `Segment job ${job_id} cancelled.`;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MERGE POLICIES
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_merge_policies", "List all merge policies for Real-Time Customer Profile", {
    limit: z.number().optional(),
  }, async ({ limit = 20 }) => {
    return aep("GET", "/data/core/ups/config/mergePolicies", null, { limit });
  });

  tool("aep_get_merge_policy", "Get a specific merge policy by ID", {
    merge_policy_id: z.string().describe("Merge policy ID"),
  }, async ({ merge_policy_id }) => {
    return aep("GET", `/data/core/ups/config/mergePolicies/${merge_policy_id}`);
  });

  tool("aep_create_merge_policy", "Create a new merge policy for Real-Time Customer Profile", {
    name:                z.string().describe("Merge policy name"),
    is_default:          z.boolean().optional().describe("Set as default merge policy"),
    id_stitching:        z.enum(["none", "graph"]).optional().describe("Identity stitching type (default: none)"),
    attribute_merge_type: z.enum(["TimestampOrdered", "DataSetPrecedence"]).optional(),
    schema_class:        z.string().optional().describe("XDM class $id (default: XDM Individual Profile)"),
  }, async ({ name, is_default = false, id_stitching = "none", attribute_merge_type = "TimestampOrdered", schema_class }) => {
    return aep("POST", "/data/core/ups/config/mergePolicies", {
      name,
      default: is_default,
      identityGraph: { type: id_stitching },
      attributeMerge: { type: attribute_merge_type },
      schema: { name: schema_class || "_xdm.context.profile" },
    });
  });

  tool("aep_update_merge_policy", "Update an existing merge policy", {
    merge_policy_id:     z.string().describe("Merge policy ID"),
    name:                z.string().optional(),
    is_default:          z.boolean().optional(),
    attribute_merge_type: z.enum(["TimestampOrdered", "DataSetPrecedence"]).optional(),
  }, async ({ merge_policy_id, name, is_default, attribute_merge_type }) => {
    const existing = await aep("GET", `/data/core/ups/config/mergePolicies/${merge_policy_id}`);
    const body = { ...existing };
    if (name !== undefined)                body.name = name;
    if (is_default !== undefined)          body.default = is_default;
    if (attribute_merge_type !== undefined) body.attributeMerge = { type: attribute_merge_type };
    return aep("PUT", `/data/core/ups/config/mergePolicies/${merge_policy_id}`, body);
  });

  tool("aep_delete_merge_policy", "Delete a merge policy", {
    merge_policy_id: z.string().describe("Merge policy ID"),
  }, async ({ merge_policy_id }) => {
    await aep("DELETE", `/data/core/ups/config/mergePolicies/${merge_policy_id}`);
    return `Merge policy ${merge_policy_id} deleted.`;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DESTINATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_destinations", "List all configured destination connections in AEP", {
    limit: z.number().optional(),
  }, async ({ limit = 20 }) => {
    return aep("GET", "/data/foundation/flowservice/connections", null, {
      limit,
      "property": "auth.specName==Destinations Service",
    });
  });

  tool("aep_list_destination_catalog", "List available destination types from the AEP destination catalog", {
    limit: z.number().optional(),
  }, async ({ limit = 20 }) => {
    return aep("GET", "/data/core/activation/disflowprovider/destinations", null, { limit });
  });

  tool("aep_get_destination", "Get details of a specific destination connection", {
    connection_id: z.string().describe("Destination connection ID"),
  }, async ({ connection_id }) => {
    return aep("GET", `/data/foundation/flowservice/connections/${connection_id}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DATAFLOWS (Sources & Destinations)
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_dataflows", "List all dataflows (source or destination) in AEP", {
    limit: z.number().optional(),
    start: z.number().optional(),
  }, async ({ limit = 20, start = 0 }) => {
    return aep("GET", "/data/foundation/flowservice/flows", null, { limit, start });
  });

  tool("aep_get_dataflow", "Get details of a specific dataflow", {
    flow_id: z.string().describe("Dataflow (flow) ID"),
  }, async ({ flow_id }) => {
    return aep("GET", `/data/foundation/flowservice/flows/${flow_id}`);
  });

  tool("aep_get_dataflow_runs", "List run history for a dataflow", {
    flow_id: z.string().describe("Dataflow ID"),
    limit:   z.number().optional(),
  }, async ({ flow_id, limit = 20 }) => {
    return aep("GET", "/data/foundation/flowservice/runs", null, {
      "property": `flowId==${flow_id}`,
      limit,
    });
  });

  tool("aep_enable_dataflow", "Enable (activate) a paused dataflow", {
    flow_id: z.string().describe("Dataflow ID"),
  }, async ({ flow_id }) => {
    return aep("POST", `/data/foundation/flowservice/flows/${flow_id}/action?op=enable`);
  });

  tool("aep_disable_dataflow", "Disable (pause) an active dataflow", {
    flow_id: z.string().describe("Dataflow ID"),
  }, async ({ flow_id }) => {
    return aep("POST", `/data/foundation/flowservice/flows/${flow_id}/action?op=disable`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SOURCES (Source Connections)
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_source_connections", "List all source connections in AEP", {
    limit: z.number().optional(),
  }, async ({ limit = 20 }) => {
    return aep("GET", "/data/foundation/flowservice/sourceConnections", null, { limit });
  });

  tool("aep_get_source_connection", "Get details of a specific source connection", {
    source_connection_id: z.string().describe("Source connection ID"),
  }, async ({ source_connection_id }) => {
    return aep("GET", `/data/foundation/flowservice/sourceConnections/${source_connection_id}`);
  });

  tool("aep_list_source_catalog", "List available source connector types", {
    limit: z.number().optional(),
  }, async ({ limit = 50 }) => {
    return aep("GET", "/data/foundation/flowservice/connectionSpecs", null, { limit });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY SERVICE
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_queries", "List Query Service queries in AEP", {
    limit:   z.number().optional(),
    orderby: z.string().optional().describe("Sort field, e.g. '-created' for newest first"),
  }, async ({ limit = 20, orderby = "-created" }) => {
    return aep("GET", "/data/foundation/query/queries", null, { limit, orderby });
  });

  tool("aep_get_query", "Get details of a specific Query Service query", {
    query_id: z.string().describe("Query ID"),
  }, async ({ query_id }) => {
    return aep("GET", `/data/foundation/query/queries/${query_id}`);
  });

  tool("aep_create_query", "Submit a SQL query to AEP Query Service", {
    sql:         z.string().describe("SQL query string"),
    name:        z.string().optional().describe("Optional query name"),
    description: z.string().optional(),
    ctas_table:  z.string().optional().describe("If set, creates a new dataset from results (CTAS). Provide target table name."),
  }, async ({ sql, name, description, ctas_table }) => {
    const body = { sql };
    if (name)        body.name = name;
    if (description) body.description = description;
    if (ctas_table)  body.ctasParameters = { datasetName: ctas_table };
    return aep("POST", "/data/foundation/query/queries", body);
  });

  tool("aep_cancel_query", "Cancel a running Query Service query", {
    query_id: z.string().describe("Query ID to cancel"),
  }, async ({ query_id }) => {
    return aep("PATCH", `/data/foundation/query/queries/${query_id}`, { op: "cancel" });
  });

  tool("aep_list_query_templates", "List saved Query Service query templates", {
    limit: z.number().optional(),
  }, async ({ limit = 20 }) => {
    return aep("GET", "/data/foundation/query/query-templates", null, { limit });
  });

  tool("aep_create_query_template", "Save a SQL query as a reusable template", {
    name: z.string().describe("Template name"),
    sql:  z.string().describe("SQL query string"),
    description: z.string().optional(),
  }, async ({ name, sql, description }) => {
    const body = { name, sql };
    if (description) body.description = description;
    return aep("POST", "/data/foundation/query/query-templates", body);
  });

  tool("aep_delete_query_template", "Delete a Query Service query template", {
    template_id: z.string().describe("Query template ID"),
  }, async ({ template_id }) => {
    await aep("DELETE", `/data/foundation/query/query-templates/${template_id}`);
    return `Query template ${template_id} deleted.`;
  });

  tool("aep_list_scheduled_queries", "List scheduled Query Service queries", {
    limit: z.number().optional(),
  }, async ({ limit = 20 }) => {
    return aep("GET", "/data/foundation/query/schedules", null, { limit });
  });

  tool("aep_create_scheduled_query", "Create a scheduled Query Service query", {
    query_id:  z.string().describe("Query ID or template ID to schedule"),
    schedule:  z.string().describe("Cron expression, e.g. '0 * * * *' for hourly"),
    start_date: z.string().optional().describe("ISO 8601 start date, e.g. '2024-01-01T00:00:00Z'"),
  }, async ({ query_id, schedule, start_date }) => {
    const body = {
      query: { id: query_id },
      schedule: { cron: schedule },
    };
    if (start_date) body.schedule.startDate = start_date;
    return aep("POST", "/data/foundation/query/schedules", body);
  });

  tool("aep_delete_scheduled_query", "Delete a scheduled query", {
    schedule_id: z.string().describe("Schedule ID"),
  }, async ({ schedule_id }) => {
    await aep("DELETE", `/data/foundation/query/schedules/${schedule_id}`);
    return `Scheduled query ${schedule_id} deleted.`;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA GOVERNANCE (DULE Labels & Policies)
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_data_usage_labels", "List all DULE (Data Usage Labeling & Enforcement) labels", {}, async () => {
    return aep("GET", "/data/foundation/dulepolicy/labels");
  });

  tool("aep_get_dataset_labels", "Get data usage labels applied to a dataset", {
    dataset_id: z.string().describe("Dataset ID"),
  }, async ({ dataset_id }) => {
    return aep("GET", `/data/foundation/dataset/datasets/${dataset_id}/labels`);
  });

  tool("aep_set_dataset_labels", "Apply data usage labels to a dataset", {
    dataset_id: z.string().describe("Dataset ID"),
    labels:     z.array(z.string()).describe("Array of label names, e.g. ['C1','C2','I1']"),
  }, async ({ dataset_id, labels }) => {
    return aep("PUT", `/data/foundation/dataset/datasets/${dataset_id}/labels`, { labels });
  });

  tool("aep_list_data_usage_policies", "List all data usage policies (DULE policies)", {
    limit: z.number().optional(),
  }, async ({ limit = 20 }) => {
    return aep("GET", "/data/foundation/dulepolicy/policies/custom", null, { limit });
  });

  tool("aep_get_data_usage_policy", "Get a specific data usage policy by ID", {
    policy_id: z.string().describe("Policy ID"),
  }, async ({ policy_id }) => {
    return aep("GET", `/data/foundation/dulepolicy/policies/custom/${policy_id}`);
  });

  tool("aep_create_data_usage_policy", "Create a new data usage policy", {
    name:        z.string().describe("Policy name"),
    description: z.string().optional(),
    deny_labels: z.array(z.string()).describe("Data usage labels that trigger this policy, e.g. ['C1']"),
    deny_actions: z.array(z.string()).describe("Marketing actions to deny, e.g. ['emailTargeting']"),
  }, async ({ name, description, deny_labels, deny_actions }) => {
    const body = {
      name,
      status: "ENABLED",
      marketingActionRefs: deny_actions.map(a => `https://platform.adobe.io/data/foundation/dulepolicy/marketingActions/custom/${a}`),
      description: description || "",
      deny: {
        operands: deny_labels.map(l => ({ label: l })),
        operator: "OR",
      },
    };
    return aep("POST", "/data/foundation/dulepolicy/policies/custom", body);
  });

  tool("aep_delete_data_usage_policy", "Delete a data usage policy", {
    policy_id: z.string().describe("Policy ID"),
  }, async ({ policy_id }) => {
    await aep("DELETE", `/data/foundation/dulepolicy/policies/custom/${policy_id}`);
    return `Data usage policy ${policy_id} deleted.`;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // OBSERVABILITY & MONITORING
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_get_observability_metrics", "Get AEP observability metrics (ingestion, profile, segmentation)", {
    start:   z.string().describe("Start time ISO 8601, e.g. '2024-01-01T00:00:00Z'"),
    end:     z.string().describe("End time ISO 8601"),
    metrics: z.array(z.string()).optional().describe("Metric names, e.g. ['timeseries.ingestion.dataset.recordsuccess.count']"),
  }, async ({ start, end, metrics }) => {
    const body = {
      start,
      end,
      granularity: "HOUR",
      metrics: (metrics || ["timeseries.ingestion.dataset.recordsuccess.count"]).map(m => ({ name: m })),
    };
    return aep("POST", "/data/infrastructure/observability/insights/metrics", body);
  });

  tool("aep_list_alerts", "List AEP observability alerts", {
    limit: z.number().optional(),
  }, async ({ limit = 20 }) => {
    return aep("GET", "/data/foundation/query/alert-subscriptions", null, { limit });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVACY / GDPR (Privacy Service)
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_create_privacy_job", "Submit a GDPR/CCPA privacy access or delete job", {
    regulation:  z.enum(["gdpr", "ccpa", "pdpa", "lgpd"]).describe("Privacy regulation"),
    job_type:    z.enum(["access", "delete"]).describe("Job type: access (export) or delete"),
    user_ids:    z.string().describe("JSON array of user identity objects: [{\"namespace\":\"Email\",\"type\":\"standard\",\"value\":\"user@example.com\"}]"),
    company_contexts: z.string().optional().describe("JSON array of company context objects"),
  }, async ({ regulation, job_type, user_ids, company_contexts }) => {
    const body = {
      regulation,
      users: [{
        key: "user1",
        action: [job_type],
        userIDs: JSON.parse(user_ids),
      }],
    };
    if (company_contexts) body.companyContexts = JSON.parse(company_contexts);
    return aep("POST", "/data/privacy/gdpr/", body, {}, {
      "Content-Type": "application/json",
    });
  });

  tool("aep_get_privacy_job", "Get status of a privacy job", {
    job_id: z.string().describe("Privacy job ID"),
  }, async ({ job_id }) => {
    return aep("GET", `/data/privacy/gdpr/${job_id}`);
  });

  tool("aep_list_privacy_jobs", "List all privacy jobs", {
    regulation: z.enum(["gdpr", "ccpa", "pdpa", "lgpd"]).optional(),
    status:     z.string().optional().describe("Filter by status: complete, processing, submitted, error"),
    limit:      z.number().optional(),
  }, async ({ regulation, status, limit = 25 }) => {
    const params = { size: limit };
    if (regulation) params.regulation = regulation;
    if (status)     params.status = status;
    return aep("GET", "/data/privacy/gdpr/", null, params);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTED ATTRIBUTES
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_computed_attributes", "List all computed attributes for Real-Time Customer Profile", {}, async () => {
    return aep("GET", "/data/core/ups/config/computedAttributes");
  });

  tool("aep_get_computed_attribute", "Get a specific computed attribute by ID", {
    attribute_id: z.string().describe("Computed attribute ID"),
  }, async ({ attribute_id }) => {
    return aep("GET", `/data/core/ups/config/computedAttributes/${attribute_id}`);
  });

  tool("aep_create_computed_attribute", "Create a new computed attribute using PQL", {
    name:        z.string().describe("Attribute name"),
    description: z.string().optional(),
    expression:  z.string().describe("PQL expression defining the computed value"),
    schema:      z.string().optional().describe("XDM schema class name (default: _xdm.context.profile)"),
  }, async ({ name, description, expression, schema }) => {
    const body = {
      name,
      expression: { type: "PQL", format: "pql/text", value: expression },
      schema: { name: schema || "_xdm.context.profile" },
    };
    if (description) body.description = description;
    return aep("POST", "/data/core/ups/config/computedAttributes", body);
  });

  tool("aep_update_computed_attribute", "Update a computed attribute's expression or description", {
    attribute_id: z.string().describe("Computed attribute ID"),
    description:  z.string().optional(),
    expression:   z.string().optional().describe("New PQL expression"),
  }, async ({ attribute_id, description, expression }) => {
    const patch = [];
    if (description !== undefined) patch.push({ op: "replace", path: "/description", value: description });
    if (expression !== undefined)  patch.push({ op: "replace", path: "/expression/value", value: expression });
    return aep("PATCH", `/data/core/ups/config/computedAttributes/${attribute_id}`, patch, {}, {
      "Content-Type": "application/json-patch+json",
    });
  });

  tool("aep_delete_computed_attribute", "Delete a computed attribute", {
    attribute_id: z.string().describe("Computed attribute ID"),
  }, async ({ attribute_id }) => {
    await aep("DELETE", `/data/core/ups/config/computedAttributes/${attribute_id}`);
    return `Computed attribute ${attribute_id} deleted.`;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CATALOG — Connections & Accounts (Flow Service)
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_connections", "List all Flow Service base connections in AEP", {
    limit: z.number().optional(),
  }, async ({ limit = 20 }) => {
    return aep("GET", "/data/foundation/flowservice/connections", null, { limit });
  });

  tool("aep_get_connection", "Get details of a specific Flow Service connection", {
    connection_id: z.string().describe("Connection ID"),
  }, async ({ connection_id }) => {
    return aep("GET", `/data/foundation/flowservice/connections/${connection_id}`);
  });

  tool("aep_delete_connection", "Delete a Flow Service connection", {
    connection_id: z.string().describe("Connection ID"),
  }, async ({ connection_id }) => {
    await aep("DELETE", `/data/foundation/flowservice/connections/${connection_id}`);
    return `Connection ${connection_id} deleted.`;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPOSITE — AEP convenience workflows
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_get_sandbox_overview", "Composite: get a full overview of a sandbox — schemas, datasets, segments, and merge policies", {
    sandbox_name: z.string().optional().describe("Sandbox name (defaults to AEP_SANDBOX_NAME env var)"),
  }, async ({ sandbox_name }) => {
    const targetSandbox = sandbox_name || SANDBOX;
    dbg.info(`  [aep_get_sandbox_overview] sandbox=${targetSandbox}`);

    const [schemas, datasets, segments, mergePolicies] = await Promise.all([
      aep("GET", "/schemaregistry/tenant/schemas", null, { limit: 100 }, {
        Accept: "application/vnd.adobe.xed-id+json",
        "x-sandbox-name": targetSandbox,
      }),
      aep("GET", "/data/foundation/catalog/datasets", null, { limit: 100 }),
      aep("GET", "/data/core/ups/segment/definitions", null, { limit: 100 }),
      aep("GET", "/data/core/ups/config/mergePolicies", null, { limit: 100 }),
    ]);

    return {
      sandbox: targetSandbox,
      summary: {
        schemas:       schemas?.results?.length ?? schemas?.length ?? 0,
        datasets:      Object.keys(datasets || {}).length,
        segments:      segments?.children?.length ?? segments?.length ?? 0,
        merge_policies: mergePolicies?.children?.length ?? mergePolicies?.length ?? 0,
      },
      schemas:        schemas,
      datasets:       datasets,
      segments:       segments,
      merge_policies: mergePolicies,
    };
  });

  tool("aep_profile_360", "Composite: get a full 360 view of a profile — attributes + experience events + segment memberships", {
    entity_id:    z.string().describe("Identity value"),
    entity_id_ns: z.string().describe("Identity namespace code, e.g. 'Email', 'ECID'"),
  }, async ({ entity_id, entity_id_ns }) => {
    dbg.info(`  [aep_profile_360] ns=${entity_id_ns} id=${entity_id}`);

    const [profile, events] = await Promise.all([
      aep("GET", "/data/core/ups/access/entities", null, {
        entityId:   entity_id,
        entityIdNS: entity_id_ns,
        schema_class_id: "_xdm.context.profile",
      }),
      aep("GET", "/data/core/ups/access/entities", null, {
        entityId:   entity_id,
        entityIdNS: entity_id_ns,
        "schema.name": "_xdm.context.experienceevent",
        resultType: "events",
        limit: 50,
      }).catch(() => null),
    ]);

    return {
      identity: { id: entity_id, namespace: entity_id_ns },
      profile,
      recent_events: events,
    };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEMA REGISTRY — MIXINS (legacy alias for field groups)
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_mixins", "List XDM mixins (legacy field groups) in the schema registry", {
    container: z.enum(["global", "tenant"]).optional().describe("Registry container (default: tenant)"),
    limit:     z.number().optional().describe("Max results (default 20)"),
    offset:    z.number().optional().describe("Pagination offset"),
  }, async ({ container = "tenant", limit = 20, offset }) => {
    const params = { limit };
    if (offset) params.offset = offset;
    return aep("GET", `/schemaregistry/${container}/mixins`, null, params, {
      Accept: "application/vnd.adobe.xed-id+json",
    });
  });

  tool("aep_create_mixin", "Create a new XDM mixin (legacy field group) in the tenant container", {
    title:                 z.string().describe("Mixin title"),
    description:           z.string().optional(),
    meta_intendedToExtend: z.string().describe("JSON array of class $ids this mixin extends, e.g. [\"https://ns.adobe.com/xdm/context/profile\"]"),
    properties:            z.string().optional().describe("JSON object of field definitions"),
  }, async ({ title, description, meta_intendedToExtend, properties }) => {
    const body = { title, type: "object", "meta:intendedToExtend": JSON.parse(meta_intendedToExtend) };
    if (description) body.description = description;
    if (properties)  body.properties = JSON.parse(properties);
    return aep("POST", "/schemaregistry/tenant/mixins", body);
  });

  tool("aep_add_field_group", "Add a field group (mixin) reference to an existing schema's allOf array", {
    schema_id:      z.string().describe("Schema $id or short ID to update"),
    field_group_id: z.string().describe("Field group $id to add, e.g. https://ns.adobe.com/xdm/context/profile-person-details"),
    container:      z.enum(["global", "tenant"]).optional().describe("Registry container (default: tenant)"),
  }, async ({ schema_id, field_group_id, container = "tenant" }) => {
    const encoded = encodeURIComponent(schema_id);
    return aep(
      "PATCH",
      `/schemaregistry/${container}/schemas/${encoded}`,
      [{ op: "add", path: "/allOf/-", value: { $ref: field_group_id } }],
      {},
      { "Content-Type": "application/json-patch+json" },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEMA REGISTRY — DATA TYPES & UNIONS
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_data_types", "List XDM data types in the schema registry", {
    container: z.enum(["global", "tenant"]).optional().describe("Registry container (default: tenant)"),
    limit:     z.number().optional().describe("Max results (default 20)"),
    offset:    z.number().optional().describe("Pagination offset"),
  }, async ({ container = "tenant", limit = 20, offset }) => {
    const params = { limit };
    if (offset) params.offset = offset;
    return aep("GET", `/schemaregistry/${container}/datatypes`, null, params, {
      Accept: "application/vnd.adobe.xed-id+json",
    });
  });

  tool("aep_get_union", "Get the union schema for a given XDM class (merged view of all schemas for that class)", {
    class_id:  z.string().describe("XDM class $id, e.g. https://ns.adobe.com/xdm/context/profile or _xdm.context.profile"),
    container: z.enum(["global", "tenant"]).optional().describe("Registry container (default: tenant)"),
  }, async ({ class_id, container = "tenant" }) => {
    const encoded = encodeURIComponent(class_id);
    return aep("GET", `/schemaregistry/${container}/unions/${encoded}`, null, {}, {
      Accept: "application/vnd.adobe.xed+json;version=1",
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CATALOG — UPDATE DATASET
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_update_dataset", "Update a dataset's name, description, or tags via JSON Patch", {
    dataset_id: z.string().describe("Dataset ID"),
    patch:      z.string().describe("JSON Patch array as JSON string, e.g. [{\"op\":\"replace\",\"path\":\"/name\",\"value\":\"New Name\"}]"),
  }, async ({ dataset_id, patch }) => {
    return aep(
      "PATCH",
      `/data/foundation/catalog/datasets/${dataset_id}`,
      JSON.parse(patch),
      {},
      { "Content-Type": "application/json-patch+json" },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY — UPDATE NAMESPACE & IDENTITY GRAPH
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_update_namespace", "Update an existing custom identity namespace", {
    namespace_id: z.string().describe("Namespace numeric ID (from aep_get_identity_namespace)"),
    name:         z.string().optional().describe("New display name"),
    description:  z.string().optional().describe("New description"),
  }, async ({ namespace_id, name, description }) => {
    const body = {};
    if (name)        body.name = name;
    if (description) body.description = description;
    return aep("PUT", `/data/core/idnamespace/identities/${namespace_id}`, body);
  });

  tool("aep_list_identity_graph", "List all identity links in the graph for a given identity", {
    xid:        z.string().optional().describe("Composite XID string (alternative to nsid+id)"),
    nsid:       z.string().optional().describe("Namespace code, e.g. 'Email'"),
    id:         z.string().optional().describe("Identity value"),
    graph_type: z.string().optional().describe("Graph type, e.g. 'Private' (default) or 'None'"),
  }, async ({ xid, nsid, id, graph_type = "Private" }) => {
    const params = { "graph-type": graph_type };
    if (xid)  params.xid = xid;
    if (nsid) params.nsid = nsid;
    if (id)   params.id = id;
    return aep("GET", "/data/core/identity/graph", null, params);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH INGESTION — EXTENDED OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_upload_file", "Upload a file into an open batch (PUT file content into a batch dataset)", {
    batch_id:    z.string().describe("Batch ID (must be in 'loading' state)"),
    dataset_id:  z.string().describe("Dataset ID the batch belongs to"),
    file_path:   z.string().describe("Logical file path within the batch, e.g. 'data/records.json'"),
    file_content: z.string().describe("File content as a string (JSON lines, CSV, etc.)"),
  }, async ({ batch_id, dataset_id, file_path, file_content }) => {
    // File upload uses the bulk-ingest base URL, not platform.adobe.io
    const headers = await aepHeaders({
      "Content-Type": "application/octet-stream",
    });
    const url = `https://platform.adobe.io/data/foundation/import/batches/${batch_id}/datasets/${dataset_id}/files/${encodeURIComponent(file_path)}`;
    const t0  = Date.now();
    try {
      const res = await axios({ method: "PUT", url, headers, data: file_content });
      dbg.http("PUT", `[AEP:upload]${file_path}`, res.status, Date.now() - t0);
      return res.data ?? { status: res.status, message: "File uploaded successfully." };
    } catch (err) {
      const status = err.response?.status || "ERR";
      const body   = err.response?.data;
      dbg.http("PUT", `[AEP:upload]${file_path}`, status, Date.now() - t0);
      const msg = body?.title || body?.detail || body?.message || (body ? JSON.stringify(body) : err.message);
      throw new Error(`AEP API ${status}: ${msg}`);
    }
  });

  tool("aep_abort_batch", "Abort an in-progress batch (marks it as failed)", {
    batch_id: z.string().describe("Batch ID to abort"),
  }, async ({ batch_id }) => {
    return aep("POST", `/data/foundation/import/batches/${batch_id}?action=ABORT`);
  });

  tool("aep_get_batch_status", "Get the current status and metadata of a batch", {
    batch_id: z.string().describe("Batch ID"),
  }, async ({ batch_id }) => {
    return aep("GET", `/data/foundation/import/batches/${batch_id}`);
  });

  tool("aep_replay_batch", "Replay a completed or failed batch (re-ingest its data)", {
    batch_id: z.string().describe("Batch ID to replay"),
  }, async ({ batch_id }) => {
    return aep("POST", `/data/foundation/import/batches/${batch_id}?action=REPLAY`);
  });

  tool("aep_list_failed_batches", "List all failed batches, optionally filtered by dataset", {
    dataset_id: z.string().optional().describe("Filter by dataset ID"),
    limit:      z.number().optional().describe("Max results (default 20)"),
  }, async ({ dataset_id, limit = 20 }) => {
    const params = { status: "failed", limit };
    if (dataset_id) params.dataSet = dataset_id;
    return aep("GET", "/data/foundation/import/batches", null, params);
  });

  tool("aep_get_batch_diagnostics", "Get diagnostic messages (errors/warnings) for a batch", {
    batch_id: z.string().describe("Batch ID"),
  }, async ({ batch_id }) => {
    return aep("GET", `/data/foundation/import/batches/${batch_id}/diagnostics`);
  });

  tool("aep_get_preview_data", "Preview the data rows ingested by a batch for a specific dataset", {
    batch_id:   z.string().describe("Batch ID"),
    dataset_id: z.string().describe("Dataset ID"),
  }, async ({ batch_id, dataset_id }) => {
    return aep("GET", `/data/foundation/import/batches/${batch_id}/datasets/${dataset_id}/preview`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STREAMING INGESTION — INLETS & EVENT SENDING
  // ═══════════════════════════════════════════════════════════════════════════

  // DCS (Data Collection Server) base — different host from platform.adobe.io
  const DCS_BASE = "https://dcs.adobedc.net";

  tool("aep_list_inlets", "List all streaming inlets (HTTP streaming connections) for the org", {
    limit: z.number().optional().describe("Max results (default 20)"),
  }, async ({ limit = 20 }) => {
    return aep("GET", "/data/foundation/flowservice/connections", null, {
      limit,
      "property": "providerId==521eee4f-8cbe-4523-9cf8-afc9ad308847",
    });
  });

  tool("aep_create_inlet", "Create a new streaming inlet (HTTP Data Collection connection)", {
    name:              z.string().describe("Inlet name"),
    provider_id:       z.string().optional().describe("Provider ID (default: AEP HTTP streaming provider 521eee4f-8cbe-4523-9cf8-afc9ad308847)"),
    connection_spec_id: z.string().optional().describe("Connection spec ID (default: bc7b00d6-623a-4dfc-9fdb-f1240aeadaeb for HTTP API)"),
  }, async ({ name, provider_id, connection_spec_id }) => {
    return aep("POST", "/data/foundation/flowservice/connections", {
      name,
      providerId:    provider_id    || "521eee4f-8cbe-4523-9cf8-afc9ad308847",
      connectionSpec: {
        id:      connection_spec_id || "bc7b00d6-623a-4dfc-9fdb-f1240aeadaeb",
        version: "1.0",
      },
    });
  });

  tool("aep_get_inlet", "Get details of a specific streaming inlet by connection ID", {
    inlet_id: z.string().describe("Inlet (connection) ID"),
  }, async ({ inlet_id }) => {
    return aep("GET", `/data/foundation/flowservice/connections/${inlet_id}`);
  });

  tool("aep_send_event", "Send a single XDM event to a streaming inlet via the Data Collection Server", {
    inlet_id:   z.string().describe("Streaming inlet ID (connection ID)"),
    xdm_event:  z.string().describe("XDM event body as JSON string — must include header.schemaRef and body.xdmMeta"),
  }, async ({ inlet_id, xdm_event }) => {
    const headers = await aepHeaders({ "Content-Type": "application/json" });
    const url = `${DCS_BASE}/collection/${inlet_id}`;
    const t0  = Date.now();
    try {
      const res = await axios({ method: "POST", url, headers, data: JSON.parse(xdm_event) });
      dbg.http("POST", `[DCS]/collection/${inlet_id}`, res.status, Date.now() - t0);
      return res.data ?? { status: res.status, message: "Event sent." };
    } catch (err) {
      const status = err.response?.status || "ERR";
      const body   = err.response?.data;
      dbg.http("POST", `[DCS]/collection/${inlet_id}`, status, Date.now() - t0);
      const msg = body?.title || body?.detail || body?.message || (body ? JSON.stringify(body) : err.message);
      throw new Error(`DCS ${status}: ${msg}`);
    }
  });

  tool("aep_send_events_batch", "Send multiple XDM events in one request to a streaming inlet", {
    inlet_id: z.string().describe("Streaming inlet ID (connection ID)"),
    events:   z.string().describe("JSON array of XDM event objects — each must include header.schemaRef and body.xdmMeta"),
  }, async ({ inlet_id, events }) => {
    const headers = await aepHeaders({ "Content-Type": "application/json" });
    const url = `${DCS_BASE}/collection/batch/${inlet_id}`;
    const t0  = Date.now();
    try {
      const res = await axios({ method: "POST", url, headers, data: JSON.parse(events) });
      dbg.http("POST", `[DCS]/collection/batch/${inlet_id}`, res.status, Date.now() - t0);
      return res.data ?? { status: res.status, message: "Batch events sent." };
    } catch (err) {
      const status = err.response?.status || "ERR";
      const body   = err.response?.data;
      dbg.http("POST", `[DCS]/collection/batch/${inlet_id}`, status, Date.now() - t0);
      const msg = body?.title || body?.detail || body?.message || (body ? JSON.stringify(body) : err.message);
      throw new Error(`DCS ${status}: ${msg}`);
    }
  });

  tool("aep_validate_message", "Validate an XDM message against its schema before sending to a streaming inlet", {
    inlet_id:  z.string().describe("Streaming inlet ID (connection ID)"),
    xdm_body:  z.string().describe("XDM message body as JSON string"),
  }, async ({ inlet_id, xdm_body }) => {
    return aep("POST", `/data/foundation/streaming/connections/${inlet_id}/validate`, JSON.parse(xdm_body));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SEGMENTATION — EXTENDED (export jobs, audiences, schedules, preview status)
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_evaluate_segment", "Trigger a batch evaluation job for one or more segment definitions", {
    segment_ids: z.array(z.string()).describe("Array of segment definition IDs to evaluate"),
  }, async ({ segment_ids }) => {
    return aep("POST", "/data/core/ups/segment/jobs", {
      segmentIds: segment_ids,
    });
  });

  tool("aep_export_segment", "Create an export job to materialise segment membership into a dataset", {
    fields:          z.string().optional().describe("Comma-separated XDM fields to export, e.g. 'identities,person.name'"),
    merge_policy_id: z.string().optional().describe("Merge policy ID to use"),
    filter:          z.string().optional().describe("JSON filter object as string"),
    destination:     z.string().describe("JSON destination object as string — must include datasetId and segmentPerBatch"),
    schema_name:     z.string().optional().describe("XDM schema class name (default: _xdm.context.profile)"),
    segment_id:      z.string().optional().describe("Single segment definition ID to export"),
  }, async ({ fields, merge_policy_id, filter, destination, schema_name, segment_id }) => {
    const body = {
      destination: JSON.parse(destination),
      schema: { name: schema_name || "_xdm.context.profile" },
    };
    if (fields)          body.fields = fields;
    if (merge_policy_id) body.mergePolicy = { id: merge_policy_id };
    if (filter)          body.filter = JSON.parse(filter);
    if (segment_id)      body.evaluationInfo = { segmentation: { enabled: true }, segmentId: segment_id };
    return aep("POST", "/data/core/ups/export/jobs", body);
  });

  tool("aep_get_export_job", "Get the status and details of a segment export job", {
    export_job_id: z.string().describe("Export job ID"),
  }, async ({ export_job_id }) => {
    return aep("GET", `/data/core/ups/export/jobs/${export_job_id}`);
  });

  tool("aep_list_audiences", "List all audiences (Audience Portal) in AEP", {
    limit:    z.number().optional().describe("Max results (default 20)"),
    offset:   z.number().optional().describe("Pagination offset"),
    property: z.string().optional().describe("Filter property, e.g. 'audienceType==EXTERNAL'"),
  }, async ({ limit = 20, offset = 0, property }) => {
    const params = { limit, offset };
    if (property) params.property = property;
    return aep("GET", "/data/core/ups/audiences", null, params);
  });

  tool("aep_schedule_job", "Create a segmentation schedule (recurring batch evaluation)", {
    name:        z.string().describe("Schedule name"),
    type:        z.string().optional().describe("Schedule type (default: batch_segmentation)"),
    segment_ids: z.array(z.string()).optional().describe("Segment definition IDs to include (empty = all)"),
    schedule:    z.string().describe("Cron expression, e.g. '0 0 1 * * ?'"),
  }, async ({ name, type = "batch_segmentation", segment_ids, schedule }) => {
    const body = {
      name,
      type,
      properties: { segments: segment_ids ? segment_ids.map(id => ({ name: id })) : [] },
      schedule,
    };
    return aep("POST", "/data/core/ups/config/schedules", body);
  });

  tool("aep_get_preview_status", "Get the status and results of a segment preview job", {
    preview_id: z.string().describe("Preview job ID (from aep_preview_segment response)"),
  }, async ({ preview_id }) => {
    return aep("GET", `/data/core/ups/preview/${preview_id}`);
  });

  tool("aep_get_profile_system_jobs", "List profile system jobs (delete requests, etc.)", {
    limit:    z.number().optional().describe("Max results (default 20)"),
    offset:   z.number().optional().describe("Pagination offset"),
    property: z.string().optional().describe("Filter, e.g. 'status==NEW'"),
  }, async ({ limit = 20, offset = 0, property }) => {
    const params = { limit, offset };
    if (property) params.property = property;
    return aep("GET", "/data/core/ups/system/jobs", null, params);
  });

  tool("aep_create_profile_delete_request", "Create a profile delete request (delete by datasetId or batchId)", {
    dataset_id: z.string().optional().describe("Dataset ID — deletes all profiles ingested from this dataset"),
    batch_id:   z.string().optional().describe("Batch ID — deletes profiles ingested in this specific batch"),
  }, async ({ dataset_id, batch_id }) => {
    const body = {};
    if (dataset_id) body.dataSetId = dataset_id;
    if (batch_id)   body.batchId   = batch_id;
    return aep("POST", "/data/core/ups/system/jobs", body);
  });

  tool("aep_list_profile_datasets", "List datasets configured for Real-Time Customer Profile", {
    limit:  z.number().optional().describe("Max results (default 20)"),
    offset: z.number().optional().describe("Pagination offset"),
  }, async ({ limit = 20, offset = 0 }) => {
    return aep("GET", "/data/core/ups/config/datasets", null, { limit, offset });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FLOW SERVICE — SOURCE/TARGET CONNECTIONS, FLOWS, SPECS
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_create_source_connection", "Create a source connection in Flow Service", {
    name:               z.string().describe("Source connection name"),
    base_connection_id: z.string().describe("Base connection ID (authenticated connection to the source)"),
    data_format:        z.string().describe("Data format, e.g. 'delimited', 'json', 'parquet'"),
    params:             z.string().optional().describe("Source-specific params as JSON string, e.g. {\"path\":\"/folder\"}"),
    connection_spec_id: z.string().describe("Connection spec ID for the source connector type"),
  }, async ({ name, base_connection_id, data_format, params, connection_spec_id }) => {
    const body = {
      name,
      baseConnectionId: base_connection_id,
      data: { format: data_format },
      connectionSpec: { id: connection_spec_id, version: "1.0" },
    };
    if (params) body.params = JSON.parse(params);
    return aep("POST", "/data/foundation/flowservice/sourceConnections", body);
  });

  tool("aep_create_target_connection", "Create a target connection in Flow Service (destination for ingested data)", {
    name:               z.string().describe("Target connection name"),
    data_format:        z.string().describe("Data format, e.g. 'parquet_xdm'"),
    params:             z.string().describe("Target params as JSON string — must include dataSetId and dataSetVersion"),
    connection_spec_id: z.string().describe("Connection spec ID for the target (e.g. c604ff05-7f1a-43c0-8e18-33bf874cb11c for Data Lake)"),
  }, async ({ name, data_format, params, connection_spec_id }) => {
    return aep("POST", "/data/foundation/flowservice/targetConnections", {
      name,
      data: { format: data_format },
      params: JSON.parse(params),
      connectionSpec: { id: connection_spec_id, version: "1.0" },
    });
  });

  tool("aep_create_flow", "Create a dataflow in Flow Service connecting a source to a target", {
    name:                  z.string().describe("Flow name"),
    flow_spec_id:          z.string().describe("Flow spec ID defining the flow type"),
    source_connection_ids: z.array(z.string()).describe("Array of source connection IDs"),
    target_connection_ids: z.array(z.string()).describe("Array of target connection IDs"),
    transformations:       z.string().optional().describe("JSON array of transformation objects"),
    schedule_params:       z.string().optional().describe("JSON schedule object, e.g. {\"startTime\":1234567890,\"frequency\":\"hour\",\"interval\":1}"),
  }, async ({ name, flow_spec_id, source_connection_ids, target_connection_ids, transformations, schedule_params }) => {
    const body = {
      name,
      flowSpec: { id: flow_spec_id, version: "1.0" },
      sourceConnectionIds: source_connection_ids,
      targetConnectionIds: target_connection_ids,
    };
    if (transformations)  body.transformations  = JSON.parse(transformations);
    if (schedule_params)  body.scheduleParams   = JSON.parse(schedule_params);
    return aep("POST", "/data/foundation/flowservice/flows", body);
  });

  tool("aep_list_flows", "List all dataflows in Flow Service", {
    limit:    z.number().optional().describe("Max results (default 20)"),
    offset:   z.number().optional().describe("Pagination offset"),
    property: z.string().optional().describe("Filter expression, e.g. 'state==enabled'"),
  }, async ({ limit = 20, offset = 0, property }) => {
    const params = { limit, offset };
    if (property) params.property = property;
    return aep("GET", "/data/foundation/flowservice/flows", null, params);
  });

  tool("aep_get_flow", "Get details of a specific Flow Service dataflow", {
    flow_id: z.string().describe("Flow ID"),
  }, async ({ flow_id }) => {
    return aep("GET", `/data/foundation/flowservice/flows/${flow_id}`);
  });

  tool("aep_update_flow", "Update a Flow Service dataflow (requires current ETag)", {
    flow_id: z.string().describe("Flow ID"),
    etag:    z.string().describe("Current ETag value from aep_get_flow response header (If-Match)"),
    patch:   z.string().describe("JSON Patch array as string, e.g. [{\"op\":\"replace\",\"path\":\"/name\",\"value\":\"New Name\"}]"),
  }, async ({ flow_id, etag, patch }) => {
    return aep("PATCH", `/data/foundation/flowservice/flows/${flow_id}`, JSON.parse(patch), {}, {
      "If-Match": etag,
      "Content-Type": "application/json-patch+json",
    });
  });

  tool("aep_delete_flow", "Delete a Flow Service dataflow permanently", {
    flow_id: z.string().describe("Flow ID"),
  }, async ({ flow_id }) => {
    await aep("DELETE", `/data/foundation/flowservice/flows/${flow_id}`);
    return `Flow ${flow_id} deleted.`;
  });

  tool("aep_list_flow_runs", "List run history for a specific dataflow", {
    flow_id: z.string().describe("Flow ID"),
    limit:   z.number().optional().describe("Max results (default 20)"),
  }, async ({ flow_id, limit = 20 }) => {
    return aep("GET", "/data/foundation/flowservice/runs", null, {
      "property": `flowId==${flow_id}`,
      limit,
    });
  });

  tool("aep_get_flow_run", "Get details of a specific flow run", {
    run_id: z.string().describe("Flow run ID"),
  }, async ({ run_id }) => {
    return aep("GET", `/data/foundation/flowservice/runs/${run_id}`);
  });

  tool("aep_list_connection_specs", "List all available connection specs (source/destination connector types)", {
    limit:  z.number().optional().describe("Max results (default 50)"),
    offset: z.number().optional().describe("Pagination offset"),
  }, async ({ limit = 50, offset = 0 }) => {
    return aep("GET", "/data/foundation/flowservice/connectionSpecs", null, { limit, offset });
  });

  tool("aep_list_flow_specs", "List all available flow specs (flow type definitions)", {
    limit:  z.number().optional().describe("Max results (default 50)"),
    offset: z.number().optional().describe("Pagination offset"),
  }, async ({ limit = 50, offset = 0 }) => {
    return aep("GET", "/data/foundation/flowservice/flowSpecs", null, { limit, offset });
  });

  tool("aep_create_destination_flow", "Create a destination activation flow in Flow Service", {
    name:                  z.string().describe("Flow name"),
    flow_spec_id:          z.string().describe("Destination flow spec ID"),
    source_connection_ids: z.array(z.string()).describe("Source connection IDs (profile/segment source)"),
    target_connection_ids: z.array(z.string()).describe("Target connection IDs (destination)"),
    transformations:       z.string().optional().describe("JSON array of transformation/mapping objects"),
    schedule_params:       z.string().optional().describe("JSON schedule params, e.g. {\"startTime\":1234567890,\"frequency\":\"hour\",\"interval\":3}"),
  }, async ({ name, flow_spec_id, source_connection_ids, target_connection_ids, transformations, schedule_params }) => {
    const body = {
      name,
      flowSpec: { id: flow_spec_id, version: "1.0" },
      sourceConnectionIds: source_connection_ids,
      targetConnectionIds: target_connection_ids,
    };
    if (transformations) body.transformations = JSON.parse(transformations);
    if (schedule_params) body.scheduleParams  = JSON.parse(schedule_params);
    return aep("POST", "/data/foundation/flowservice/flows", body);
  });

  tool("aep_list_destination_connections", "List all target connections (destination side of flows)", {
    limit:  z.number().optional().describe("Max results (default 20)"),
    offset: z.number().optional().describe("Pagination offset"),
  }, async ({ limit = 20, offset = 0 }) => {
    return aep("GET", "/data/foundation/flowservice/targetConnections", null, { limit, offset });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY SERVICE — EXTENDED (get/update/delete schedules)
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_schedule_query", "Create a scheduled query in Query Service", {
    sql:        z.string().describe("SQL query string to schedule"),
    db_name:    z.string().optional().describe("Database name (default: prod:all)"),
    cron:       z.string().describe("Cron expression, e.g. '0 * * * *' for hourly"),
    start_date: z.string().optional().describe("ISO 8601 start date, e.g. '2024-01-01T00:00:00Z'"),
    name:       z.string().optional().describe("Schedule name"),
  }, async ({ sql, db_name, cron, start_date, name }) => {
    const body = {
      query: { dbName: db_name || "prod:all", sql },
      schedule: { cron },
    };
    if (start_date) body.schedule.startDate = start_date;
    if (name)       body.name = name;
    return aep("POST", "/data/foundation/query/schedules", body);
  });

  tool("aep_get_scheduled_query", "Get details of a specific scheduled query", {
    schedule_id: z.string().describe("Schedule ID"),
  }, async ({ schedule_id }) => {
    return aep("GET", `/data/foundation/query/schedules/${schedule_id}`);
  });

  tool("aep_update_scheduled_query", "Enable or disable a scheduled query", {
    schedule_id: z.string().describe("Schedule ID"),
    enabled:     z.boolean().describe("true to enable, false to disable"),
  }, async ({ schedule_id, enabled }) => {
    return aep("PATCH", `/data/foundation/query/schedules/${schedule_id}`, { enabled });
  });

  tool("aep_delete_scheduled_query_by_id", "Delete a scheduled query by schedule ID", {
    schedule_id: z.string().describe("Schedule ID"),
  }, async ({ schedule_id }) => {
    await aep("DELETE", `/data/foundation/query/schedules/${schedule_id}`);
    return `Scheduled query ${schedule_id} deleted.`;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA GOVERNANCE — EXTENDED (update policy, evaluate, labels, marketing actions)
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_update_policy", "Replace (PUT) a custom data usage policy with a new definition", {
    policy_id:    z.string().describe("Policy ID"),
    name:         z.string().describe("Policy name"),
    status:       z.enum(["ENABLED", "DISABLED"]).optional().describe("Policy status (default: ENABLED)"),
    deny_labels:  z.array(z.string()).describe("Data usage labels that trigger this policy, e.g. ['C1']"),
    deny_actions: z.array(z.string()).describe("Marketing action names to deny, e.g. ['emailTargeting']"),
    description:  z.string().optional(),
  }, async ({ policy_id, name, status = "ENABLED", deny_labels, deny_actions, description }) => {
    return aep("PUT", `/data/foundation/dulepolicy/policies/custom/${policy_id}`, {
      name,
      status,
      description: description || "",
      marketingActionRefs: deny_actions.map(a =>
        `https://platform.adobe.io/data/foundation/dulepolicy/marketingActions/custom/${a}`
      ),
      deny: { operands: deny_labels.map(l => ({ label: l })), operator: "OR" },
    });
  });

  tool("aep_evaluate_policy", "Evaluate data usage policy constraints for a marketing action against datasets/labels", {
    action_name: z.string().describe("Marketing action name, e.g. 'emailTargeting'"),
    resources:   z.string().describe("JSON array of resource objects with entityType and entityId, e.g. [{\"entityType\":\"dataSet\",\"entityId\":\"abc123\"}]"),
  }, async ({ action_name, resources }) => {
    return aep("POST",
      `/data/foundation/dulepolicy/marketingActions/custom/${action_name}/constraints`,
      JSON.parse(resources),
    );
  });

  tool("aep_list_labels", "List all custom data usage labels", {
    limit:  z.number().optional().describe("Max results (default 20)"),
    offset: z.number().optional().describe("Pagination offset"),
  }, async ({ limit = 20, offset = 0 }) => {
    return aep("GET", "/data/foundation/dulepolicy/labels/custom", null, { limit, offset });
  });

  tool("aep_create_label", "Create a new custom data usage label", {
    name:          z.string().describe("Label name (short identifier), e.g. 'L1'"),
    friendly_name: z.string().describe("Human-readable label name"),
    description:   z.string().optional(),
  }, async ({ name, friendly_name, description }) => {
    const body = { name, friendlyName: friendly_name };
    if (description) body.description = description;
    return aep("POST", "/data/foundation/dulepolicy/labels/custom", body);
  });

  tool("aep_list_marketing_actions", "List all custom marketing actions", {
    limit:  z.number().optional().describe("Max results (default 20)"),
    offset: z.number().optional().describe("Pagination offset"),
  }, async ({ limit = 20, offset = 0 }) => {
    return aep("GET", "/data/foundation/dulepolicy/marketingActions/custom", null, { limit, offset });
  });

  tool("aep_create_marketing_action", "Create a new custom marketing action", {
    name:        z.string().describe("Marketing action name (no spaces), e.g. 'emailTargeting'"),
    description: z.string().optional(),
  }, async ({ name, description }) => {
    const body = { name };
    if (description) body.description = description;
    return aep("POST", "/data/foundation/dulepolicy/marketingActions/custom", body);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA HYGIENE / LIFECYCLE — WORK ORDERS & DATASET EXPIRY (TTL)
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_create_work_order", "Create a data hygiene work order (record delete by identity)", {
    dataset_id:   z.string().describe("Dataset ID to delete records from"),
    display_name: z.string().optional().describe("Work order display name"),
    description:  z.string().optional(),
    identities:   z.string().describe("JSON array of identity objects, e.g. [{\"namespace\":{\"code\":\"Email\"},\"id\":\"user@example.com\"}]"),
  }, async ({ dataset_id, display_name, description, identities }) => {
    const body = {
      datasetId:  dataset_id,
      identities: JSON.parse(identities),
    };
    if (display_name) body.displayName = display_name;
    if (description)  body.description = description;
    return aep("POST", "/data/core/hygiene/workorder", body);
  });

  tool("aep_list_work_orders", "List data hygiene work orders", {
    limit:  z.number().optional().describe("Max results (default 20)"),
    offset: z.number().optional().describe("Pagination offset"),
    status: z.string().optional().describe("Filter by status, e.g. 'NEW', 'PROCESSING', 'COMPLETED'"),
  }, async ({ limit = 20, offset = 0, status }) => {
    const params = { limit, offset };
    if (status) params.status = status;
    return aep("GET", "/data/core/hygiene/workorder", null, params);
  });

  tool("aep_get_work_order", "Get details of a specific data hygiene work order", {
    work_order_id: z.string().describe("Work order ID"),
  }, async ({ work_order_id }) => {
    return aep("GET", `/data/core/hygiene/workorder/${work_order_id}`);
  });

  tool("aep_update_work_order", "Update a data hygiene work order (e.g. add identities)", {
    work_order_id: z.string().describe("Work order ID"),
    patch:         z.string().describe("JSON Patch array as string"),
  }, async ({ work_order_id, patch }) => {
    return aep("PATCH", `/data/core/hygiene/workorder/${work_order_id}`, JSON.parse(patch), {}, {
      "Content-Type": "application/json-patch+json",
    });
  });

  tool("aep_cancel_work_order", "Cancel a pending data hygiene work order", {
    work_order_id: z.string().describe("Work order ID"),
  }, async ({ work_order_id }) => {
    await aep("DELETE", `/data/core/hygiene/workorder/${work_order_id}`);
    return `Work order ${work_order_id} cancelled.`;
  });

  tool("aep_schedule_dataset_expiry", "Schedule a dataset TTL (automatic expiry/deletion at a future date)", {
    dataset_id:   z.string().describe("Dataset ID to expire"),
    expiry:       z.string().describe("ISO 8601 expiry date-time, e.g. '2025-12-31T00:00:00Z'"),
    display_name: z.string().optional().describe("Human-readable name for this TTL entry"),
  }, async ({ dataset_id, expiry, display_name }) => {
    const body = { datasetId: dataset_id, expiry };
    if (display_name) body.displayName = display_name;
    return aep("POST", "/data/core/hygiene/ttl", body);
  });

  tool("aep_list_dataset_expiries", "List all scheduled dataset TTL (expiry) entries", {
    limit:  z.number().optional().describe("Max results (default 20)"),
    offset: z.number().optional().describe("Pagination offset"),
    status: z.string().optional().describe("Filter by status, e.g. 'pending', 'cancelled', 'completed'"),
  }, async ({ limit = 20, offset = 0, status }) => {
    const params = { limit, offset };
    if (status) params.status = status;
    return aep("GET", "/data/core/hygiene/ttl", null, params);
  });

  tool("aep_update_dataset_expiry", "Update the expiry date of a scheduled dataset TTL", {
    ttl_id: z.string().describe("TTL entry ID"),
    expiry: z.string().describe("New ISO 8601 expiry date-time"),
  }, async ({ ttl_id, expiry }) => {
    return aep("PATCH", `/data/core/hygiene/ttl/${ttl_id}`, [
      { op: "replace", path: "/expiry", value: expiry },
    ], {}, { "Content-Type": "application/json-patch+json" });
  });

  tool("aep_cancel_dataset_expiry", "Cancel a scheduled dataset TTL (prevent automatic deletion)", {
    ttl_id: z.string().describe("TTL entry ID"),
  }, async ({ ttl_id }) => {
    await aep("DELETE", `/data/core/hygiene/ttl/${ttl_id}`);
    return `Dataset expiry ${ttl_id} cancelled.`;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // OBSERVABILITY — EXTENDED (alert get/subscribe/unsubscribe)
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_get_alert", "Get details of a specific observability alert", {
    alert_id: z.string().describe("Alert ID"),
  }, async ({ alert_id }) => {
    return aep("GET", `/data/infrastructure/observability/insights/alerts/${alert_id}`);
  });

  tool("aep_subscribe_alert", "Subscribe to an alert for a specific AEP asset", {
    asset_id:    z.string().describe("Asset ID to monitor (e.g. a flow ID or dataset ID)"),
    asset_type:  z.string().describe("Asset type, e.g. 'flow', 'dataset', 'segment'"),
    alert_type:  z.string().describe("Alert type, e.g. 'failure', 'success', 'start'"),
    notify_emails: z.array(z.string()).optional().describe("Email addresses to notify"),
  }, async ({ asset_id, asset_type, alert_type, notify_emails }) => {
    const body = { assetId: asset_id, assetType: asset_type, alertType: alert_type };
    if (notify_emails?.length) body.notifyWithEmailAddresses = notify_emails;
    return aep("POST", "/data/foundation/query/alert-subscriptions", body);
  });

  tool("aep_unsubscribe_alert", "Remove an alert subscription", {
    alert_subscription_id: z.string().describe("Alert subscription ID"),
  }, async ({ alert_subscription_id }) => {
    await aep("DELETE", `/data/foundation/query/alert-subscriptions/${alert_subscription_id}`);
    return `Alert subscription ${alert_subscription_id} removed.`;
  });

  tool("aep_list_alert_subscriptions", "List all alert subscriptions for the org", {
    limit:  z.number().optional().describe("Max results (default 20)"),
    offset: z.number().optional().describe("Pagination offset"),
  }, async ({ limit = 20, offset = 0 }) => {
    return aep("GET", "/data/foundation/query/alert-subscriptions", null, { limit, offset });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT QUERY SERVICE
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_list_audit_events", "List audit events from the AEP Audit Query Service", {
    limit:    z.number().optional().describe("Max results (default 25)"),
    start:    z.string().optional().describe("Pagination cursor"),
    query_id: z.string().optional().describe("Resume a previous query by ID"),
    property: z.string().optional().describe("Filter expression, e.g. 'action==CREATE' or 'userId==abc'"),
  }, async ({ limit = 25, start, query_id, property }) => {
    const params = { limit };
    if (start)    params.start    = start;
    if (query_id) params.queryId  = query_id;
    if (property) params.property = property;
    return aep("GET", "/data/foundation/audit/events", null, params);
  });

  tool("aep_export_audit_events", "Export audit events to a file (async export job)", {
    limit:     z.number().optional().describe("Max events to export"),
    action:    z.string().optional().describe("Filter by action type, e.g. 'CREATE', 'UPDATE', 'DELETE'"),
    start_time: z.string().optional().describe("ISO 8601 start timestamp"),
    end_time:   z.string().optional().describe("ISO 8601 end timestamp"),
    user_id:   z.string().optional().describe("Filter by user ID"),
  }, async ({ limit, action, start_time, end_time, user_id }) => {
    const body = { filter: {} };
    if (limit)      body.limit            = limit;
    if (action)     body.filter.action    = action;
    if (start_time) body.filter.start     = start_time;
    if (end_time)   body.filter.end       = end_time;
    if (user_id)    body.filter.userId    = user_id;
    return aep("POST", "/data/foundation/audit/export", body);
  });

  tool("aep_filter_audit_by_user", "List audit events filtered by a specific user ID", {
    user_id: z.string().describe("User ID to filter by"),
    limit:   z.number().optional().describe("Max results (default 25)"),
    start:   z.string().optional().describe("Pagination cursor"),
  }, async ({ user_id, limit = 25, start }) => {
    const params = { limit, property: `userId==${user_id}` };
    if (start) params.start = start;
    return aep("GET", "/data/foundation/audit/events", null, params);
  });

  tool("aep_filter_audit_by_resource", "List audit events filtered by asset type and asset ID", {
    asset_type: z.string().describe("Asset type, e.g. 'dataset', 'schema', 'segment'"),
    asset_id:   z.string().describe("Asset ID"),
    limit:      z.number().optional().describe("Max results (default 25)"),
  }, async ({ asset_type, asset_id, limit = 25 }) => {
    return aep("GET", "/data/foundation/audit/events", null, {
      limit,
      property: `assetType==${asset_type},assetId==${asset_id}`,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVACY SERVICE — EXTENDED (job status, products, regulations)
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_get_privacy_job_status", "Get the detailed status of a specific privacy job", {
    job_id: z.string().describe("Privacy job ID"),
  }, async ({ job_id }) => {
    return aep("GET", `/data/privacy/gdpr/${job_id}/status`);
  });

  tool("aep_list_privacy_products", "List all Adobe products registered with the Privacy Service", {}, async () => {
    return aep("GET", "/data/privacy/gdpr/products");
  });

  tool("aep_list_regulations", "List all privacy regulations supported by the Privacy Service", {}, async () => {
    return aep("GET", "/data/privacy/gdpr/regulations");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA PREP — MAPPING SETS
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_create_mapping", "Create a new Data Prep mapping set", {
    source_schema:      z.string().describe("Source schema as JSON string — {\"id\":\"...\",\"contentType\":\"...\"}"),
    destination_schema: z.string().describe("Destination schema as JSON string"),
    mappings:           z.string().describe("JSON array of mapping objects — [{\"sourceType\":\"ATTRIBUTE\",\"source\":\"$.field\",\"destination\":\"_tenant.field\"}]"),
  }, async ({ source_schema, destination_schema, mappings }) => {
    return aep("POST", "/data/foundation/conversion/mappingSets", {
      sourceSchema:      JSON.parse(source_schema),
      destinationSchema: JSON.parse(destination_schema),
      mappings:          JSON.parse(mappings),
    });
  });

  tool("aep_get_mapping", "Get a specific Data Prep mapping set by ID", {
    mapping_set_id: z.string().describe("Mapping set ID"),
  }, async ({ mapping_set_id }) => {
    return aep("GET", `/data/foundation/conversion/mappingSets/${mapping_set_id}`);
  });

  tool("aep_list_mappings", "List all Data Prep mapping sets", {
    limit:  z.number().optional().describe("Max results (default 20)"),
    offset: z.number().optional().describe("Pagination offset"),
  }, async ({ limit = 20, offset = 0 }) => {
    return aep("GET", "/data/foundation/conversion/mappingSets", null, { limit, offset });
  });

  tool("aep_update_mapping", "Replace a Data Prep mapping set with a new definition (PUT)", {
    mapping_set_id:     z.string().describe("Mapping set ID"),
    source_schema:      z.string().describe("Source schema as JSON string"),
    destination_schema: z.string().describe("Destination schema as JSON string"),
    mappings:           z.string().describe("JSON array of mapping objects"),
  }, async ({ mapping_set_id, source_schema, destination_schema, mappings }) => {
    return aep("PUT", `/data/foundation/conversion/mappingSets/${mapping_set_id}`, {
      sourceSchema:      JSON.parse(source_schema),
      destinationSchema: JSON.parse(destination_schema),
      mappings:          JSON.parse(mappings),
    });
  });

  tool("aep_delete_mapping", "Delete a Data Prep mapping set", {
    mapping_set_id: z.string().describe("Mapping set ID"),
  }, async ({ mapping_set_id }) => {
    await aep("DELETE", `/data/foundation/conversion/mappingSets/${mapping_set_id}`);
    return `Mapping set ${mapping_set_id} deleted.`;
  });

  tool("aep_validate_mapping", "Validate a set of mappings against a source schema without saving", {
    source_schema: z.string().describe("Source schema as JSON string"),
    mappings:      z.string().describe("JSON array of mapping objects to validate"),
  }, async ({ source_schema, mappings }) => {
    return aep("POST", "/data/foundation/conversion/mappingSets/validate", {
      sourceSchema: JSON.parse(source_schema),
      mappings:     JSON.parse(mappings),
    });
  });

  tool("aep_list_mapping_functions", "List all available Data Prep transformation functions", {
    limit:  z.number().optional().describe("Max results (default 50)"),
    offset: z.number().optional().describe("Pagination offset"),
  }, async ({ limit = 50, offset = 0 }) => {
    return aep("GET", "/data/foundation/conversion/functions", null, { limit, offset });
  });

  tool("aep_preview_mapping", "Preview the output of a mapping set against a sample data payload", {
    mapping_set_id: z.string().describe("Mapping set ID"),
    data_sample:    z.string().describe("JSON array of sample source records to transform"),
  }, async ({ mapping_set_id, data_sample }) => {
    return aep("POST", `/data/foundation/conversion/mappingSets/${mapping_set_id}/preview`, {
      data: JSON.parse(data_sample),
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCESS CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_get_permissions", "Get effective access control policies for a list of resource paths", {
    resource_list: z.array(z.string()).describe("Array of resource paths, e.g. [\"/resource-types/schemas\",\"/resource-types/datasets\"]"),
  }, async ({ resource_list }) => {
    return aep("POST", "/data/foundation/access-control/acl/effective-policies", {
      resourceList: resource_list,
    });
  });

  tool("aep_list_admin_products", "List all Adobe products available in the Admin Console for this org", {}, async () => {
    return aep("GET", "/data/foundation/access-control/administration/products");
  });

  tool("aep_list_resource_types", "List all resource types available for access control", {}, async () => {
    return aep("GET", "/data/foundation/access-control/administration/resourceTypes");
  });

  tool("aep_list_permissions", "List all permissions available for access control", {}, async () => {
    return aep("GET", "/data/foundation/access-control/administration/permissions");
  });

  tool("aep_get_product_profiles", "Get all permission profiles for a specific Admin Console product", {
    product_id: z.string().describe("Product ID (from aep_list_admin_products)"),
  }, async ({ product_id }) => {
    return aep("GET", `/data/foundation/access-control/administration/products/${product_id}/profiles`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UNIFIED TAGS & FOLDERS
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_create_tag_category", "Create a new unified tag category", {
    name:        z.string().describe("Tag category name"),
    description: z.string().optional(),
  }, async ({ name, description }) => {
    const body = { name };
    if (description) body.description = description;
    return aep("POST", "/data/foundation/unified-tags/tagCategories", body);
  });

  tool("aep_list_tag_categories", "List all unified tag categories", {
    limit:  z.number().optional().describe("Max results (default 20)"),
    offset: z.number().optional().describe("Pagination offset"),
  }, async ({ limit = 20, offset = 0 }) => {
    return aep("GET", "/data/foundation/unified-tags/tagCategories", null, { limit, offset });
  });

  tool("aep_create_tag", "Create a new unified tag", {
    name:            z.string().describe("Tag name"),
    tag_category_id: z.string().optional().describe("Tag category ID to assign this tag to"),
  }, async ({ name, tag_category_id }) => {
    const body = { name };
    if (tag_category_id) body.tagCategoryId = tag_category_id;
    return aep("POST", "/data/foundation/unified-tags/tags", body);
  });

  tool("aep_list_tags", "List all unified tags", {
    limit:    z.number().optional().describe("Max results (default 20)"),
    offset:   z.number().optional().describe("Pagination offset"),
    sort_by:  z.string().optional().describe("Sort field, e.g. 'name:asc'"),
    property: z.string().optional().describe("Filter, e.g. 'name==myTag'"),
  }, async ({ limit = 20, offset = 0, sort_by, property }) => {
    const params = { limit, offset };
    if (sort_by)  params.sortBy   = sort_by;
    if (property) params.property = property;
    return aep("GET", "/data/foundation/unified-tags/tags", null, params);
  });

  tool("aep_get_tag", "Get details of a specific unified tag", {
    tag_id: z.string().describe("Tag ID"),
  }, async ({ tag_id }) => {
    return aep("GET", `/data/foundation/unified-tags/tags/${tag_id}`);
  });

  tool("aep_update_tag", "Update a unified tag via JSON Patch", {
    tag_id: z.string().describe("Tag ID"),
    patch:  z.string().describe("JSON Patch array as string, e.g. [{\"op\":\"replace\",\"path\":\"/name\",\"value\":\"New Name\"}]"),
  }, async ({ tag_id, patch }) => {
    return aep("PATCH", `/data/foundation/unified-tags/tags/${tag_id}`, JSON.parse(patch), {}, {
      "Content-Type": "application/json-patch+json",
    });
  });

  tool("aep_delete_tag", "Delete a unified tag permanently", {
    tag_id: z.string().describe("Tag ID"),
  }, async ({ tag_id }) => {
    await aep("DELETE", `/data/foundation/unified-tags/tags/${tag_id}`);
    return `Tag ${tag_id} deleted.`;
  });

  tool("aep_create_folder", "Create a folder for organising AEP objects", {
    name:        z.string().describe("Folder name"),
    object_type: z.string().describe("Object type this folder holds, e.g. 'dataset', 'segment', 'journey'"),
    parent_id:   z.string().optional().describe("Parent folder ID (omit for root-level folder)"),
  }, async ({ name, object_type, parent_id }) => {
    const body = { name, objectType: object_type };
    if (parent_id) body.parentId = parent_id;
    return aep("POST", "/data/foundation/unified-tags/folders", body);
  });

  tool("aep_list_folders", "List folders for a given object type", {
    object_type: z.string().describe("Object type, e.g. 'dataset', 'segment'"),
  }, async ({ object_type }) => {
    return aep("GET", `/data/foundation/unified-tags/folders/${object_type}`);
  });

  tool("aep_assign_tags", "Assign unified tags to an AEP entity (dataset, segment, etc.)", {
    entity_id:   z.string().describe("Entity ID to tag"),
    entity_type: z.string().describe("Entity type, e.g. 'dataset', 'segment'"),
    tag_ids:     z.array(z.string()).describe("Array of tag IDs to assign"),
  }, async ({ entity_id, entity_type, tag_ids }) => {
    return aep("POST", "/data/foundation/unified-tags/tagAssignments", {
      entityId:   entity_id,
      entityType: entity_type,
      tagIds:     tag_ids,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DESTINATIONS SDK (Destination Authoring API)
  // ═══════════════════════════════════════════════════════════════════════════

  tool("aep_create_destination_config", "Create a new destination configuration via the Destinations SDK", {
    config: z.string().describe("Full destination configuration object as JSON string"),
  }, async ({ config }) => {
    return aep("POST", "/data/core/activation/authoring/destinations", JSON.parse(config));
  });

  tool("aep_list_destination_configs", "List all destination configurations created via the Destinations SDK", {
    limit:  z.number().optional().describe("Max results (default 20)"),
    offset: z.number().optional().describe("Pagination offset"),
  }, async ({ limit = 20, offset = 0 }) => {
    return aep("GET", "/data/core/activation/authoring/destinations", null, { limit, offset });
  });

  tool("aep_get_destination_config", "Get a specific destination configuration by instance ID", {
    instance_id: z.string().describe("Destination instance ID"),
  }, async ({ instance_id }) => {
    return aep("GET", `/data/core/activation/authoring/destinations/${instance_id}`);
  });

  tool("aep_update_destination_config", "Replace a destination configuration (PUT) via the Destinations SDK", {
    instance_id: z.string().describe("Destination instance ID"),
    config:      z.string().describe("Full updated destination configuration as JSON string"),
  }, async ({ instance_id, config }) => {
    return aep("PUT", `/data/core/activation/authoring/destinations/${instance_id}`, JSON.parse(config));
  });

  tool("aep_delete_destination_config", "Delete a destination configuration via the Destinations SDK", {
    instance_id: z.string().describe("Destination instance ID"),
  }, async ({ instance_id }) => {
    await aep("DELETE", `/data/core/activation/authoring/destinations/${instance_id}`);
    return `Destination config ${instance_id} deleted.`;
  });

  tool("aep_test_destination", "Send test profiles to a destination instance to validate the connection", {
    instance_id: z.string().describe("Destination instance ID"),
    profiles:    z.string().optional().describe("JSON array of sample profile objects to send (omit to use auto-generated profiles)"),
  }, async ({ instance_id, profiles }) => {
    const body = profiles ? { profiles: JSON.parse(profiles) } : {};
    return aep("POST", `/data/core/activation/authoring/testing/destinationInstance/${instance_id}`, body);
  });

  tool("aep_create_audience_template", "Create an audience metadata template for a destination", {
    template: z.string().describe("Audience template configuration as JSON string"),
  }, async ({ template }) => {
    return aep("POST", "/data/core/activation/authoring/audience-templates", JSON.parse(template));
  });

  tool("aep_create_credential_config", "Create a credential configuration for a destination (Destinations SDK)", {
    credential: z.string().describe("Credential configuration as JSON string — includes credentialType and auth fields"),
  }, async ({ credential }) => {
    return aep("POST", "/data/core/activation/authoring/credentials", JSON.parse(credential));
  });

  dbg.info(`✅ AEP tools registered (sandbox: ${SANDBOX})`);
}

