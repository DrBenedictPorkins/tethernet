# Tethernet Chrome Extension — Project Guide

## System Overview

This is one of three repos that form the Tethernet browser co-pilot system:

| Repo | Path | Role |
|------|------|------|
| `tethernet` (this) | `/Users/makram/dev/chrome-extensions/tethernet` | Chrome Manifest V3 extension |
| `tethernet-mcp` | `/Users/makram/dev/mcp/tethernet-mcp` | MCP server (shared by both extensions) |
| `foxhole-debug-bridge` | `/Users/makram/dev/firefox-extensions/foxhole-debug-bridge` | Firefox Manifest V2 extension |

**Runtime flow:**
```
Claude Code ──stdio──► tethernet-mcp ──WebSocket──► Chrome or Firefox extension
```

The MCP server is extension-agnostic — it sends the same JSON protocol to whichever browser is connected. Both extensions speak the same wire format.

## Key Files

### This repo (Chrome extension)
| File | Purpose |
|------|---------|
| `manifest.json` | Permissions: `tabs`, `scripting`, `debugger`, `webRequest`, `cookies` |
| `service-worker.js` | WebSocket client (via offscreen), command router, network capture, passive mode, intercept/mock/beacon tools |
| `content.js` | DOM interaction: click, type, scroll, hover, element registry (`tref_N`), beacon interceptor |
| `offscreen/offscreen.js` | Persistent WebSocket with exponential backoff reconnect (2s→4s→8s→max 30s) |
| `popup/popup.js` | Connection UI — user enters `localhost:PORT`, shows connection state, passive mode toggle, View Report button |
| `report/report.html` | Passive log viewer — renders ring buffer as sortable network table |
| `test/telemetry-ping.py` | Test harness — fires randomized telemetry pings to 7 vendor endpoints (Conviva, Nielsen, Comscore, New Relic, GA4, Segment, Amplitude) |

### MCP server (`tethernet-mcp/src/`)
| File | Purpose |
|------|---------|
| `mcp/tools.ts` | All 50+ tool definitions (JSON schema only) |
| `mcp/handlers.ts` | Tool implementations — calls `sendToExtension(action, params)` |
| `connection/extension.ts` | WebSocket server, request/response correlation via `requestId` |
| `mcp/types.ts` | Shared TypeScript types: `ExtensionRequest`, `ExtensionResponse` |

### Firefox extension (`foxhole-debug-bridge/extension/`)
| File | Purpose |
|------|---------|
| `background.js` | Direct WebSocket client (no offscreen needed in MV2), command router |
| `content.js` | DOM handlers — mirrors Chrome's `content.js` |
| `manifest.json` | MV2 manifest, `browser.*` APIs |

## Wire Protocol

The MCP server and both extensions communicate via JSON over WebSocket:

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
| `intercept_requests` | service-worker.js → content.js — injects fetch/XHR hooks into page MAIN world |
| `get_intercepted_requests` | service-worker.js → content.js |
| `clear_intercepted_requests` | service-worker.js → content.js |
| `replay_request` | service-worker.js → content.js |
| `mock_endpoint` | service-worker.js → content.js |
| `clear_mocks` | service-worker.js → content.js |

### Adding a new MCP tool

All three repos need changes. Work in this order:

1. **MCP server** — `tethernet-mcp/src/mcp/tools.ts`: add tool schema
2. **MCP server** — `tethernet-mcp/src/mcp/handlers.ts`: add handler, call `sendToExtension('your_action', params)`
3. **Chrome extension** — `service-worker.js`: add case in `handleServerCommand()` switch
4. **Chrome extension** — `content.js`: add handler if DOM access is needed; otherwise handle in service-worker
5. **Firefox extension** — `extension/background.js`: mirror the service-worker changes
6. **Firefox extension** — `extension/content.js`: mirror content.js changes if any

### Modifying an existing tool

1. Check if the change is **MCP-only** (schema, parameters, or server-side logic) — only `tethernet-mcp` changes
2. Check if the change is **extension behavior** — both `service-worker.js` and `extension/background.js` need updating
3. Check if the change is **DOM interaction** — both `content.js` files need updating

### Chrome-only vs. shared changes

If the change is Chrome-specific (MV3 workaround, Chrome DevTools Protocol, Offscreen API), only touch this repo. Everything else should be ported to Firefox.

## Chrome vs. Firefox Differences

| Aspect | Chrome (this repo) | Firefox (`foxhole`) |
|--------|--------------------|---------------------|
| **Manifest** | V3 | V2 |
| **WebSocket** | Via `offscreen/offscreen.js` (SW can't hold sockets) | Direct in `background.js` |
| **API namespace** | `chrome.*` | `browser.*` |
| **Content script prefix** | `__tethernet` (e.g., `document.__tethernetRefs`) | `__tetherweb` |
| **Icon canvas** | `OffscreenCanvas` | Regular `canvas` in background |
| **Badge API** | `chrome.action.setBadgeText()` | `browser.browserAction.setBadgeText()` |
| **Network bodies** | Chrome DevTools Protocol via `chrome.debugger` | `devtools.network` API (requires F12) |

When porting Chrome changes to Firefox:
- Replace `chrome.` → `browser.`
- Replace `OffscreenCanvas` → regular `canvas`
- Replace any `chrome.debugger` usage with `browser.devtools.network`
- MV3 service-worker patterns don't apply — Firefox background is persistent

## Development

### Chrome extension (no build step)
Load unpacked from `chrome://extensions` → Developer mode → Load unpacked → select this directory.

Reload the extension after editing `service-worker.js`. Content script changes reload on next page navigation.

### MCP server
```bash
cd /Users/makram/dev/mcp/tethernet-mcp
npm run dev      # tsx watch
npm run build    # tsc → dist/
npm test         # vitest
```

### Firefox extension
```bash
cd /Users/makram/dev/firefox-extensions/foxhole-debug-bridge
npm run ext:run  # web-ext with auto-reload
```

## Element References

Both extensions use stable element handles (`tref_N`) that survive React re-renders:
- Chrome: `document.__tethernetRefs` (WeakRef Map in content script)
- Firefox: `document.__tetherwebRefs`

Pass `tref_N` as the `selector` parameter to any interaction tool.

## No Build Step (Extensions)

Both extensions are plain JavaScript — no bundler, no transpilation. Edit files directly. The MCP server is TypeScript and requires `npm run build`.

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
