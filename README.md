# Adobe Experience Platform Tags (Launch) MCP Server

[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Deploy to Render](https://img.shields.io/badge/Deploy-Render-purple)](https://render.com)

A production-ready **Model Context Protocol (MCP) server** for Adobe Experience Platform Tags (formerly Adobe Launch). Connect any AI assistant to manage your tag properties, rules, data elements, extensions, and publishing workflows through natural language.

## ✨ Features

- **74 MCP Tools** covering the complete Reactor API
- **Multi-User Support**: Each user configures their own Adobe credentials
- **Web Configuration UI**: No code changes needed - configure via browser
- **Universal AI Compatibility**: Works with Claude, Cursor, Kiro, Windsurf, Continue.dev, and any MCP-compatible client
- **Zero Configuration Deployment**: One-click deploy to Render
- **Production Ready**: Token caching, error handling, comprehensive logging
- **Secure Sessions**: Unique session IDs, auto-expiring credentials

---

## 🚀 Quick Start (Deployed Version)

### For End Users

If someone has already deployed this server, you can use it immediately:

1. **Visit the Configuration Page**
   ```
   https://your-deployed-server.onrender.com
   ```

2. **Get Your Adobe Credentials**
   - Go to [Adobe Developer Console](https://developer.adobe.com/console)
   - Create a new project → Add "Experience Platform Launch API"
   - Generate OAuth Server-to-Server credentials
   - Copy: Client ID, Client Secret, and Org ID

3. **Configure & Connect**
   - Enter your credentials in the web form
   - Copy the generated MCP URL (unique to you)
   - Add it to your AI assistant's configuration

4. **Start Using**
   ```
   Ask your AI: "List my Adobe Launch properties"
   ```

---

## 🏗️ Deploy Your Own Instance

### One-Click Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

Or follow the [Deployment Guide](DEPLOYMENT.md) for detailed instructions.

### Local Development

```bash
# Install dependencies
npm install

# Start the configuration server
npm start

# Open browser
http://localhost:4000
```

---

## 🔌 Connect to AI Clients

### Claude Desktop

**Recommended: HTTP Transport**

Edit your Claude config file:
- **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "adobe-launch": {
      "url": "http://localhost:4000/mcp"
    }
  }
}
```

**Alternative: stdio Transport**
```json
{
  "mcpServers": {
    "adobe-launch": {
      "command": "node",
      "args": ["C:/absolute/path/to/Launch/src/index.js"],
      "env": {
        "CLIENT_ID": "your_client_id",
        "CLIENT_SECRET": "your_client_secret",
        "ORG_ID": "your_org@AdobeOrg"
      }
    }
  }
}
```

### Cursor

Create `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "adobe-launch": {
      "url": "http://localhost:4000/mcp"
    }
  }
}
```

### Kiro (VS Code Extension)

Create `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "adobe-launch": {
      "url": "http://localhost:4000/mcp",
      "disabled": false,
      "autoApprove": [
        "list_companies",
        "list_properties",
        "list_rules",
        "list_extensions",
        "list_data_elements"
      ]
    }
  }
}
```

### Windsurf

Settings → MCP Servers → Add Server:

```json
{
  "name": "adobe-launch",
  "serverUrl": "http://localhost:4000/mcp"
}
```

### Continue.dev

Edit `.continue/config.json`:

```json
{
  "mcpServers": [
    {
      "name": "adobe-launch",
      "transport": {
        "type": "http",
        "url": "http://localhost:4000/mcp"
      }
    }
  ]
}
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│         Any MCP-Compatible AI Client                        │
│   Claude Desktop • Cursor • Kiro • Windsurf • Continue.dev  │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
┌───────▼────────┐ ┌───▼────────┐ ┌──▼──────────┐
│ stdio          │ │ HTTP :4000 │ │ SSE :4001   │
│ src/index.js   │ │ /mcp       │ │ /sse        │
└────────────────┘ └────────────┘ └─────────────┘
        │              │              │
        └──────────────┼──────────────┘
                       │
            ┌──────────▼──────────┐
            │  src/mcp-server.js  │
            │  Factory Function   │
            │  74 MCP Tools       │
            └──────────┬──────────┘
                       │
            ┌──────────▼──────────┐
            │  Adobe Reactor API  │
            │  reactor.adobe.io   │
            └─────────────────────┘
