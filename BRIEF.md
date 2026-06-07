# Tethernet — Chrome Extension Port Brief

## What this is

Port of the **Tetherweb** Firefox extension to Chrome (Manifest V3). Tetherweb is a browser co-pilot that connects Chrome to Claude Code or Claude Desktop via the Model Context Protocol. Claude sees your screen, reads page state, and guides you step by step through complex web workflows in your real logged-in browser session.

The **MCP server is already built** and browser-agnostic — it lives at `/Users/makram/dev/firefox-extensions/foxhole-debug-bridge/server/`. This project is the Chrome extension only.

---

## Architecture

```
Chrome Extension (this project)          MCP Server (existing, reuse as-is)
┌─────────────────────────────┐         ┌───────────────────────────┐
│ service-worker.js           │◄─ WS ──►│ server/dist/index.js      │
│ content.js                  │         │ (stdio, spawned by CC)    │
│ popup/                      │         └───────────────────────────┘
└─────────────────────────────┘
```

**How it works:**
1. MCP server starts → binds WebSocket on a dynamic OS-assigned port
2. User calls `get_connection_info` in Claude Code → gets `localhost:PORT`
3. User enters that into the extension popup → extension connects via WebSocket
4. Claude calls MCP tools → server sends commands to extension → extension executes in page → response returns

**Key constraint:** Each Claude Code session owns one server process and one port. The extension connects to exactly one session at a time (1:1 binding).

---

## Source material

All logic to port lives in `/Users/makram/dev/firefox-extensions/foxhole-debug-bridge/extension/`:

| Firefox file | Chrome equivalent | Changes needed |
|---|---|---|
| `manifest.json` (MV2) | `manifest.json` (MV3) | Full rewrite — see below |
| `background.js` (1222 lines) | `service-worker.js` | `browser.*` → `chrome.*`, persistent state handling |
| `content.js` (210 lines) | `content.js` | Minimal — mostly copy |
| `popup/popup.html` | `popup/popup.html` | Copy, minor tweaks |
| `popup/popup.js` | `popup/popup.js` | `browser.*` → `chrome.*` |
| `popup/popup.css` | `popup/popup.css` | Copy as-is |
| `devtools/devtools.html` | `devtools/devtools.html` | Copy |
| `devtools/devtools.js` | `devtools/devtools.js` | `browser.*` → `chrome.*` |
| `onboarding/` | `onboarding/` | Copy, minor tweaks |
| `readability.js`, `turndown.js` | same | Copy as-is |
| `icons/` | `icons/` | Copy as-is or create new |

---

## MV2 → MV3 migration notes

### manifest.json changes

```json
// MV2 (Firefox)
{
  "manifest_version": 2,
  "background": { "scripts": ["background.js"], "persistent": true },
  "browser_action": { "default_popup": "popup/popup.html" },
  "content_security_policy": "script-src 'self'; object-src 'self'"
}

// MV3 (Chrome)
{
  "manifest_version": 3,
  "background": { "service_worker": "service-worker.js", "type": "module" },
  "action": { "default_popup": "popup/popup.html" },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  },
  "host_permissions": ["<all_urls>"],
  "permissions": ["tabs", "activeTab", "storage", "webNavigation", "webRequest", "cookies", "scripting"]
}
```

Remove `browser_specific_settings` (Firefox-only).

### background.js → service-worker.js

**Critical difference: service workers are ephemeral.** Chrome can kill the SW between events. All top-level `let` variables (`ws`, `connectionState`, `SERVER_URL`, etc.) will be reset when the SW wakes.

**Solutions:**
- Store connection URL in `chrome.storage.session` (persists until browser close, survives SW restart)
- Re-establish WebSocket on SW wake using stored URL
- Or keep SW alive with a keepalive ping (use `chrome.alarms` to wake every 20s and ping the WS)

**API changes:**
- `browser.*` → `chrome.*` everywhere
- `browser.tabs.sendMessage` → `chrome.tabs.sendMessage`
- `browser.runtime.sendMessage` → `chrome.runtime.sendMessage`
- `browser.storage.local` → `chrome.storage.local`
- `browser.webNavigation` → `chrome.webNavigation`
- `browser.webRequest` → `chrome.webRequest` (still works in MV3 for read-only capture)
- `browser.devtools` → `chrome.devtools` (devtools page only)

**WebSocket in service worker:** Works fine. Chrome does not terminate an SW with an open WebSocket connection as long as messages are flowing. Use a keepalive alarm as a safety net.

### content.js

Minimal changes:
- `browser.runtime.sendMessage` → `chrome.runtime.sendMessage`  
- `browser.runtime.onMessage` → `chrome.runtime.onMessage`
- Remove IIFE guard using `window.__tetherweb_injected` — in MV3, content scripts are not injected twice by default
- The `dispatchEvent` / DOM interaction code is identical

### DevTools page

`browser.devtools.network.onRequestFinished` → `chrome.devtools.network.onRequestFinished`  
Works the same in Chrome.

### popup.js

