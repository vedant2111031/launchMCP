/**
 * Gemini ↔ Adobe Launch MCP Client
 *
 * 1. Spawns src/index.js as a subprocess via StdioClientTransport
 * 2. Loads all MCP tools and converts them to Gemini FunctionDeclarations
 * 3. Runs an agentic loop: Gemini decides which tools to call, executes them,
 *    feeds results back, repeats until a final text answer is produced
 * 4. Provides a readline CLI with "exit", "tools", and "clear" commands
 */

import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline";
import { fileURLToPath } from "url";
import path from "path";

// ─── Config ───────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_PATH = path.resolve(__dirname, "../src/index.js");
const DEBUG = process.env.DEBUG === "true" || process.env.DEBUG === "1";

if (!process.env.GEMINI_API_KEY) {
  console.error("❌ Missing GEMINI_API_KEY in .env");
  process.exit(1);
}

// ─── Debug logger ─────────────────────────────────────────────────────────────

const log = {
  info:   (...a) => console.log("[Client]", ...a),
  debug:  (...a) => { if (DEBUG) console.log("[Client:debug]", ...a); },
  gemini: (...a) => console.log("[Gemini]", ...a),
  mcp:    (...a) => console.log("[MCP]", ...a),
  error:  (...a) => console.error("[Client:ERROR]", ...a),
  sep:    ()     => console.log("─".repeat(62)),
};

// ─── MCP tool schema → Gemini FunctionDeclaration ────────────────────────────

function convertJsonSchemaType(prop) {
  if (!prop) return { type: "STRING" };

  const typeMap = {
    string:  "STRING",
    number:  "NUMBER",
    integer: "INTEGER",
    boolean: "BOOLEAN",
    array:   "ARRAY",
    object:  "OBJECT",
  };

  const result = {
    type:        typeMap[prop.type] || "STRING",
    description: prop.description || "",
  };

  if (prop.enum)  result.enum = prop.enum;

  if (prop.type === "array" && prop.items) {
    result.items = convertJsonSchemaType(prop.items);
  }

  if (prop.type === "object" && prop.properties) {
    result.properties = {};
    for (const [k, v] of Object.entries(prop.properties)) {
      result.properties[k] = convertJsonSchemaType(v);
    }
    if (prop.required?.length) result.required = prop.required;
  }

  return result;
}

function mcpToolToGeminiFunctionDeclaration(tool) {
  const schema     = tool.inputSchema || {};
  const properties = schema.properties || {};
  const required   = schema.required   || [];

  const geminiProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    geminiProperties[key] = convertJsonSchemaType(value);
  }

  return {
    name:        tool.name,
    description: tool.description || "",
    parameters: {
      type:       "OBJECT",
      properties: geminiProperties,
      ...(required.length ? { required } : {}),
    },
  };
}

// ─── Main client class ────────────────────────────────────────────────────────

class AdobeLaunchGeminiClient {
  constructor() {
    this.mcpClient      = null;
    this.model          = null;
    this.tools          = [];
    this.geminiFunctions = [];
    this.chatHistory    = [];
  }

