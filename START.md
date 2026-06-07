You are building a Chrome MV3 extension that is a port of an existing Firefox MV2 extension called Tetherweb.

## Read these files first — in this order

1. `/Users/makram/dev/firefox-extensions/foxhole-debug-bridge/docs/chrome-port-seed.md`
   → Full technical brief: what changes, what stays, MV3 migration details, build order, Chrome Web Store submission language

2. `/Users/makram/dev/firefox-extensions/foxhole-debug-bridge/CLAUDE.md`
   → Architecture overview, file map, all MCP tool names, WebSocket protocol between extension and server

3. `/Users/makram/dev/firefox-extensions/foxhole-debug-bridge/docs/chrome-extension-research.md`
   → Research from studying the official Claude Chrome extension: improvements to layer in (accessibility tree, browser_batch, phantom cursor, chrome.debugger network capture)

## Working directory

`/Users/makram/dev/chrome-extensions/tethernet/`

## Source to port from

`/Users/makram/dev/firefox-extensions/foxhole-debug-bridge/extension/`

Key files:
- `manifest.json` — MV2 Firefox manifest (your starting reference)
- `background.js` — 1222 lines; WebSocket logic, command routing, network capture; becomes service-worker.js + offscreen/offscreen.js
- `content.js` — 210 lines; DOM interaction handlers; nearly unchanged
- `popup/` — connection UI; minor API swaps only
- `onboarding/` — consent flow; copy with minor changes
- `devtools/` — response body capture; **replaced entirely** by chrome.debugger API (see seed doc)

## What you are building

A Chrome extension that connects Chrome to Claude Code via MCP. The MCP server already exists and does not change — only the browser extension changes. The server lives at `/Users/makram/dev/firefox-extensions/foxhole-debug-bridge/server/`.

## Build order

Follow the build order in `chrome-port-seed.md` exactly:

1. `manifest.json` — MV3
2. `offscreen/offscreen.html` + `offscreen/offscreen.js` — WebSocket lives here (not in SW)
3. `service-worker.js` — thin router that delegates to offscreen document
4. `content.js` — port from Firefox, minimal changes
5. `popup/` — port from Firefox, `browser.*` → `chrome.*`
6. `onboarding/` — copy + minor changes
7. Replace `devtools/` with `chrome.debugger` network capture in service-worker.js
8. Copy `readability.js`, `turndown.js`, icons as-is

## Hard constraints

- Do NOT modify anything under `/Users/makram/dev/firefox-extensions/foxhole-debug-bridge/server/`
- The MCP server is transport-agnostic and browser-agnostic — it requires zero changes
- No git commits unless explicitly asked
- No version bumps
- Follow conventions in CLAUDE.md

## After reading the files, confirm you understand these three things before writing any code

1. Why WebSocket must live in an offscreen document (not the service worker)
2. How `chrome.scripting.executeScript` differs from `browser.tabs.executeScript` for dynamic code
3. What capability is permanently lost on Chrome vs Firefox (one thing)
