# ✅ Pre-Deployment Checklist

Before deploying to Render, make sure you've completed these steps:

## 📝 Code Preparation

- [ ] All files are saved
- [ ] `.env` file is in `.gitignore` (already done ✅)
- [ ] `.env.example` exists with template values (already done ✅)
- [ ] No sensitive credentials in code
- [ ] `render.yaml` is configured (already done ✅)

## 🔧 Configuration Files

- [ ] `package.json` has correct start script (already done ✅)
- [ ] `render.yaml` has correct build and start commands (already done ✅)
- [ ] `.gitignore` includes `node_modules/`, `.env`, etc. (already done ✅)

## 📚 Documentation

- [ ] README.md is updated (already done ✅)
- [ ] DEPLOYMENT.md exists (already done ✅)
- [ ] QUICKSTART.md exists (already done ✅)
- [ ] DEPLOYMENT_SUMMARY.md exists (already done ✅)

## 🧪 Local Testing

- [ ] Run `npm install` successfully
- [ ] Run `npm start` and server starts on port 4000
- [ ] Open `http://localhost:4000` and see configuration page
- [ ] Test with your Adobe credentials
- [ ] Verify MCP URL is generated
- [ ] (Optional) Test connecting to Claude/Cursor/Kiro locally

## 🐙 GitHub Setup

- [ ] Create a new repository on GitHub
- [ ] Initialize git: `git init`
- [ ] Add files: `git add .`
- [ ] Commit: `git commit -m "Initial commit - Adobe Launch MCP Server"`
- [ ] Add remote: `git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git`
- [ ] Push: `git push -u origin main`

## 🚀 Render Deployment

- [ ] Sign up/login to [Render](https://dashboard.render.com/)
- [ ] Click "New +" → "Blueprint"
- [ ] Connect your GitHub repository
- [ ] Review the configuration (from render.yaml)
- [ ] Click "Apply"
- [ ] Wait for deployment (2-3 minutes)
- [ ] Note your deployment URL

## ✅ Post-Deployment Verification

- [ ] Visit your Render URL
- [ ] Configuration page loads correctly
- [ ] Enter test Adobe credentials
- [ ] MCP URL is generated
- [ ] Copy MCP URL
- [ ] Add to Claude/Cursor/Kiro configuration
- [ ] Test a simple command: "List my Adobe Launch properties"

## 📊 Monitoring Setup (Optional)

- [ ] Check `/health` endpoint works
- [ ] Set up Render alerts for errors
- [ ] Monitor logs in Render dashboard
- [ ] Set up uptime monitoring (e.g., UptimeRobot)

## 📢 User Communication

- [ ] Share deployment URL with team
- [ ] Provide link to QUICKSTART.md
- [ ] Explain how to get Adobe credentials
- [ ] Set up support channel (Slack, email, etc.)

---

## 🎯 Quick Commands Reference

### Local Testing
```bash
# Install dependencies
npm install

# Start server
npm start

# Open browser
http://localhost:4000
```

### Git Setup
```bash
# Initialize and push
git init
git add .
git commit -m "Initial commit - Adobe Launch MCP Server"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### Render Deployment
1. Go to https://dashboard.render.com/
2. New + → Blueprint
3. Connect GitHub repo
4. Apply
5. Wait for deployment

---

## 🆘 Troubleshooting

### Server won't start locally
- Check Node.js version: `node --version` (need 18+)
- Run `npm install` again
- Check for port conflicts (port 4000)

### Git push fails
- Check remote URL: `git remote -v`
- Verify GitHub authentication
- Try: `git push -u origin main --force` (only if new repo)

### Render deployment fails
- Check build logs in Render dashboard
- Verify `render.yaml` syntax
- Ensure `package.json` has correct scripts
- Check Node.js version in `package.json` engines

### Configuration page doesn't load
- Check Render logs for errors
- Verify deployment completed successfully
- Try accessing `/health` endpoint
- Wait for cold start (30 seconds on free tier)

---

## ✨ You're Ready!

Once all checkboxes are complete, you're ready to deploy! 🚀

**Next Step**: Follow [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions.
