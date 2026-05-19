/**
 * Local Testing Script
 * Automated tests for the Adobe Launch MCP Server
 * Run: node test-local.js
 */

import axios from "axios";
import { spawn } from "child_process";
import { setTimeout } from "timers/promises";

const BASE_URL = "http://localhost:4000";
const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function success(message) {
  log(`✅ ${message}`, "green");
}

function error(message) {
  log(`❌ ${message}`, "red");
}

function info(message) {
  log(`ℹ️  ${message}`, "cyan");
}

function warn(message) {
  log(`⚠️  ${message}`, "yellow");
}

async function testHealthEndpoint() {
  info("Testing health endpoint...");
  try {
    const response = await axios.get(`${BASE_URL}/health`);
    if (response.data.status === "ok") {
      success("Health endpoint is working");
      info(`  Active sessions: ${response.data.activeSessions}`);
      return true;
    } else {
      error("Health endpoint returned unexpected status");
      return false;
    }
  } catch (err) {
    error(`Health endpoint failed: ${err.message}`);
    return false;
  }
}

async function testConfigPage() {
  info("Testing configuration page...");
  try {
    const response = await axios.get(BASE_URL);
    if (response.status === 200 && response.data.includes("Adobe Launch MCP")) {
      success("Configuration page loads correctly");
      return true;
    } else {
      error("Configuration page returned unexpected content");
      return false;
    }
  } catch (err) {
    error(`Configuration page failed: ${err.message}`);
    return false;
  }
}

async function testInvalidCredentials() {
  info("Testing invalid credentials (should fail)...");
  try {
    const response = await axios.post(`${BASE_URL}/api/config`, {
      clientId: "invalid_client_id",
      clientSecret: "invalid_secret",
      orgId: "INVALID@AdobeOrg",
    });
    error("Invalid credentials were accepted (this should not happen!)");
    return false;
  } catch (err) {
    if (err.response && err.response.status === 401) {
      success("Invalid credentials correctly rejected");
      return true;
    } else {
      error(`Unexpected error: ${err.message}`);
      return false;
    }
  }
}

async function testValidCredentials() {
  info("Testing with your Adobe credentials...");
  
  // Check if credentials are in environment
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  const orgId = process.env.ORG_ID;

  if (!clientId || !clientSecret || !orgId) {
    warn("Skipping credential test - no credentials in environment");
    info("  To test: Set CLIENT_ID, CLIENT_SECRET, ORG_ID in .env");
    return null;
  }

  try {
    const response = await axios.post(`${BASE_URL}/api/config`, {
      clientId,
      clientSecret,
      orgId,
    });

    if (response.data.success && response.data.mcpUrl) {
      success("Valid credentials accepted");
      info(`  Session ID: ${response.data.sessionId}`);
      info(`  MCP URL: ${response.data.mcpUrl}`);
      return response.data;
    } else {
      error("Unexpected response from config endpoint");
      return false;
    }
  } catch (err) {
    error(`Credential validation failed: ${err.response?.data?.error || err.message}`);
    return false;
  }
}

async function testMcpEndpoint(sessionData) {
  if (!sessionData || !sessionData.mcpUrl) {
    warn("Skipping MCP endpoint test - no session data");
    return null;
  }

  info("Testing MCP endpoint (tools/list)...");
  try {
    const response = await axios.post(sessionData.mcpUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    if (response.data.result && response.data.result.tools) {
      const toolCount = response.data.result.tools.length;
      success(`MCP endpoint working - ${toolCount} tools available`);
      
      // Check for key tools
      const toolNames = response.data.result.tools.map(t => t.name);
      const keyTools = ["list_companies", "list_properties", "create_rule"];
      const hasKeyTools = keyTools.every(tool => toolNames.includes(tool));
      
      if (hasKeyTools) {
        success("All key tools are present");
      } else {
        warn("Some key tools are missing");
      }
      
      return true;
    } else {
      error("MCP endpoint returned unexpected response");
      return false;
    }
  } catch (err) {
    error(`MCP endpoint failed: ${err.message}`);
    return false;
  }
}

async function testToolCall(sessionData) {
  if (!sessionData || !sessionData.mcpUrl) {
    warn("Skipping tool call test - no session data");
    return null;
  }

  info("Testing tool call (list_companies)...");
  try {
    const response = await axios.post(sessionData.mcpUrl, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "list_companies",
        arguments: {},
      },
    });

    if (response.data.result && response.data.result.content) {
      success("Tool call successful");
      const content = response.data.result.content[0].text;
      const data = JSON.parse(content);
      
      if (data.data && Array.isArray(data.data)) {
        info(`  Found ${data.data.length} companies`);
        if (data.data.length > 0) {
          info(`  First company: ${data.data[0].attributes?.name || "Unknown"}`);
        }
      }
      
      return true;
    } else {
      error("Tool call returned unexpected response");
      return false;
    }
  } catch (err) {
    error(`Tool call failed: ${err.response?.data?.error || err.message}`);
    return false;
  }
}