- `browser.*` → `chrome.*`
- `browser.runtime.connect` / `chrome.runtime.connect` for long-lived popup↔SW channel
- Storage key names: keep `tetherwebServerUrl`, `tetherwebConsent` (same as Firefox)

---

## Project structure to create

```
/Users/makram/dev/chrome-extensions/tethernet/
├── manifest.json          ← MV3, new
├── service-worker.js      ← ported from background.js
├── content.js             ← ported from content.js
├── readability.js         ← copy from Firefox extension
├── turndown.js            ← copy from Firefox extension
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── devtools/
│   ├── devtools.html
│   └── devtools.js
├── onboarding/
│   ├── onboarding.html
│   └── onboarding.js
└── icons/
    ├── icon-16.png
    ├── icon-32.png
    ├── icon-48.png
    └── icon-96.png
```

---

## Improvements to add (from research)

These were identified from studying the Claude Chrome extension during this session. See `chrome-extension-research.md` for full details.

### 1. Accessibility tree tool (high value)

Add a `get_accessibility_tree` tool with a `filter` parameter:
- `filter=interactive` — returns only clickable/typeable elements; perfect for "what can I interact with?"
- `filter=all` — ignores visibility/aria-hidden
- default — visible, in-viewport elements only

Implementation: port `window.__generateAccessibilityTree` from the Claude extension's `accessibility-tree.js`. The function is clean and self-contained. Full spec is in `chrome-extension-research.md`.

Stable `ref_id` handles (`ref_1`, `ref_2`...) stored in `window.__tethernetElementMap` as WeakRefs, survive React re-renders unlike CSS selectors.

### 2. WeakRef element registry

Add to content.js:
```javascript
window.__tethernetElementMap = window.__tethernetElementMap || {};
window.__tethernetElementReverseMap = window.__tethernetElementReverseMap || new WeakMap();
window.__tethernetRefCounter = window.__tethernetRefCounter || 0;
```

Allow `click_element`, `type_text` etc. to accept a `refId` in addition to a CSS `selector`. When an action fails, return the element's `getBoundingClientRect()` so the model can screenshot-verify and retry.

### 3. browser_batch tool (high value)

Add a `browser_batch` action that accepts an array of actions and executes them sequentially in one round-trip:
```json
{
  "actions": [
    { "action": "click_element", "selector": "#email" },
    { "action": "type_text", "text": "user@example.com" },
    { "action": "click_element", "selector": "#password" },
    { "action": "type_text", "text": "..." },
    { "action": "click_element", "selector": "[type=submit]" }
  ]
}
```
Each MCP tool call is a round-trip through stdio→WebSocket→content script→response. Batching a form fill from 5 calls to 1 is a large UX improvement.

Add nudge to `get_started` instructions:
> "Prefer browser_batch for click→type→key sequences, form fills, and multi-step navigation. Batching is significantly faster than individual calls."

### 4. Phantom cursor (nice to have)

Inject a visible SVG cursor that moves to the target element when Claude is guiding:
```javascript
// Fixed position, pointer-events: none, z-index: 2147483646
// translate3d(x, y, 0) with transition: transform 180ms cubic-bezier(0.2, 0, 0, 1)
// Dual SVG: white fill + drop shadow copy
```
Update position via content script before each action. Remove on disconnect.

### 5. Network capture via Chrome Debugger API

Unlike Firefox (which needs DevTools open for response bodies), Chrome has `chrome.debugger` API available to extensions. This enables full request+response body capture without requiring the user to open DevTools.

```javascript
// In service worker:
await chrome.debugger.attach({ tabId }, '1.3');
chrome.debugger.sendCommand({ tabId }, 'Network.enable');
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === 'Network.responseReceived') { /* ... */ }
  if (method === 'Network.loadingFinished') {
    chrome.debugger.sendCommand(source, 'Network.getResponseBody', { requestId: params.requestId });
  }
});
```

This removes the "F12 must be open" requirement that is the biggest pain point in Tetherweb's network capture.

---

## MCP server setup (unchanged)

The existing server works as-is. Register it with Claude Code:
```bash
claude mcp add tethernet --scope user -- node /Users/makram/dev/firefox-extensions/foxhole-debug-bridge/server/dist/index.js
```

Or via npx (once published):
```bash
claude mcp add tethernet --scope user -- npx -y @drbenedictporkins/tetherweb-mcp
```

---

## How to load in Chrome during development

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select `/Users/makram/dev/chrome-extensions/tethernet/`
4. The extension appears; note the extension ID
5. Open popup → enter `localhost:PORT` from `get_connection_info` → Connect

Auto-reload on file change: use `chrome-extension-tools` or just click the reload button in `chrome://extensions`.

---

## Reference files

- Firefox extension source: `/Users/makram/dev/firefox-extensions/foxhole-debug-bridge/extension/`
- MCP server source: `/Users/makram/dev/firefox-extensions/foxhole-debug-bridge/server/`
- Research findings: `/Users/makram/dev/firefox-extensions/foxhole-debug-bridge/docs/chrome-extension-research.md`
- CLAUDE.md (project conventions): `/Users/makram/dev/firefox-extensions/foxhole-debug-bridge/CLAUDE.md`
