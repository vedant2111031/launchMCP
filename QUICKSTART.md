# 🚀 Quick Start Guide

## For End Users (Using a Deployed Instance)

### Step 1: Visit the Configuration Page
Open your browser and go to the deployed URL (provided by your administrator):
```
https://your-server.onrender.com
```

### Step 2: Get Adobe Credentials

1. Go to [Adobe Developer Console](https://developer.adobe.com/console)
2. Sign in with your Adobe ID
3. Create a new project or select an existing one
4. Click **"Add API"** → Select **"Experience Platform Launch API"**
5. Choose **"OAuth Server-to-Server"** authentication
6. Click **"Save configured API"**
7. Copy the following from the "Credentials" tab:
   - **Client ID**
   - **Client Secret**
   - **Organization ID** (format: `ABC123@AdobeOrg`)

### Step 3: Configure the Server

1. Enter your credentials in the web form
2. Click **"Configure & Start Server"**
3. Wait for validation (takes 2-3 seconds)
4. Copy the generated MCP URL (it's unique to you!)

### Step 4: Connect to Your AI Assistant

#### For Claude Desktop

1. Open Claude Desktop configuration file:
   - **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add your MCP server:
```json
{
  "mcpServers": {
    "adobe-launch": {
      "url": "PASTE_YOUR_MCP_URL_HERE"
    }
  }
}
```

3. Restart Claude Desktop

#### For Cursor

1. Create `.cursor/mcp.json` in your project:
```json
{
  "mcpServers": {
    "adobe-launch": {
      "url": "PASTE_YOUR_MCP_URL_HERE"
    }
  }
}
```

2. Restart Cursor

#### For Kiro (VS Code Extension)

1. Create `.kiro/settings/mcp.json` in your workspace:
```json
{
  "mcpServers": {
    "adobe-launch": {
      "url": "PASTE_YOUR_MCP_URL_HERE",
      "disabled": false,
      "autoApprove": [
        "list_companies",
        "list_properties",
        "list_rules"
      ]
    }
  }
}
```

2. Reload VS Code window

### Step 5: Test It!

Ask your AI assistant:
```
"List my Adobe Launch properties"
```

If it works, you'll see your properties! 🎉

---

## For Administrators (Deploying the Server)

### Option 1: Deploy to Render (Recommended)

1. **Push to GitHub**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

2. **Deploy on Render**
   - Go to [Render Dashboard](https://dashboard.render.com/)
   - Click **"New +"** → **"Blueprint"**
   - Connect your GitHub repository
   - Render will detect `render.yaml` automatically
   - Click **"Apply"**
   - Wait 2-3 minutes for deployment

3. **Get Your URL**
   - After deployment, Render provides a URL like:
   ```
   https://adobe-launch-mcp.onrender.com
   ```
   - Share this URL with your users!

### Option 2: Run Locally

1. **Install Dependencies**
```bash
npm install
```

2. **Start the Server**
```bash
npm start
```

3. **Open Browser**
```
http://localhost:4000
```

---

## Troubleshooting

### "Adobe authentication failed"
- **Cause**: Invalid credentials or missing API access
- **Solution**: 
  1. Verify credentials in Adobe Developer Console
  2. Ensure "Experience Platform Launch API" is added to your project
  3. Check Organization ID format: `ABC123@AdobeOrg`

### "Session not found"
- **Cause**: Session expired (24 hours of inactivity)
- **Solution**: Reconfigure your credentials at the main URL

### "Reactor API calls return 403"
- **Cause**: Token doesn't have 'reactor' scope
- **Solution**: Add "Experience Platform Launch API" in Adobe Developer Console

### Render service is slow (Free tier)
- **Cause**: Free tier services sleep after 15 minutes
- **Solution**: 
  - First request takes ~30 seconds (cold start)
  - Upgrade to paid plan ($7/month) for always-on service

---

## What Can You Do?

Once connected, ask your AI assistant to:

### Property Management
- "List all my Adobe Launch properties"
- "Create a new web property called 'My Website' for example.com"
- "Show me details of property PR123"

### Rules & Data Elements
- "Create a page load rule that fires on all pages"
- "Add a data element for the page URL"
- "List all rules on property PR123"
- "Create a click tracking rule for buttons with class 'cta'"

### Extensions
- "Install the Adobe Analytics extension"
- "List all installed extensions"
- "Show me available extension packages"

### Publishing
- "Create a library called 'Release 1.0'"
- "Add all my changes to the library"
- "Build and publish the library"
- "Show me the build status"

### Advanced
- "Copy all rules from property PR123 to PR456"
- "Search for rules containing 'analytics'"
- "Show me the audit history"
- "Set up a complete property with dev, staging, and production environments"

---

## Security Notes

- Your credentials are stored in-memory only (not persisted to disk)
- Each user gets a unique session ID
- Sessions auto-expire after 24 hours of inactivity
- All communication uses HTTPS (when deployed)
- Never share your MCP URL with others (it contains your session ID)

---

## Need Help?

- **Deployment Issues**: See [DEPLOYMENT.md](DEPLOYMENT.md)
- **Adobe API Issues**: [Adobe Developer Console](https://developer.adobe.com/console)
- **MCP Configuration**: [Model Context Protocol Docs](https://modelcontextprotocol.io)

---

**Happy automating! 🚀**