async function runTests() {
  log("\n" + "=".repeat(60), "blue");
  log("  Adobe Launch MCP Server - Local Testing", "blue");
  log("=".repeat(60) + "\n", "blue");

  info("Waiting for server to be ready...");
  await setTimeout(2000);

  const results = {
    health: await testHealthEndpoint(),
    configPage: await testConfigPage(),
    invalidCreds: await testInvalidCredentials(),
    validCreds: null,
    mcpEndpoint: null,
    toolCall: null,
  };

  // Only test with real credentials if available
  const sessionData = await testValidCredentials();
  results.validCreds = sessionData !== null ? !!sessionData : null;

  if (sessionData) {
    results.mcpEndpoint = await testMcpEndpoint(sessionData);
    results.toolCall = await testToolCall(sessionData);
  }

  // Summary
  log("\n" + "=".repeat(60), "blue");
  log("  Test Summary", "blue");
  log("=".repeat(60) + "\n", "blue");

  const tests = [
    { name: "Health Endpoint", result: results.health },
    { name: "Configuration Page", result: results.configPage },
    { name: "Invalid Credentials Rejection", result: results.invalidCreds },
    { name: "Valid Credentials Acceptance", result: results.validCreds },
    { name: "MCP Endpoint", result: results.mcpEndpoint },
    { name: "Tool Call (list_companies)", result: results.toolCall },
  ];

  tests.forEach(test => {
    if (test.result === true) {
      success(`${test.name}: PASS`);
    } else if (test.result === false) {
      error(`${test.name}: FAIL`);
    } else {
      warn(`${test.name}: SKIPPED`);
    }
  });

  const passed = tests.filter(t => t.result === true).length;
  const failed = tests.filter(t => t.result === false).length;
  const skipped = tests.filter(t => t.result === null).length;

  log("\n" + "=".repeat(60), "blue");
  log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`, "blue");
  log("=".repeat(60) + "\n", "blue");

  if (failed === 0 && passed >= 3) {
    success("🎉 All critical tests passed! Server is ready for deployment.");
  } else if (failed > 0) {
    error("❌ Some tests failed. Please fix issues before deploying.");
  } else {
    warn("⚠️  Some tests were skipped. Consider running with credentials.");
  }

  if (skipped > 0) {
    info("\nTo run all tests, set these in your .env file:");
    info("  CLIENT_ID=your_adobe_client_id");
    info("  CLIENT_SECRET=your_adobe_client_secret");
    info("  ORG_ID=your_org@AdobeOrg");
  }

  process.exit(failed > 0 ? 1 : 0);
}

// Check if server is running
async function checkServer() {
  try {
    await axios.get(`${BASE_URL}/health`, { timeout: 1000 });
    return true;
  } catch (err) {
    return false;
  }
}

// Main
(async () => {
  const isRunning = await checkServer();
  
  if (!isRunning) {
    error("Server is not running!");
    info("Please start the server first:");
    info("  npm start");
    info("\nThen run this test script in another terminal:");
    info("  node test-local.js");
    process.exit(1);
  }

  await runTests();
})();