```

**Key Components:**

- **`src/mcp-server.js`**: Shared factory function that creates MCP server instances with all 74 tools
- **`src/index.js`**: stdio transport entry point (for Claude Desktop, Cursor subprocess mode)
- **`src/http-server.js`**: HTTP transport server (recommended for all clients)
- **`src/sse-server.js`**: SSE transport server (legacy support)
- **`server/api.js`**: Web UI backend with Gemini integration
- **`public/`**: Browser-based chat interface

---

## 📚 Complete Tool Reference

### Properties & Companies (7 tools)
- `list_companies` - List all accessible Adobe IMS organizations
- `list_properties` - List tag properties for a company
- `create_property` - Create a new tag property (web/mobile/edge)
- `get_property` - Get property details
- `update_property` - Update property name, domains, or settings
- `delete_property` - Delete a property permanently
- `setup_property_complete` - **Composite**: Create property + host + 3 environments in one call

### Extensions (7 tools)
- `list_extension_packages` - Search available extensions in catalog
- `get_extension_package` - Get extension package details
- `list_extensions` - List installed extensions on a property
- `install_extension` - Install an extension package
- `update_extension` - Update extension settings or upgrade version
- `delete_extension` - Uninstall an extension
- `list_extension_package_usage_authorizations` - List authorized properties for private extensions

### Data Elements (6 tools)
- `list_data_elements` - List all data elements
- `create_data_element` - Create data element (JS variable, DOM attribute, cookie, query param, custom code, page info)
- `get_data_element` - Get data element details
- `update_data_element` - Update data element configuration
- `delete_data_element` - Delete a data element
- `revise_data_element` - Create new revision (required before adding to library)

### Rules (6 tools)
- `list_rules` - List all rules on a property
- `create_rule` - Create a new rule
- `get_rule` - Get rule details
- `update_rule` - Update rule name or enabled state
- `delete_rule` - Delete a rule permanently
- `revise_rule` - Create new revision (required before adding to library)

### Rule Components (4 tools)
- `list_rule_components` - List events, conditions, and actions for a rule
- `create_rule_component` - Add event/condition/action to a rule
- `update_rule_component` - Update component settings or order
- `delete_rule_component` - Delete a component

### Libraries & Publishing (13 tools)
- `list_libraries` - List all libraries
- `create_library` - Create a new library
- `get_library` - Get library details
- `update_library` - Update library name or environment
- `delete_library` - Delete a library
- `add_resources_to_library` - Add rules/data elements/extensions to library
- `remove_resources_from_library` - Remove resources from library
- `list_library_resources` - List all resources in a library
- `build_library` - Trigger a build
- `transition_library` - Submit/approve/reject/develop workflow transitions
- `get_library_build_status` - Get latest build status
- `full_publish_workflow` - **Composite**: Build → Submit → Approve in sequence
- `publish_all_changes` - **Composite**: Create library with ALL resources, build, and publish

### Environments (4 tools)
- `list_environments` - List all environments (dev/staging/production)
- `create_environment` - Create a new environment
- `get_environment` - Get environment details
- `update_environment` - Update environment name or host
- `delete_environment` - Delete an environment

### Hosts (5 tools)
- `list_hosts` - List all hosts (Akamai/SFTP)
- `create_akamai_host` - Create Akamai-managed host
- `create_sftp_host` - Create SFTP host for self-hosting
- `get_host` - Get host details
- `update_host` - Update host configuration
- `delete_host` - Delete a host

### Builds (2 tools)
- `get_build` - Get build details
- `list_property_builds` - List all builds across all libraries

### Secrets (5 tools - for Edge properties)
- `list_secrets` - List secrets for event forwarding
- `create_secret` - Create secret (token/oauth/http auth)
- `get_secret` - Get secret details
- `update_secret` - Update secret value
- `delete_secret` - Delete a secret

### Callbacks (5 tools - webhooks)
- `list_callbacks` - List all webhooks
- `create_callback` - Create webhook for audit events
- `get_callback` - Get callback details
- `update_callback` - Update webhook URL or subscriptions
- `delete_callback` - Delete a webhook

### Notes (2 tools)
- `list_notes` - List annotations on any resource
- `create_note` - Add note to rule/data element/extension/library/property

### Utility (3 tools)
- `search_resources` - Full-text search across all resources
- `list_audit_events` - View change history
- `get_profile` - Get current credential info
- `copy_resource` - Copy rule/data element/extension between properties

### Composite Workflows (3 tools)
- `setup_property_complete` - Create property + host + 3 environments
- `create_rule_with_components` - Create rule + event + condition + action in one call
- `clone_property_rules_to_property` - Copy all rules from one property to another

---

## 💡 Example Use Cases

### Ask your AI assistant:

**Setup:**
- "Create a new web property called 'My Website' for example.com"
- "Set up a complete property with dev, staging, and production environments"
- "Install the Adobe Analytics extension"

**Rules & Data Elements:**
- "Create a page load rule that fires on all pages"
- "Add a data element for the page URL"
- "Create a rule that tracks button clicks with class 'cta-button'"
- "Show me all rules on this property"

**Publishing:**
- "Add all my changes to a new library called 'Release 1.0'"
- "Build and publish the library"
- "Publish all unpublished changes"

**Management:**
- "Copy all rules from property PR123 to property PR456"
- "Search for all rules containing 'analytics'"
- "Show me the audit history for this property"
- "Add a note to this rule explaining what it does"

---

## 🔧 Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `CLIENT_ID` | ✅ Yes | Adobe OAuth client ID from Developer Console | - |
| `CLIENT_SECRET` | ✅ Yes | Adobe OAuth client secret | - |
| `ORG_ID` | ✅ Yes | Adobe organization ID (format: `ABC123@AdobeOrg`) | - |
| `SCOPES` | No | OAuth scopes (auto-configured for Launch API) | Auto |
| `GEMINI_API_KEY` | No | Google Gemini API key (Web UI only) | - |
| `PORT` | No | Web UI server port | `3000` |
| `MCP_HTTP_PORT` | No | HTTP MCP transport port | `4000` |
| `MCP_SSE_PORT` | No | SSE MCP transport port | `4001` |
| `ALLOWED_ORIGINS` | No | CORS allowed origins (comma-separated, blank = all) | `*` |
| `DEBUG` | No | Enable verbose logging (`true` or `false`) | `false` |

---

## 🧪 Testing & Debugging

### MCP Inspector

Test your server interactively:

```bash
npm run inspect
```

This opens the MCP Inspector UI where you can:
- Browse all 74 available tools
- Test tool calls with custom parameters
- View request/response payloads
- Debug authentication issues

### Manual Testing

```bash
# Start HTTP server
npm run http

