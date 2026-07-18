# Tethernet

Connect Claude Code or Claude Desktop to your live Chrome session. Claude reads pages, captures network traffic with full response bodies, intercepts requests, and detects telemetry — all in your real browser with your existing cookies and sessions.

---

## Install

**MCP server:**
```bash
# Claude Code
claude mcp add tethernet --scope user -- npx -y @drbenedictporkins/tethernet-mcp

# Claude Desktop — add to claude_desktop_config.json
{
  "mcpServers": {
    "tethernet": {
      "command": "npx",
      "args": ["-y", "@drbenedictporkins/tethernet-mcp"]
    }
  }
}
```

**Chrome extension:**  
`chrome://extensions` → Developer mode → Load unpacked → select this directory.

> First launch: onboarding page opens — read it, check the box, click Enable. Extension is inactive until you do this.

---

## Connect

1. Start a Claude session
2. Ask: **"What's the Tethernet port?"**
3. Tethernet icon → enter the port → Connect

Green icon = live.

---

## Usage

```
"Take a screenshot."
"What API calls fired when I clicked Submit?"
"Capture network traffic for 10 seconds."
"Show me all telemetry beacons on this page."
"Intercept fetch calls to /api/user and show the payload."
"Mock /api/recommendations to return an empty array and reload."
"Fill the form: name=John, email=john@example.com."
"Run a Lighthouse audit."
"What's in localStorage?"
"Capture console errors on this tab."
```

---

## What makes it different

| Feature | Tethernet | Other browser MCPs |
|---|---|---|
| Full HTTP response bodies | ✓ via CDP | headers only |
| Passive background capture | ✓ ring buffer, always on | manual capture only |
| Request intercept + replay | ✓ fetch/XHR hooks | — |
| Endpoint mocking | ✓ | — |
| Telemetry vendor detection | ✓ GA4, Segment, Amplitude, Conviva, Nielsen, Comscore, Adobe, Datadog, New Relic, Google Ads | — |
| Real session (cookies/auth) | ✓ | ✓ |

---

## Requirements

- Node.js 18+
- Chrome

---

## License

MIT
