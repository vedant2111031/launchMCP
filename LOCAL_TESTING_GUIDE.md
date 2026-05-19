# 🧪 Local Testing Guide

Complete guide to test your Adobe Launch MCP Server locally before deployment.

## 📋 Prerequisites

- Node.js 18+ installed
- Your Adobe credentials ready (Client ID, Client Secret, Org ID)
- A web browser
- (Optional) Claude Desktop, Cursor, or Kiro installed for full integration testing

---

## 🚀 Step-by-Step Testing

### Step 1: Install Dependencies

```bash
npm install
```

**Expected Output:**
```
added XXX packages in Xs
```

**✅ Success Criteria:**
- No error messages
- `node_modules/` folder created
- `package-lock.json` updated

---

### Step 2: Start the Configuration Server

```bash
npm start
```

**Expected Output:**
```
======================================================================
  🚀 Adobe Launch MCP — Multi-User Configuration Server
======================================================================
  Configuration UI : http://localhost:4000/
  Health Check     : http://localhost:4000/health
  MCP Endpoint     : http://localhost:4000/mcp/{sessionId}
  Tools Available  : 74
======================================================================
```

**✅ Success Criteria:**
- Server starts without errors
- Shows port 4000 (or your configured PORT)
- No "Missing required env vars" errors

**❌ Common Issues:**
- **Port already in use**: Change PORT in .env or kill the process using port 4000
- **Module not found**: Run `npm install` again

---

### Step 3: Test Health Endpoint

Open a new terminal and run:

```bash
curl http://localhost:4000/health
```

**Expected Output:**
```json
{
  "status": "ok",
  "activeSessions": 0,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**✅ Success Criteria:**
- Returns JSON with `status: "ok"`
- `activeSessions` is 0 (no users yet)

---

### Step 4: Test Configuration UI

1. Open your browser
2. Go to: `http://localhost:4000`

**Expected Result:**
- Beautiful configuration page loads
- Form with 3 fields: Client ID, Client Secret, Organization ID
- "Configure & Start Server" button visible

**✅ Success Criteria:**
- Page loads without errors
- No console errors (press F12 to check)
- Form is interactive

**❌ Common Issues:**
- **Page not loading**: Check if server is still running
- **404 error**: Verify you're using the correct URL

---

### Step 5: Test Credential Validation

In the configuration form:

1. **Enter INVALID credentials** (test error handling):
   - Client ID: `test123`
   - Client Secret: `invalid`
   - Org ID: `TEST@AdobeOrg`
   - Click "Configure & Start Server"

**Expected Result:**
- Red error message: "Adobe authentication failed: ..."
- No MCP URL generated

2. **Enter YOUR REAL Adobe credentials**:
   - Client ID: (your actual client ID)
   - Client Secret: (your actual client secret)
   - Org ID: (your actual org ID, e.g., `ABC123@AdobeOrg`)
   - Click "Configure & Start Server"

**Expected Result:**
- Green success message: "Configuration successful!"
- MCP URL displayed in a box
- URL format: `http://localhost:4000/mcp/[unique-session-id]`
- Copy button appears

**✅ Success Criteria:**
- Invalid credentials are rejected
- Valid credentials are accepted
- Unique MCP URL is generated
- Copy button works

---

### Step 6: Test Session Creation

Check the server terminal output. You should see:

```
[CONFIG] Validating credentials for org: YOUR_ORG_ID@AdobeOrg
[MCP] 🔑 Fetching new Adobe IMS access token...
[MCP] ✅ Token acquired in XXXms
[CONFIG] ✅ Session created: abc123-session-id
[CONFIG] MCP URL: http://localhost:4000/mcp/abc123-session-id
```

**✅ Success Criteria:**
- Token acquired successfully
- Session ID generated
- No error messages

---

### Step 7: Test MCP Endpoint

Copy your MCP URL from the browser, then test it:

```bash
curl -X POST http://localhost:4000/mcp/YOUR-SESSION-ID \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

**Expected Output:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "list_companies",
        "description": "List all Adobe IMS organizations/companies...",
        ...
      },
      ...
    ]
  }
}
```

**✅ Success Criteria:**
- Returns JSON with 74 tools
- No error messages
- Tools include: `list_companies`, `list_properties`, `create_rule`, etc.

---

### Step 8: Test a Real Tool Call

Test calling the `list_companies` tool:

```bash
curl -X POST http://localhost:4000/mcp/YOUR-SESSION-ID \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "list_companies",
      "arguments": {}
    }
  }'
```

**Expected Output:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"data\":[{\"id\":\"CO...\",\"type\":\"companies\",\"attributes\":{\"name\":\"Your Company\"...}}]}"
      }
    ]
  }
}
```

**✅ Success Criteria:**
- Returns your Adobe companies
- No error in response
- Data includes your organization name

**❌ Common Issues:**
- **403 error**: Token doesn't have 'reactor' scope - add "Experience Platform Launch API" in Adobe Console
- **401 error**: Invalid credentials
- **Session not found**: Use the correct session ID from Step 5

---

### Step 9: Test Multiple Users (Optional)

1. Open a new **incognito/private browser window**
2. Go to `http://localhost:4000`
3. Enter DIFFERENT Adobe credentials (if you have another account)
4. Get a new MCP URL