# In another terminal, test with curl
curl -X POST http://localhost:4000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Debug Logging

Enable detailed logging:

```bash
DEBUG=true npm run http
```

This shows:
- Every Reactor API call with timing
- Token acquisition and caching
- Request/response bodies
- Tool execution flow

---

## 🏭 Production Deployment

### Docker

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 4000
CMD ["npm", "run", "http"]
```

Build and run:

```bash
docker build -t adobe-launch-mcp .
docker run -p 4000:4000 --env-file .env adobe-launch-mcp
```

### PM2 (Process Manager)

```bash
npm install -g pm2

# Start HTTP server
pm2 start npm --name "launch-mcp-http" -- run http

# Start SSE server
pm2 start npm --name "launch-mcp-sse" -- run sse

# View logs
pm2 logs

# Auto-restart on system reboot
pm2 startup
pm2 save
```

### Environment Best Practices

- **Never commit `.env` files** - use environment variables or secrets management
- **Rotate credentials regularly** - Adobe OAuth tokens expire
- **Use separate credentials** for dev/staging/production
- **Monitor API rate limits** - Reactor API has usage quotas
- **Enable DEBUG only in development** - verbose logging impacts performance

---

## 📖 API Reference

### Common delegate_descriptor_ids

**Events:**
- `core::events::dom-ready` - DOM Ready
- `core::events::window-loaded` - Window Loaded
- `core::events::click` - Click
- `core::events::custom-event` - Custom Event
- `core::events::direct-call` - Direct Call
- `core::events::history-change` - History Change
- `core::events::element-exists` - Element Exists
- `core::events::enters-viewport` - Enters Viewport

**Conditions:**
- `core::conditions::path-and-querystring` - Path & Query String
- `core::conditions::domain` - Domain
- `core::conditions::cookie` - Cookie
- `core::conditions::custom-code` - Custom Code
- `core::conditions::variable` - Variable
- `core::conditions::browser` - Browser
- `core::conditions::device-type` - Device Type

**Actions:**
- `core::actions::custom-code` - Custom Code
- `adobe-analytics::actions::set-variables` - Set Variables (Analytics)
- `adobe-analytics::actions::send-beacon` - Send Beacon (Analytics)
- `adobe-analytics::actions::clear-variables` - Clear Variables (Analytics)

**Data Elements:**
- `core::dataElements::javascript-variable` - JavaScript Variable
- `core::dataElements::dom-attribute` - DOM Attribute
- `core::dataElements::cookie` - Cookie
- `core::dataElements::query-string-parameter` - Query String Parameter
- `core::dataElements::custom-code` - Custom Code
- `core::dataElements::page-info` - Page Info

---

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

---

## 🔗 Resources

- [Adobe Reactor API Documentation](https://developer.adobe.com/experience-platform-apis/references/reactor/)
- [Model Context Protocol Specification](https://modelcontextprotocol.io)
- [Adobe Developer Console](https://developer.adobe.com/console)
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)

---

## 💬 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/adobe-launch-mcp/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/adobe-launch-mcp/discussions)
- **Adobe Support**: [Adobe Experience League](https://experienceleaguecommunities.adobe.com/)

---

**Built with ❤️ for the Adobe Experience Platform community**
