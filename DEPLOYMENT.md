# 🚀 Deployment Guide - Adobe Launch MCP Server

This guide will help you deploy the Adobe Launch MCP Server to Render, making it accessible to any user with Adobe IMS credentials.

## 📋 Overview

After deployment, users can:
1. Visit your deployed URL
2. Enter their Adobe credentials (Client ID, Client Secret, Org ID)
3. Get a unique MCP URL to connect to Claude, Cursor, Kiro, or any MCP-compatible AI
4. Start managing their Adobe Launch properties through natural language

## 🎯 Deployment to Render

### Prerequisites

- GitHub account
- Render account (free tier works fine)
- This project pushed to a GitHub repository

### Step 1: Push to GitHub

```bash
# Initialize git if not already done
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - Adobe Launch MCP Server"

# Add your GitHub repository as remote
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git

# Push to GitHub
git push -u origin main
```

### Step 2: Deploy to Render

#### Option A: Using render.yaml (Recommended)

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"Blueprint"**
3. Connect your GitHub repository
4. Render will automatically detect `render.yaml` and configure the service
5. Click **"Apply"**
6. Wait for deployment to complete (2-3 minutes)

#### Option B: Manual Setup

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `adobe-launch-mcp` (or your choice)
   - **Region**: Choose closest to your users
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node src/config-server.js`
   - **Plan**: Free (or paid for better performance)

5. Add Environment Variables:
   - `NODE_ENV` = `production`
   - `DEBUG` = `false`
   - `ALLOWED_ORIGINS` = `*` (or specific domains for security)

6. Click **"Create Web Service"**

### Step 3: Get Your Deployment URL

After deployment completes, Render will provide a URL like:
```
https://adobe-launch-mcp.onrender.com
```

This is your public MCP server URL!

## 👥 User Instructions

Share these instructions with your users:

### For End Users

1. **Visit the Configuration Page**
   ```
   https://YOUR-APP.onrender.com
   ```

2. **Get Adobe Credentials**
   - Go to [Adobe Developer Console](https://developer.adobe.com/console)
   - Create a new project or select existing
   - Add **"Experience Platform Launch API"**
   - Generate **OAuth Server-to-Server** credentials
   - Copy:
     - Client ID
     - Client Secret
     - Organization ID (format: `ABC123@AdobeOrg`)

3. **Configure the Server**
   - Enter your credentials in the web form
   - Click **"Configure & Start Server"**
   - Copy the generated MCP URL (unique to you)

4. **Connect to Your AI Assistant**

   **Claude Desktop:**
   
   Edit `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "adobe-launch": {
         "url": "https://YOUR-APP.onrender.com/mcp/YOUR-SESSION-ID"
       }
     }
   }
   ```

   **Cursor:**
   
   Create `.cursor/mcp.json`:
   ```json
   {
     "mcpServers": {
       "adobe-launch": {
         "url": "https://YOUR-APP.onrender.com/mcp/YOUR-SESSION-ID"
       }
     }
   }
   ```

   **Kiro:**
   
   Create `.kiro/settings/mcp.json`:
   ```json
   {
     "mcpServers": {
       "adobe-launch": {
         "url": "https://YOUR-APP.onrender.com/mcp/YOUR-SESSION-ID",
         "disabled": false,
         "autoApprove": ["list_companies", "list_properties"]
       }
     }
   }
   ```

5. **Start Using**
   
   Ask your AI assistant:
   - "List my Adobe Launch properties"
   - "Create a new web property called 'My Website'"
   - "Show me all rules on property PR123"
   - "Create a page load rule that fires on all pages"

## 🔒 Security Considerations

### Current Implementation

- Each user gets a unique session ID
- Credentials are stored in-memory (not persisted to disk)
- Sessions auto-expire after 24 hours of inactivity
- CORS can be configured via `ALLOWED_ORIGINS` environment variable

### Production Recommendations

1. **Use HTTPS Only** (Render provides this automatically)

2. **Restrict CORS Origins**
   ```
   ALLOWED_ORIGINS=https://claude.ai,https://cursor.sh
   ```

3. **Add Rate Limiting** (optional)
   ```bash
   npm install express-rate-limit
   ```

4. **Add Authentication** (optional)
   - Implement API keys for access control
   - Add OAuth for user authentication
   - Use session encryption

5. **Monitor Usage**
   - Check `/health` endpoint regularly
   - Monitor active sessions via `/api/sessions`
   - Set up Render alerts for errors

## 📊 Monitoring & Maintenance

### Health Check

```bash
curl https://YOUR-APP.onrender.com/health
```

Response:
```json
{
  "status": "ok",
  "activeSessions": 5,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### View Active Sessions

```bash
curl https://YOUR-APP.onrender.com/api/sessions
```

### Logs

View logs in Render Dashboard:
1. Go to your service
2. Click **"Logs"** tab
3. Monitor for errors or issues

## 🔧 Troubleshooting

### Issue: "Session not found"

**Cause**: Session expired or invalid session ID

**Solution**: User needs to reconfigure credentials at the main URL

### Issue: "Adobe authentication failed"

**Cause**: Invalid credentials or missing API access

**Solution**: 
1. Verify credentials in Adobe Developer Console
2. Ensure "Experience Platform Launch API" is added
3. Check Organization ID format: `ABC123@AdobeOrg`

### Issue: "Reactor API calls return 403"

**Cause**: Token scope doesn't include 'reactor'

**Solution**: 
1. Go to Adobe Developer Console
2. Add "Experience Platform Launch API" to the project
3. Regenerate credentials if needed

### Issue: Render service sleeping (Free tier)

**Cause**: Free tier services sleep after 15 minutes of inactivity

**Solution**: 
- Upgrade to paid plan ($7/month)
- Or accept 30-second cold start on first request

## 🚀 Performance Optimization

### For Free Tier

- Service sleeps after 15 minutes
- First request takes ~30 seconds (cold start)
- Subsequent requests are fast

### For Production

1. **Upgrade to Paid Plan** ($7/month)
   - No sleeping
   - Better performance
   - More memory

2. **Enable Caching**
   - Token caching is already implemented
   - Consider Redis for session storage

3. **Use CDN**
   - Serve static files via CDN
   - Reduce server load

## 📈 Scaling

### Horizontal Scaling

Render automatically handles:
- Load balancing
- Auto-scaling (paid plans)
- Zero-downtime deploys

### Session Management

Current implementation uses in-memory storage. For multiple instances:

1. **Use Redis** for shared session storage
2. **Use Database** for persistent sessions
3. **Implement Session Affinity** (sticky sessions)

## 🔄 Updates & Maintenance

### Deploy Updates

```bash
# Make changes
git add .
git commit -m "Update: description"
git push origin main
```

Render will automatically:
1. Detect the push
2. Build the new version
3. Deploy with zero downtime

### Rollback

In Render Dashboard:
1. Go to **"Deploys"** tab
2. Find previous successful deploy
3. Click **"Rollback"**

## 💰 Cost Estimation

### Free Tier
- **Cost**: $0/month
- **Limitations**: 
  - Service sleeps after 15 minutes
  - 750 hours/month
  - Shared resources

### Starter Plan
- **Cost**: $7/month
- **Benefits**:
  - Always on (no sleeping)
  - Better performance
  - More memory (512MB)

### Standard Plan
- **Cost**: $25/month
- **Benefits**:
  - High performance
  - More memory (2GB)
  - Priority support

## 📞 Support

### For Deployment Issues
- [Render Documentation](https://render.com/docs)
- [Render Community](https://community.render.com/)

### For MCP Server Issues
- Check server logs in Render Dashboard
- Review `/health` endpoint
- Test with MCP Inspector locally first

### For Adobe API Issues
- [Adobe Developer Console](https://developer.adobe.com/console)
- [Adobe Experience League](https://experienceleaguecommunities.adobe.com/)
- [Reactor API Documentation](https://developer.adobe.com/experience-platform-apis/references/reactor/)

## 🎉 Success Checklist

- [ ] Code pushed to GitHub
- [ ] Render service created and deployed
- [ ] Deployment URL accessible
- [ ] Configuration page loads
- [ ] Test with your own Adobe credentials
- [ ] MCP URL generated successfully
- [ ] Connected to AI assistant (Claude/Cursor/Kiro)
- [ ] Successfully called a tool (e.g., list_companies)
- [ ] Shared deployment URL with team/users

## 📝 Next Steps

1. **Customize the UI**: Edit `public/config.html` to match your branding
2. **Add Analytics**: Track usage and errors
3. **Implement Auth**: Add user authentication if needed
4. **Set Up Monitoring**: Use Render alerts or external monitoring
5. **Document for Users**: Create user-facing documentation

---

**Congratulations! Your Adobe Launch MCP Server is now live and accessible to any Adobe IMS user! 🎊**