**Expected Result:**
- New session created with different session ID
- Both sessions work independently
- Check health endpoint: `activeSessions` should be 2

```bash
curl http://localhost:4000/health
```

**Expected:**
```json
{
  "status": "ok",
  "activeSessions": 2,
  ...
}
```

---

### Step 10: Test AI Integration (Full End-to-End)

#### Option A: Test with Claude Desktop

1. Open your Claude Desktop config:
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`

2. Add your local MCP server:
```json
{
  "mcpServers": {
    "adobe-launch-local": {
      "url": "http://localhost:4000/mcp/YOUR-SESSION-ID"
    }
  }
}
```

3. Restart Claude Desktop

4. In Claude, ask:
```
"List my Adobe Launch properties"
```

**Expected Result:**
- Claude shows your properties
- No error messages

#### Option B: Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector --transport http --url http://localhost:4000/mcp/YOUR-SESSION-ID
```

**Expected Result:**
- Inspector UI opens in browser
- Shows all 74 tools
- You can test tool calls interactively

---

## 🎯 Complete Test Checklist

Run through this checklist:

- [ ] Dependencies installed (`npm install`)
- [ ] Server starts without errors (`npm start`)
- [ ] Health endpoint returns OK (`/health`)
- [ ] Configuration page loads (`http://localhost:4000`)
- [ ] Invalid credentials are rejected
- [ ] Valid credentials are accepted
- [ ] MCP URL is generated
- [ ] Session appears in server logs
- [ ] MCP endpoint responds to `tools/list`
- [ ] `list_companies` tool returns data
- [ ] (Optional) Multiple users can create sessions
- [ ] (Optional) Claude/Cursor/Kiro integration works

---

## 🐛 Troubleshooting

### Server Won't Start

**Error: "Missing required env vars"**
```bash
# Set skip validation flag
$env:SKIP_ENV_VALIDATION="true"  # Windows PowerShell
# or
export SKIP_ENV_VALIDATION=true  # Mac/Linux

npm start
```

**Error: "Port 4000 already in use"**
```bash
# Windows: Find and kill process
netstat -ano | findstr :4000
taskkill /PID <PID> /F

# Mac/Linux: Find and kill process
lsof -ti:4000 | xargs kill -9
```

### Configuration Page Issues

**Page shows 404**
- Verify server is running
- Check URL: `http://localhost:4000` (not 3000 or 4001)
- Check browser console for errors (F12)

**Form doesn't submit**
- Check browser console for JavaScript errors
- Verify server is running
- Check network tab in DevTools

### Credential Validation Fails

**"Adobe authentication failed"**
- Verify credentials are correct
- Check Organization ID format: `ABC123@AdobeOrg`
- Ensure "Experience Platform Launch API" is added in Adobe Console
- Check server logs for detailed error

### MCP Endpoint Issues

**"Session not found"**
- Use the exact session ID from the configuration page
- Session may have expired (24 hours)
- Create a new session

**"Reactor API 403"**
- Token doesn't have 'reactor' scope
- Add "Experience Platform Launch API" in Adobe Developer Console
- Create new credentials if needed

---

## 📊 Expected Server Logs

When everything works correctly, you should see logs like:

```
======================================================================
  🚀 Adobe Launch MCP — Multi-User Configuration Server
======================================================================
  Configuration UI : http://localhost:4000/
  ...
======================================================================

[CONFIG] Validating credentials for org: ABC123@AdobeOrg
[MCP] 🔑 Fetching new Adobe IMS access token...
[MCP] ✅ Token acquired in 234ms
[MCP]    scope     : AdobeID,openid,reactor,...
[MCP]    client_id : 5a5d0cb926884d7f...
[MCP]    expires   : 24h
[CONFIG] ✅ Session created: abc-123-def-456
[CONFIG] MCP URL: http://localhost:4000/mcp/abc-123-def-456

[MCP] ┌─ [#1] Tool: list_companies
[MCP:HTTP] GET /companies → 200 (456ms)
[MCP] └─ [#1] list_companies ✅ (456ms) → {"data":[{"id":"CO...
```

---

## ✅ Success Criteria Summary

Your server is ready for deployment when:

1. ✅ Server starts without errors
2. ✅ Health endpoint returns OK
3. ✅ Configuration page loads
4. ✅ Credentials are validated correctly
5. ✅ MCP URL is generated
6. ✅ MCP endpoint responds to tool calls
7. ✅ At least one tool (`list_companies`) returns real data
8. ✅ (Optional) AI integration works

---

## 🚀 Next Steps

Once all tests pass:

1. Stop the server (Ctrl+C)
2. Review [PRE_DEPLOYMENT_CHECKLIST.md](./PRE_DEPLOYMENT_CHECKLIST.md)
3. Push to GitHub
4. Deploy to Render
5. Test the deployed version the same way!

---

## 💡 Pro Tips

- **Keep server running**: Leave it running while testing in browser
- **Check logs**: Server logs show detailed information about each request
- **Use incognito**: Test multiple users without clearing cookies
- **Save session ID**: Keep your MCP URL handy for testing
- **Test incrementally**: Don't skip steps - each builds on the previous

---

**Happy testing! 🧪**