  async initialize() {
    log.info("🚀 Starting Adobe Launch MCP server subprocess...");
    log.debug(`  MCP path: ${MCP_SERVER_PATH}`);

    const transport = new StdioClientTransport({
      command: "node",
      args:    [MCP_SERVER_PATH],
      env: {
        ...process.env,
        CLIENT_ID:     process.env.CLIENT_ID,
        CLIENT_SECRET: process.env.CLIENT_SECRET,
        ORG_ID:        process.env.ORG_ID,
      },
    });

    this.mcpClient = new Client(
      { name: "gemini-adobe-launch-client", version: "1.0.0" },
      { capabilities: {} }
    );

    const t0 = Date.now();
    await this.mcpClient.connect(transport);
    log.mcp(`✅ Connected in ${Date.now() - t0}ms`);

    // Load tools
    log.info("📋 Loading MCP tools...");
    const t1 = Date.now();
    const { tools } = await this.mcpClient.listTools();
    this.tools = tools;
    log.mcp(`✅ ${this.tools.length} tools loaded in ${Date.now() - t1}ms`);
    log.debug("  Tools: " + this.tools.map((t) => t.name).join(", "));

    // Convert to Gemini format
    this.geminiFunctions = this.tools.map(mcpToolToGeminiFunctionDeclaration);
    log.debug(`  Converted ${this.geminiFunctions.length} tools to Gemini FunctionDeclaration format`);

    // Init Gemini
    log.info("🤖 Initializing Gemini model...");
    const t2    = Date.now();
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model  = genAI.getGenerativeModel({
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

COMMON delegate_descriptor_ids:
Events: core::events::dom-ready, core::events::window-loaded, core::events::click, core::events::custom-event, core::events::direct-call, core::events::history-change
Conditions: core::conditions::path-and-querystring, core::conditions::domain, core::conditions::cookie, core::conditions::custom-code, core::conditions::variable
Actions: core::actions::custom-code, adobe-analytics::actions::set-variables, adobe-analytics::actions::send-beacon, adobe-analytics::actions::clear-variables
Data Elements: core::dataElements::javascript-variable, core::dataElements::dom-attribute, core::dataElements::cookie, core::dataElements::query-string-parameter, core::dataElements::custom-code, core::dataElements::page-info`,
      tools: [{ functionDeclarations: this.geminiFunctions }],
      generationConfig: { temperature: 0.1 },
    });
    log.gemini(`✅ Model ready in ${Date.now() - t2}ms`);

    this._printBanner();
  }

  _printBanner() {
    console.log("\n" + "═".repeat(62));
    console.log("  🏷️  Adobe Launch AI Assistant");
    console.log("═".repeat(62));
    console.log("  Commands: exit | tools | clear | <any natural language>");
    console.log("═".repeat(62) + "\n");
  }

  async executeMcpTool(name, args) {
    const t0 = Date.now();
    log.mcp(`  ⚙  Calling: ${name}(${Object.keys(args).join(", ")})`);
    log.debug(`     args: ${JSON.stringify(args).slice(0, 200)}`);
    try {
      const result = await this.mcpClient.callTool({ name, arguments: args });
      const text   = result.content?.[0]?.text || JSON.stringify(result);
      log.mcp(`  ✅ ${name} → ${Date.now() - t0}ms — ${text.slice(0, 80).replace(/\n/g, " ")}...`);
      log.debug(`     full result: ${text.slice(0, 400)}`);
      return text;
    } catch (err) {
      log.error(`  ❌ ${name} failed in ${Date.now() - t0}ms: ${err.message}`);
      return JSON.stringify({ error: err.message });
    }
  }

  async chat(userMessage) {
    this.chatHistory.push({ role: "user", parts: [{ text: userMessage }] });

    log.sep();
    log.info(`User: "${userMessage.slice(0, 80)}"`);
    log.debug(`  history length: ${this.chatHistory.length} turns`);

    const MAX_ITERATIONS = 10;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const round = i + 1;
      log.gemini(`Round ${round}/${MAX_ITERATIONS} — calling Gemini...`);

      // Gemini call with retry on 429
      let response;
      for (let attempt = 0; attempt <= 3; attempt++) {
        const t0 = Date.now();
        try {
          response = await this.model.generateContent({ contents: this.chatHistory });
          log.gemini(`✅ Response in ${Date.now() - t0}ms (attempt ${attempt + 1})`);
          break;
        } catch (err) {
          const ms    = Date.now() - t0;
          const is429 = err.message?.includes("429") || err.message?.includes("Too Many Requests");
          const delayMatch = err.message?.match(/retryDelay['":\s]+(\d+)s/);
          const wait = delayMatch ? parseInt(delayMatch[1]) * 1000 : Math.pow(2, attempt) * 5000;
          if (is429 && attempt < 3) {
            log.gemini(`⏳ 429 Rate limit (${ms}ms). Waiting ${Math.ceil(wait / 1000)}s... (retry ${attempt + 1}/3)`);
            await new Promise((r) => setTimeout(r, wait));
          } else {
            log.error(`Gemini failed (${ms}ms): ${err.message.slice(0, 150)}`);
            throw err;
          }
        }
      }

      const candidate = response.response.candidates?.[0];
      if (!candidate) {
        log.error("No candidate in Gemini response");
        return "No response from Gemini.";
      }

      const parts         = candidate.content?.parts || [];
      const functionCalls = parts.filter((p) => p.functionCall);
      const textParts     = parts.filter((p) => p.text);

      log.gemini(`Round ${round} → ${functionCalls.length} tool call(s), ${textParts.length} text part(s)`);

      // No function calls → final answer
      if (functionCalls.length === 0) {
        const finalText = textParts.map((p) => p.text).join("\n");
        this.chatHistory.push({ role: "model", parts: [{ text: finalText }] });
        log.info(`✅ Final answer after ${round} round(s) — ${finalText.length} chars`);
        log.sep();
        return finalText;
      }

      // Log what Gemini wants to call
      functionCalls.forEach(({ functionCall: { name, args } }) => {
        log.gemini(`  → wants: ${name}(${Object.keys(args || {}).join(", ")})`);
        log.debug(`    args: ${JSON.stringify(args).slice(0, 200)}`);
      });

      // Save model's function call turn
      this.chatHistory.push({ role: "model", parts });

      // Execute all function calls in parallel
      const t0 = Date.now();
      const functionResults = await Promise.all(
        functionCalls.map(async ({ functionCall: { name, args } }) => {
          const result = await this.executeMcpTool(name, args || {});
          return { functionResponse: { name, response: { content: result } } };
        })
      );
      log.mcp(`All ${functionCalls.length} tool(s) done in ${Date.now() - t0}ms`);

      // Feed results back
      this.chatHistory.push({ role: "user", parts: functionResults });
    }

    log.error(`Hit max iterations (${MAX_ITERATIONS})`);
    return "Reached maximum tool iterations. Please try a more specific request.";
  }

  printTools() {
    const categories = {
      "🏠  Properties & Companies": (t) => t.name.includes("propert") || t.name.includes("compan"),
      "🧩  Extensions":             (t) => t.name.includes("extension"),
      "📦  Data Elements":          (t) => t.name.includes("data_element"),
      "📋  Rules":                  (t) => t.name.includes("rule") && !t.name.includes("component"),
      "⚡  Rule Components":        (t) => t.name.includes("rule_component"),
      "🚀  Libraries & Publishing": (t) => ["librar", "build", "publish", "transit"].some((k) => t.name.includes(k)),
      "🌐  Environments & Hosts":   (t) => ["environ", "host"].some((k) => t.name.includes(k)),
      "🔍  Utility":                (t) => ["search", "audit"].some((k) => t.name.includes(k)),
    };

    const assigned = new Set();
    log.info("\n📦 Available Adobe Launch Tools:\n");

    for (const [label, predicate] of Object.entries(categories)) {
      const matched = this.tools.filter((t) => !assigned.has(t.name) && predicate(t));
      if (matched.length) {
        console.log(label);
        matched.forEach((t) => { console.log(`   • ${t.name}`); assigned.add(t.name); });
        console.log();
      }
    }

    const rest = this.tools.filter((t) => !assigned.has(t.name));
    if (rest.length) {
      console.log("📌  Other");
      rest.forEach((t) => console.log(`   • ${t.name}`));
      console.log();
    }
    console.log(`Total: ${this.tools.length} tools\n`);
  }

  async disconnect() {
    log.info("👋 Disconnecting MCP client...");
    if (this.mcpClient) await this.mcpClient.close();
    log.info("✅ Disconnected");
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  log.info("Adobe Launch CLI — starting up");
  log.info(`  DEBUG: ${DEBUG} (set DEBUG=true in .env for verbose output)`);
  log.sep();

  const client = new AdobeLaunchGeminiClient();

  try {
    await client.initialize();
  } catch (err) {
    log.error("Initialization failed:", err.message);
    log.error("Ensure .env contains: GEMINI_API_KEY, CLIENT_ID, CLIENT_SECRET, ORG_ID");
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => {
    rl.question("\nYou: ", async (raw) => {
      const input = raw.trim();

      if (!input) { prompt(); return; }

      switch (input.toLowerCase()) {
        case "exit":
          console.log("\n👋 Goodbye!");
          await client.disconnect();
          rl.close();
          process.exit(0);

        case "tools":
          client.printTools();
          prompt();
          return;

        case "clear":
          client.chatHistory = [];
          log.info("🗑️  Conversation cleared.");
          prompt();
          return;

        case "debug":
          console.log(`DEBUG mode: ${DEBUG}`);
          console.log(`History turns: ${client.chatHistory.length}`);
          console.log(`Tools loaded: ${client.tools.length}`);
          prompt();
          return;
      }

      console.log("\n🤖 Thinking...\n");
      const t0 = Date.now();
      try {
        const answer = await client.chat(input);
        console.log("\n" + "─".repeat(62));
        console.log("Assistant:", answer);
        console.log("─".repeat(62));
        log.debug(`Total turn time: ${Date.now() - t0}ms`);
      } catch (err) {
        log.error("Chat error:", err.message);
      }

      prompt();
    });
  };

  prompt();
}

main();
