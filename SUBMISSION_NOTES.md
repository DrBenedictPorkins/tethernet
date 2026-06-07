# Chrome Web Store — Submission Notes

## Framing (must come through in every field)

This is a **developer tool**. Not for general Chrome users. It requires a locally-running MCP server, Claude Code installation, and manual setup steps — self-selecting for a developer audience. The consent/onboarding gate makes this explicit before any capability is active. Lead every field with this framing. Do not lead with "AI" or "Claude" — reviewers don't know what MCP is.

---

## Permission inventory — what we have and why

| Permission | Required/Host | Why |
|---|---|---|
| `tabs` | required | List tabs, get active tab, create/close/switch tabs |
| `storage` | required | Persist consent state, server URL |
| `webNavigation` | required | `getAllFrames` for iframe listing |
| `webRequest` | required | Network capture — headers, timing, request bodies |
| `cookies` | required | Read/set cookies for auth debugging |
| `scripting` | required | `executeScript` for DOM inspection and script execution |
| `offscreen` | required | Offscreen document hosts the persistent WebSocket (MV3 service workers die after 30s) |
| `debugger` | required | Response body capture without DevTools open |
| `windows` | required | `windows.update` to focus correct window before screenshot |
| `<all_urls>` | host_permissions | Content scripts must run on any page the developer is working on |

---

## Sensitive permission justifications — use this exact language

### `chrome.scripting.executeScript` with dynamic code

> This extension receives JavaScript strings from a locally-running process on the user's own machine (localhost) and executes them in the page's main context via chrome.scripting.executeScript. The purpose is to let developers inspect page state, read DOM properties, and explore site structure — identical to what a developer does manually in the DevTools console. The code never originates from a remote server. It comes exclusively from the user's own Claude Code session running on localhost. The user must manually enter the server port, connect, and complete an explicit onboarding consent flow before any execution is possible. There is no auto-execution and no third-party involvement at any point.

**Known limitation (document honestly if asked):** Because eval() runs at runtime in the page's JS context, pages with a strict CSP that excludes `unsafe-eval` will block script execution — consistent with how those same pages block DevTools console eval. This is a browser security boundary, not a bug.

### `debugger` (REQUIRED — cannot be optional, Chrome rejects it in `optional_permissions`)

> The debugger API is used solely to capture HTTP response bodies during developer debugging sessions. Without it, developers cannot inspect API response payloads — a fundamental part of understanding how a page works. This is the same data visible in the DevTools Network panel. No data is sent anywhere. Capture is triggered explicitly by the user and stops when the user stops it. The extension attaches to the debugger only on the active tab, only while capture is running, and detaches immediately when the session ends.

**Important:** `debugger` as a required permission triggers manual review (not just automated). Expect a longer review cycle. This is not a dealbreaker — `mcp-chrome` (11.8k stars) ships with required `debugger` and is approved. The justification above is what gets it through. **Do not soften or shorten this text.**

**UX note for users:** Chrome shows a yellow info bar ("Chrome is being controlled by automated software") during active capture while the debugger is attached. This appears only on the tab being recorded, only while recording is active. Not shown at install — only during use.

### `<all_urls>` / host_permissions

> Content scripts must be injectable on any page because developers work across many different sites and localhost environments. The extension does nothing on any page until the user has granted consent and explicitly connected to their local session. All execution is triggered by the developer's own local process, never by page content or remote servers. Pages on chromewebstore.google.com and other sensitive Chrome-controlled domains are blocked by the browser automatically.

### `webRequest`

> Used to capture HTTP request metadata (URLs, methods, status codes, headers, timing, request bodies) during on-demand developer debugging sessions. Listeners are always installed but idle — zero processing occurs when capture is not active. No request data is stored persistently or transmitted anywhere.

### `cookies`

> Used to read and set cookies on the active page to help developers debug authentication and session state. Equivalent to the Application > Cookies panel in DevTools. Note: Chrome does not expose HttpOnly cookies to extensions — this is a platform limitation we document to users.

### `offscreen`

> An offscreen document is required to maintain a persistent WebSocket connection to the locally-running MCP server. Chrome MV3 service workers are terminated after ~30 seconds of inactivity; without the offscreen document the connection would drop constantly. The offscreen document does nothing except hold the WebSocket open and relay messages to the service worker.

---

## No remote code — state this plainly in submission

> No code is ever fetched from a remote URL or external server. All JavaScript executed by this extension originates from the user's own local process. This is verifiable by inspecting the source: the WebSocket connection is always ws://localhost:PORT, entered manually by the user.

---

## What to avoid in submission text

- Do not use "automate" without qualifying: "automate the developer's own browser tasks"
- Do not say "control" the browser — use "inspect", "read", "interact with"
- Do not lead with the AI angle — reviewers may not know what MCP is
- Do not over-explain or apologise — factual and short
- Do not describe it as a "bot" or "agent"

---

## Category

**Developer Tools**

---

## Known limitations to document honestly (if reviewer asks)

- DOM inspection and `execute_script` fail on pages with strict CSP (`unsafe-eval` blocked) — same behavior as DevTools console on those pages
- HttpOnly cookies are not accessible — Chrome platform limitation, not extension limitation
- Network response bodies require the `debugger` permission — shown at install, attached only during active capture

---

## Competitor precedent (internal — do not include in submission)

The following approved extensions ship equivalent or more invasive capabilities:
- `chrome-devtools-mcp` (Google, 42.8k stars): full CDP, heap snapshots, debugger API, performance traces
- `mcp-chrome` (11.8k stars): required `debugger`, content script eval, semantic tab search across all open tabs
- `BrowserMCP` (100k installs): `scripting` + `<all_urls>` — thinner feature set, still approved

---

## Architecture notes for reviewer video / screenshots

1. User installs → onboarding page opens automatically → reads risk disclosure → checks consent checkbox → clicks Enable
2. User runs `claude mcp add tethernet -- node /path/to/server/dist/index.js` in terminal
3. User starts Claude Code session → calls `get_connection_info` tool → gets `localhost:PORT`
4. User clicks extension icon → enters PORT → clicks Connect
5. All WebSocket traffic is `ws://localhost:PORT` only — verifiable in DevTools Network tab
6. No outbound connections to any external server at any point

---

## Manifest snapshot (what was submitted)

```json
permissions: ["tabs", "storage", "webNavigation", "webRequest", "cookies",
              "scripting", "offscreen", "debugger", "windows"]
optional_permissions: (none — debugger cannot be optional in Chrome, Chrome silently omits it)
host_permissions: ["<all_urls>"]
```
