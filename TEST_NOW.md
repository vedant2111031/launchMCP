# 🧪 Test Your Server NOW - Quick Guide

Follow these steps to test everything before deployment.

## 🚀 Quick Test (5 minutes)

### Step 1: Start the Server

Open a terminal and run:

```bash
npm start
```

**✅ You should see:**
```
======================================================================
  🚀 Adobe Launch MCP — Multi-User Configuration Server
======================================================================
  Configuration UI : http://localhost:4000/
  ...
```

**Keep this terminal open!**

---

### Step 2: Open the Configuration Page

Open your browser and go to:
```
http://localhost:4000
```

**✅ You should see:**
- A nice purple/blue gradient page
- Form with 3 input fields
- "Configure & Start Server" button

---

### Step 3: Test with Your Adobe Credentials

1. **Get your credentials** from [Adobe Developer Console](https://developer.adobe.com/console)
   - Client ID
   - Client Secret  
   - Organization ID (format: `ABC123@AdobeOrg`)

2. **Enter them in the form**

3. **Click "Configure & Start Server"**

**✅ You should see:**
- Green success message
- A unique MCP URL displayed
- Copy button appears

**Example MCP URL:**
```
http://localhost:4000/mcp/abc-123-def-456-ghi-789
```

**❌ If you see an error:**
- Check your credentials are correct
- Verify Org ID format: `ABC123@AdobeOrg`
- Ensure "Experience Platform Launch API" is added in Adobe Console

---

### Step 4: Run Automated Tests

Open a **NEW terminal** (keep the server running in the first one) and run:

```bash
npm test
```

**✅ You should see:**
```
======================================================================
  Adobe Launch MCP Server - Local Testing
======================================================================

ℹ️  Testing health endpoint...
✅ Health endpoint is working
  Active sessions: 1

ℹ️  Testing configuration page...
✅ Configuration page loads correctly

ℹ️  Testing invalid credentials (should fail)...
✅ Invalid credentials correctly rejected

ℹ️  Testing with your Adobe credentials...
✅ Valid credentials accepted
  Session ID: abc-123-def-456
  MCP URL: http://localhost:4000/mcp/abc-123-def-456

ℹ️  Testing MCP endpoint (tools/list)...
✅ MCP endpoint working - 74 tools available
✅ All key tools are present

ℹ️  Testing tool call (list_companies)...
✅ Tool call successful
  Found 1 companies
  First company: Your Company Name

======================================================================
  Test Summary
======================================================================

✅ Health Endpoint: PASS
✅ Configuration Page: PASS
✅ Invalid Credentials Rejection: PASS
✅ Valid Credentials Acceptance: PASS
✅ MCP Endpoint: PASS
✅ Tool Call (list_companies): PASS

======================================================================
  Results: 6 passed, 0 failed, 0 skipped
======================================================================

🎉 All critical tests passed! Server is ready for deployment.
```

---

### Step 5: Test with AI (Optional but Recommended)

#### Option A: Test with Claude Desktop

1. **Open Claude config file:**
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`

2. **Add your local server:**
```json
{
  "mcpServers": {
    "adobe-launch-local": {
      "url": "http://localhost:4000/mcp/YOUR-SESSION-ID-FROM-STEP-3"
    }
  }
}
```

3. **Restart Claude Desktop**

4. **Ask Claude:**
```
"List my Adobe Launch properties"
```

**✅ You should see:**
- Claude lists your actual Adobe Launch properties
- No error messages

#### Option B: Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector --transport http --url http://localhost:4000/mcp/YOUR-SESSION-ID
```

**✅ You should see:**
- Inspector UI opens in browser
- Shows all 74 tools
- You can click and test tools interactively

---

## ✅ Success Checklist

- [ ] Server starts without errors
- [ ] Configuration page loads at http://localhost:4000
- [ ] Can enter credentials and get MCP URL
- [ ] Automated tests pass (npm test)
- [ ] (Optional) Claude/Cursor/Kiro can connect and list properties

---

## 🎉 All Tests Passed?

**Congratulations!** Your server is working perfectly. You're ready to deploy!

### Next Steps:

1. **Stop the server** (Ctrl+C in the terminal)

2. **Push to GitHub:**
```bash
git init
git add .
git commit -m "Initial commit - Adobe Launch MCP Server"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

3. **Deploy to Render:**
   - Go to https://dashboard.render.com/
   - Click "New +" → "Blueprint"
   - Connect your GitHub repo
   - Click "Apply"
   - Wait 2-3 minutes

4. **Test the deployed version** the same way!

---

## ❌ Tests Failed?

### Common Issues:

**"Server won't start"**
- Check if port 4000 is already in use
- Run: `netstat -ano | findstr :4000` (Windows)
- Kill the process or change PORT in .env

**"Configuration page shows 404"**
- Verify server is running
- Check you're using http://localhost:4000 (not 3000 or 4001)

**"Adobe authentication failed"**
- Double-check your credentials
- Verify Org ID format: `ABC123@AdobeOrg`
- Ensure "Experience Platform Launch API" is added in Adobe Console

**"Reactor API 403 error"**
- Your token doesn't have 'reactor' scope
- Go to Adobe Developer Console
- Add "Experience Platform Launch API" to your project
- Try again with new credentials

**"npm test fails"**
- Make sure server is running in another terminal
- Check that you entered credentials in the web form first
- Verify .env file has your credentials

---

## 📚 More Help

- **Detailed Testing Guide**: See [LOCAL_TESTING_GUIDE.md](./LOCAL_TESTING_GUIDE.md)
- **Deployment Guide**: See [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Quick Start for Users**: See [QUICKSTART.md](./QUICKSTART.md)

---

## 💡 Pro Tips

1. **Keep server running** while testing in browser
2. **Check server logs** - they show detailed info about each request
3. **Use incognito mode** to test multiple users
4. **Save your MCP URL** - you'll need it for AI integration
5. **Test incrementally** - don't skip steps!

---

**Ready to deploy? Let's go! 🚀**
