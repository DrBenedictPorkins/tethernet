# Tethernet Chrome Extension — Project Guide

## System Overview

This is one of two repos that form the Tethernet browser co-pilot system:

| Repo | Path | Role |
|------|------|------|
| `tethernet` (this) | this repo | Chrome Manifest V3 extension |
| `tethernet-mcp` | [DrBenedictPorkins/tethernet-mcp](https://github.com/DrBenedictPorkins/tethernet-mcp) | MCP server |

**Runtime flow:**
```
Claude Code ──stdio──► tethernet-mcp ──WebSocket──► Chrome extension
```

Firefox support was dropped — AMO review turnaround made it not worth carrying. Do not port
changes to the old Firefox bridge. Some `browserType` plumbing remains in the server's
`connection/manager.ts` because it is part of the handshake, but nothing branches on it now.

## Key Files

### This repo (Chrome extension)
| File | Purpose |
|------|---------|
| `manifest.json` | Permissions: `tabs`, `storage`, `webNavigation`, `webRequest`, `cookies`, `scripting`, `offscreen`, `debugger`, `windows`, `downloads`; `<all_urls>` host access; content scripts run in all frames |
| `service-worker.js` | WebSocket client (via offscreen), command router, network capture, passive mode, intercept/mock/beacon tools |
| `content.js` | DOM interaction: click, type, scroll, hover, element registry (`tref_N`), beacon interceptor |
| `offscreen/offscreen.js` | Persistent WebSocket with exponential backoff reconnect (2s→4s→8s→max 30s) |
| `popup/popup.js` | Connection UI — user enters `localhost:PORT`, shows connection state, passive mode toggle, View Report button |
| `report/report.html` | Passive log viewer — renders ring buffer as sortable network table |
| `test/telemetry-ping.py` | Test harness — fires randomized telemetry pings to 7 vendor endpoints (Conviva, Nielsen, Comscore, New Relic, GA4, Segment, Amplitude) |

### MCP server (`tethernet-mcp/src/`)
| File | Purpose |
|------|---------|
| `mcp/tools.ts` | All 69 tool definitions (JSON schema only) |
| `mcp/handlers.ts` | Tool implementations — calls `sendToExtension(action, params)` |
| `connection/extension.ts` | WebSocket server, request/response correlation via `requestId` |
| `mcp/types.ts` | Shared TypeScript types: `ExtensionRequest`, `ExtensionResponse` |

## Wire Protocol

The MCP server and the extension communicate via JSON over WebSocket:

**Server → Extension:**
```json
{ "action": "click_element", "params": { "tabId": 1, "selector": "#btn" }, "requestId": "uuid" }
```

**Extension → Server:**
```json
{ "requestId": "uuid", "result": { "success": true }, "error": null }
```

Action names are the MCP tool names (e.g., `click_element`, `navigate`, `take_screenshot`).

## Making Changes

### Current tool inventory (beyond core DOM/nav)

| Tool | Where handled |
|------|--------------|
| `get_passive_log` | service-worker.js — reads ring buffer from `chrome.storage.local` |
| `clear_passive_log` | service-worker.js |
| `find_beacons` | service-worker.js — pattern-matches passive log URLs against vendor domain list |
| `intercept_requests` | handlers.ts builds the hook inline and sends it via `execute_script` (MAIN world) — not content.js |
| `get_intercepted_requests` | same — inline script over `execute_script` |
| `clear_intercepted_requests` | same |
| `replay_request` | same |
| `mock_endpoint` | same |
| `clear_mocks` | same |

### Adding a new MCP tool

Both repos need changes. Work in this order:

1. **MCP server** — `tethernet-mcp/src/mcp/tools.ts`: add tool schema
2. **MCP server** — `tethernet-mcp/src/mcp/handlers.ts`: add handler, call `sendToExtension('your_action', params)`
3. **Chrome extension** — `service-worker.js`: add case in `handleServerCommand()` switch
4. **Chrome extension** — `content.js`: add handler if DOM access is needed; otherwise handle in service-worker

### Modifying an existing tool

1. Check if the change is **MCP-only** (schema, parameters, or server-side logic) — only `tethernet-mcp` changes
2. Check if the change is **extension behavior** — `service-worker.js`
3. Check if the change is **DOM interaction** — `content.js`

## Development

### Chrome extension (no build step)
Load unpacked from `chrome://extensions` → Developer mode → Load unpacked → select this directory.

Reload the extension after editing `service-worker.js`. Content script changes reload on next page navigation.

### MCP server
```bash
cd path/to/tethernet-mcp   # see CLAUDE.local.md for the local checkout
npm run dev      # tsx watch
npm run build    # tsc → dist/
npm test         # vitest
```

## Element References

`content.js` keeps stable element handles (`tref_N`) that survive React re-renders, in a
WeakRef Map on `window.__tethernetRefs`. Pass `tref_N` as the `selector` parameter to any
interaction tool.

## No Build Step (Extension)

The extension is plain JavaScript — no bundler, no transpilation. Edit files directly. The MCP server is TypeScript and requires `npm run build`.

## WebSocket Reconnect Behavior

The offscreen document (`offscreen/offscreen.js`) auto-reconnects with exponential backoff on disconnect:
- Initial delay: 2s, doubles each attempt, caps at 30s
- `pendingUrl` is cleared on explicit disconnect to stop the loop
- Service worker persists `tethernetServerUrl` to `chrome.storage.local` and restores the connection on startup

## Passive Mode

Passive mode is a webRequest ring buffer (max 500 entries) that captures all network activity silently. Enabled/disabled via the popup toggle. State persists in `chrome.storage.local` as `tethernetPassiveMode`. The popup shows a count and a **View Report** button that opens `report/report.html` once entries exist.

## Test Harness

`test/telemetry-ping.py` — standalone Python test script for validating Tethernet's telemetry detection. Fires randomized pings to 7 analytics vendors. Run with:

```bash
uv run test/telemetry-ping.py --endpoint all
uv run test/telemetry-ping.py --endpoint conviva --playhead 342
```
