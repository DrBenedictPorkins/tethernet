# Tethernet

Browser co-pilot for Claude Code and Claude Desktop — built for network depth. Tethernet connects your real Chrome session to Claude and gives it tools most browser extensions don't have: **full HTTP response bodies via CDP**, **passive background capture**, **live request interception and replay**, and **automatic telemetry vendor classification**. All traffic stays on localhost. No cloud. No AI inside the extension.

---

## TL;DR — Get Running in 5 Minutes

### Step 1 — Install the MCP server

**Claude Code:**
```bash
claude mcp add tethernet --scope user -- npx -y @drbenedictporkins/tethernet-mcp
```

**Claude Desktop** — edit your config file and add to `mcpServers`:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "tethernet": {
      "command": "npx",
      "args": ["-y", "@drbenedictporkins/tethernet-mcp"]
    }
  }
}
```

Restart Claude Desktop after editing.

**Manual install (if npx isn't available or you want a local build):**
```bash
git clone https://github.com/DrBenedictPorkins/tethernet-mcp.git
cd tethernet-mcp
npm install && npm run build
```

Then point Claude at the built file:
```bash
# Claude Code
claude mcp add tethernet --scope user -- node /path/to/tethernet-mcp/dist/index.js

# Claude Desktop
{
  "mcpServers": {
    "tethernet": {
      "command": "node",
      "args": ["/path/to/tethernet-mcp/dist/index.js"]
    }
  }
}
```

> **Requires Node.js 18 or later.**

---

### Step 2 — Load the Chrome extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (toggle, top right)
3. Click **Load unpacked**
4. Select the `tethernet/` directory (this repo)

The Tethernet icon appears in your toolbar.

---

### Step 3 — Enable in the onboarding page

The first time you load the extension, an onboarding page opens automatically. Read the data access disclosure, check the consent box, and click **Enable Tethernet**.

If you skip this step, all commands will be blocked until you complete it. You can re-open the onboarding page from `chrome://extensions → Tethernet → Details`.

---

### Step 4 — Connect from the popup

1. Start a Claude Code session (or open Claude Desktop)
2. Ask Claude: **"What is the Tethernet connection port?"** — Claude calls `get_connection_info` and returns `localhost:PORT`
3. Click the Tethernet icon in Chrome
4. Enter the port number (or `localhost:PORT`) and click **Connect**

The icon turns green when connected. The popup shows the session name and which tab is active.

---

### Step 5 — Ask Claude to help with a browser task

```
"I'm on the AWS IAM console. Help me create a new user."
"Navigate to my app's login page and fill in the form with these credentials."
"Capture the network traffic when I click Submit and show me what the API returns."
"Take a screenshot of the current tab and tell me what you see."
```

Claude navigates, screenshots, guides, and interacts — in your real browser session, with all your cookies and credentials already present.

---

## What Tethernet Does

Tethernet turns Claude into a browser co-pilot that works inside your real Chrome session. You're already logged in everywhere — no credential setup, no OAuth flows, no cookie injection. Claude sees what you see, interacts with what you can interact with, and has full visibility into what's happening on the network.

**Where Tethernet goes deeper than other browser extensions:**

- **Full response bodies** — Claude sees complete HTTP request + response payloads via Chrome's Debugger API, not just URLs and headers. Same data as the DevTools Network panel, without opening DevTools.
- **Passive Mode** — silently logs all network activity as you browse. No capture session to start, no DevTools to open. Browse normally, then ask Claude what was on the wire.
- **Request interception and replay** — Claude hooks into `fetch`/`XHR`, captures calls mid-flight, replays with modified payloads, or stubs any endpoint with a synthetic response. Test server behavior without touching your backend.
- **Telemetry detection** — classifies third-party network calls by vendor (Conviva, Nielsen, Comscore, GA4, Segment, Amplitude, New Relic). Audit what a page actually sends to third parties.

**When to use it:**

- Debugging an API — capture live network traffic with full response bodies from your authenticated session
- Auditing third-party telemetry — find every analytics and tracking call a page makes, classified by vendor
- Testing API behavior — intercept live requests, replay with modified payloads, or mock responses without a real server
- Navigating complex admin consoles (AWS, GCP, Stripe, App Store Connect, DNS panels) with Claude confirming each step via screenshot
- Automating repetitive form work across many records
- Extracting structured data from auth-gated pages — Readability runs on your real logged-in session
- Investigating bugs — console errors, network failures, and WebSocket frames all in one place

**Capabilities:**

| What | Details |
|---|---|
| Screenshots | Full tab, cropped to element, scaled — PNG or JPEG |
| Page reading | Full DOM structure, clean Markdown (via Readability + Turndown), full ARIA accessibility tree |
| DOM queries | Find by CSS selector, ref ID, or natural language; inspect any element; target iframes by frame ID |
| Navigation | Navigate to URL, go back/forward, reload, manage multiple tabs; pin a primary tab Claude returns to |
| Interaction | Click, type, fill forms, press keys, scroll, select options, set checkboxes, upload files, handle dialogs |
| Network capture | Full request + response bodies via Chrome Debugger API — headers, payloads, status, timing, and WebSocket frames |
| Script execution | Run JavaScript in the page's main context — same as DevTools console |
| Cookies & storage | Read/set cookies and `chrome.storage.local` for auth debugging |
| Console & errors | `console.log`, `console.warn`, `console.error`, and unhandled JS exceptions as a live stream |
| Batch operations | Multiple browser actions in a single round-trip |
| HTTP with session | Fire fetch requests that inherit the tab's cookies, session tokens, and auth headers |
| Download handling | Wait for file downloads and get filename, size, MIME type, and final URL |
| Page audit | Lighthouse-style audit (Performance, Accessibility, SEO, Best Practices) using your real session — no headless Chrome |

---

## How Claude Handles Different Types of Sites

Not every site responds the same way to automation. Tethernet uses a three-tier approach, escalating based on what works:

### Tier 1 — Screenshot + Guide (SPAs and JS-heavy sites)

React, Vue, Angular, and Next.js apps manage state in JavaScript, not the DOM. Clicking a button programmatically often does nothing because the app is listening for `isTrusted: true` events from real user input. On these sites, Tethernet switches to a co-pilot mode:

1. Claude takes a screenshot and tells you exactly what to click: *"Click the blue 'Add Member' button in the top-right corner"*
2. You click it
3. Claude takes another screenshot to confirm it worked
4. Repeat for each step

You stay in control. Claude is your navigator.

### Tier 2 — DOM Automation (standard sites)

On sites where synthetic events work, Claude interacts directly — clicking elements, filling forms, pressing keys, selecting options. No user action required. Claude can complete multi-step flows unattended and verify each step with a screenshot.

### Tier 3 — Native Click (macOS, for stubborn elements)

Some SPA elements respond only to genuine OS-level mouse events — the kind with `isTrusted: true` that the browser only generates for real input. `native_click` uses `cliclick` or AppleScript to fire a real mouse click at the element's screen coordinates, bypassing all JavaScript event filtering. This works on elements that ignore both DOM automation and ordinary click simulation.

Claude detects which tier applies automatically when you call `get_started` and adjusts its approach accordingly.

---

## Site Memory

Tethernet can learn a site's layout once and reuse that knowledge on every future visit — selectors, quirks, named scripts, and workarounds all persist in the browser across sessions.

### How it works

When you tell Claude to learn a site (`"learn this page"`, `"map this site"`, `"remember this layout"`), it stores a structured JSON object in `chrome.storage.local` under a `site:domain` key. On every subsequent visit to that domain, Claude loads the saved context automatically before doing anything else.

```
You: "Learn the GitHub PR review page layout."

Claude: Scans the page, finds key elements, identifies the SPA framework,
        saves selectors for the diff view, approve/request-changes buttons,
        comment box, and submit review button.

You (next session, same page): "Approve this PR."

Claude: Loads saved layout → clicks approve → submits. No re-discovery needed.
```

### Named scripts

Beyond layout, you can save reusable JavaScript snippets by name:

```
You: "Write a script to collapse all resolved comments and save it as 'collapse resolved'."

Claude: Writes the script, saves it under site:github.com → scripts → "collapse resolved"

You (any future session): "Run 'collapse resolved'."

Claude: Loads and executes the saved script instantly.
```

### Autorun

Scripts can be marked to run automatically every time you visit a domain:

```
You: "Save the cookie banner dismissal as autorun."

Claude: Marks it — the script now runs silently on every visit before Claude does anything else.
```

### What gets saved

```json
{
  "savedAt": "2025-06-07T14:23:00Z",
  "url": "https://example.com/dashboard",
  "spa": { "react": true, "next": false },
  "keyElements": {
    "submitButton": "[data-testid='submit']",
    "searchInput": "input[aria-label='Search']"
  },
  "scripts": {
    "remove paywall": "document.querySelector('.paywall-overlay')?.remove()",
    "collapse resolved": "..."
  },
  "autorun": ["remove paywall"],
  "workarounds": "Date picker ignores click_element — use URL params ?date=2025-06-07 instead",
  "notes": "Login requires 2FA — connect Tethernet after completing auth"
}
```

Nothing is saved automatically. Claude only saves when you explicitly ask it to.

---

## Page Auditing (Lighthouse-style)

`run_lighthouse` runs a four-category page audit directly through the extension's Chrome Debugger connection — no headless browser, no separate process, no external dependencies. Because it runs inside your real Chrome session, it audits the page exactly as you see it, including authenticated content.

### How it differs from Lighthouse CLI

| | Tethernet `run_lighthouse` | Lighthouse CLI / headless |
|---|---|---|
| Uses real session | Yes — your cookies, your auth | No — fresh profile |
| External process | No — runs in the extension | Yes — spawns Chrome |
| Conflicts with network capture | Yes (same debugger) — stop capture first | No |
| Audits auth-gated pages | Yes | No |
| Works on localhost | Yes | Yes |

### What gets audited

**Performance** — Core Web Vitals scored against Google's thresholds:

| Metric | Good | Needs improvement | Poor |
|---|---|---|---|
| FCP (First Contentful Paint) | ≤ 1800ms | ≤ 3000ms | > 3000ms |
| LCP (Largest Contentful Paint) | ≤ 2500ms | ≤ 4000ms | > 4000ms |
| CLS (Cumulative Layout Shift) | ≤ 0.1 | ≤ 0.25 | > 0.25 |
| TTFB (Time to First Byte) | ≤ 800ms | ≤ 1800ms | > 1800ms |

Also reported: DOM node count, total script duration, JS heap usage, and layout count via Chrome's `Performance.getMetrics` CDP command.

**Accessibility** — structural checks without axe-core:
- Images missing `alt` attribute
- Form inputs without accessible labels (`aria-label`, `aria-labelledby`, associated `<label>`)
- Buttons without accessible names
- Missing `lang` attribute on `<html>`
- Multiple `<h1>` elements or no `<h1>`
- Links without accessible names

**SEO** — meta and content checks:
- Title presence and length (optimal: 10–60 chars)
- Meta description presence and length (optimal: 50–160 chars)
- Single `<h1>`
- Viewport meta tag
- Canonical URL
- Robots meta (flags `noindex`)
- Images with alt text
- JSON-LD structured data

**Best Practices**:
- HTTPS
- Valid HTML5 doctype
- UTF-8 charset
- Images with explicit `width`/`height` (layout shift prevention)
- Password inputs on HTTPS

### Example output

```
You: "Run a Lighthouse audit on this page."

Claude: Overall: 89/100
        Performance:    100  FCP 64ms · LCP 64ms · CLS 0.000 · TTFB 12ms
        Accessibility:  100  No issues found
        SEO:             75  ✗ Missing meta description · ✗ No canonical URL · ✗ No structured data
        Best practices:  80  ✗ Charset is windows-1252 — should be UTF-8
```

### Constraint

`run_lighthouse` attaches the Chrome debugger to the tab (same as network capture). If `start_network_capture` is already active on that tab, `run_lighthouse` will return an error — call `stop_network_capture` first.

---

## How It Works

```
┌─────────────────────────────────┐
│  Claude Code / Claude Desktop   │
│  (your terminal or app)         │
└────────────┬────────────────────┘
             │ MCP (stdio)
             ▼
┌─────────────────────────────────┐
│  tethernet-mcp                  │
│  (local Node.js process)        │
│  binds WebSocket on localhost   │
└────────────┬────────────────────┘
             │ WebSocket (localhost only)
             ▼
┌─────────────────────────────────┐
│  Tethernet Chrome Extension     │
│  service-worker.js              │
│  content.js (per-tab)           │
└────────────┬────────────────────┘
             │ chrome.scripting / chrome.tabs / etc.
             ▼
┌─────────────────────────────────┐
│  Your Chrome Browser            │
│  (real session, real cookies)   │
└─────────────────────────────────┘
```

**Key design decisions:**

- **Localhost only.** The WebSocket connection is always `ws://localhost:PORT`. No data leaves your machine through this extension.
- **1:1 session binding.** Each Claude session owns one MCP server process and one port. One extension connection per session.
- **Consent gate.** No commands execute until you complete the onboarding consent flow. You can revoke consent from the popup at any time.
- **Offscreen document.** The WebSocket lives in a Chrome offscreen document, not the service worker — this prevents the MV3 30-second idle termination from dropping your connection.

---

## Tool Reference

### Setup

| Tool | Description |
|---|---|
| `get_started` | Call first — returns instructions on how to use Tethernet effectively |
| `get_connection_info` | Returns the current `localhost:PORT` to enter in the extension popup |
| `get_connection_status` | Check whether the extension is connected |

### Tab Management

| Tool | Description |
|---|---|
| `list_tabs` | List all open tabs with URLs, titles, and content script status |
| `get_active_tab` | Get the currently active tab |
| `switch_tab` | Switch to a tab by ID |
| `set_primary_tab` | Set the default tab used when `tabId` is omitted from other commands |
| `get_primary_tab` | Get the current primary tab |
| `create_tab` | Open a new tab at a URL |
| `close_tab` | Close a tab by ID |
| `list_frames` | List all frames (including iframes) in a tab |

### Navigation

| Tool | Description |
|---|---|
| `navigate` | Navigate a tab to a URL |
| `go_back` | Navigate back in history |
| `go_forward` | Navigate forward in history |
| `reload_page` | Reload a tab (optionally bypass cache) |

### Page Reading

| Tool | Description |
|---|---|
| `get_page_content` | Return page content as clean Markdown (via Readability + Turndown) |
| `get_page_text` | Return plain text content of the page |
| `dom_stats` | Return element count, depth, and size stats — check this before `get_dom_structure` |
| `get_dom_structure` | Return the DOM tree (with depth/element limits to control size) |

### Screenshots

| Tool | Description |
|---|---|
| `take_screenshot` | Capture the visible tab area. Supports `cropTo` (rect), `selector` (CSS), `scale`, and format options (`jpeg`/`png`) |

### DOM Queries

| Tool | Description |
|---|---|
| `find` | Find elements by CSS selector — returns element refs, text, attributes, bounds |
| `get_element` | Get full details for a specific element (by selector or ref ID) |
| `get_ref` | Look up a previously assigned ref ID |
| `get_accessibility_tree` | Return the accessibility tree. Filter: `interactive` (clickable/typeable only), `all`, or default (visible elements) |

### Interaction

| Tool | Description |
|---|---|
| `click_element` | Click an element by CSS selector or ref ID |
| `type_text` | Type text into the focused or specified element |
| `fill_form` | Fill multiple form fields in one call |
| `press_key` | Simulate a keyboard key press (e.g. `Enter`, `Escape`, `Tab`) |
| `scroll_to` | Scroll to an element or specific coordinates |
| `hover_element` | Hover over an element |
| `focus_element` | Focus an input or interactive element |
| `select_option` | Select a value from a `<select>` element |
| `set_checkbox` | Check or uncheck a checkbox |
| `native_click` | Synthesize a real mouse click at screen coordinates — **macOS only** (requires `cliclick` or AppleScript) |
| `handle_dialog` | Install an interceptor for `alert`, `confirm`, and `prompt` dialogs. Call before the action that triggers the dialog. Use `drain:true` to read and clear the log. Does not intercept `beforeunload` dialogs. |
| `upload_file` | Set a file on an `<input type="file">` element from content you provide (text or base64). Fires `change` and `input` events. Works without the native file chooser. |

### Batch Operations

| Tool | Description |
|---|---|
| `browser_batch` | Execute multiple browser actions (click, type, key, scroll) sequentially in one call — significantly faster than individual tool calls for multi-step sequences |

### Script Execution

| Tool | Description |
|---|---|
| `execute_script` | Run JavaScript in the page's main context. Returns the result. Supports `preview` (first 50KB) and `force` (bypass size limit) options |

### Waiting

| Tool | Description |
|---|---|
| `wait_for_element` | Wait until a CSS selector appears in the DOM |
| `wait_for_text` | Wait until specific text is visible on the page |
| `wait_for_url` | Wait until the URL matches a pattern |
| `wait_for_navigation` | Wait for the page to finish navigating |

### Passive Mode

Passive mode silently logs all network activity in a ring buffer (max 500 entries) as you browse — no DevTools, no capture session, no user action required. Enable it from the extension popup. The buffer persists across page navigations until you clear it or disable passive mode.

| Tool | Description |
|---|---|
| `get_passive_log` | Return entries from the passive ring buffer. Filter by `type`: `net` (network requests), `interaction` (clicks/submits), or `all`. Optional `limit` |
| `clear_passive_log` | Clear the passive log buffer |
| `find_beacons` | Scan the passive log and classify entries by analytics/telemetry vendor (Conviva, Nielsen, Comscore, New Relic, GA4, Segment, Amplitude, and others). Returns grouped results by category |

### Network Capture

Network capture records HTTP requests and responses — including full response bodies — without opening DevTools. Chrome's Debugger API is used for response bodies; a "Chrome is being controlled by automated software" bar appears on the recorded tab while recording is active.

| Tool | Description |
|---|---|
| `start_network_capture` | Begin capturing. Options: `tabId`, `urlFilter`, `methodFilter`, `maxEntries` (max 500), `maxBodySize` |
| `stop_network_capture` | Stop capturing and return a summary |
| `capture_network` | One-shot: start, wait N milliseconds, stop, return results |
| `get_capture` | Retrieve the current capture. Modes: `full`, `slim` (headers only), `summary` (stats), or request specific entry indexes |
| `find_in_capture` | Search captured entries by query string or regex across URL, headers, request body, or response body |
| `clear_capture` | Clear all captured data |

### Request Interception & Mocking

Intercept live fetch/XHR calls from a page, inspect their payloads, replay them with modifications, or stub the response entirely. Useful for testing how a page behaves under different server conditions without a real backend.

| Tool | Description |
|---|---|
| `intercept_requests` | Install hooks into `fetch` and `XMLHttpRequest` on the page to capture outgoing requests matching a URL pattern. Captured requests accumulate until cleared |
| `get_intercepted_requests` | Return all requests captured since the last intercept or clear. Includes URL, method, headers, and request body |
| `clear_intercepted_requests` | Remove all captured intercept data and uninstall the hooks |
| `replay_request` | Re-fire a previously captured request, optionally overriding URL, method, headers, or body. Returns status, response headers, and body |
| `mock_endpoint` | Intercept all requests matching a URL pattern and return a synthetic response (status, headers, body) instead of hitting the real server |
| `clear_mocks` | Remove all active endpoint mocks |

### Console & Error Capture

| Tool | Description |
|---|---|
| `capture_console` | Capture `console.log`, `console.warn`, `console.error` output from the page |
| `capture_errors` | Capture unhandled JavaScript errors and promise rejections |
| `capture_websocket` | Monitor WebSocket frames on a specific connection (by URL pattern) |

### Cookies & Storage

| Tool | Description |
|---|---|
| `get_cookies` | Get cookies for a URL. Note: HttpOnly cookies are not accessible (Chrome platform limitation) |
| `set_cookie` | Set a cookie |
| `browser_storage_get` | Get a value from `chrome.storage.local` |
| `browser_storage_set` | Set a value in `chrome.storage.local` |
| `browser_storage_list` | List keys (optionally with values) in `chrome.storage.local`, filterable by prefix |
| `browser_storage_delete` | Delete a key from `chrome.storage.local` |

### Downloads & HTTP

| Tool | Description |
|---|---|
| `wait_for_download` | Wait for a file download to complete and return its filename, URL, MIME type, and size. Call immediately after clicking a download button. Supports `timeout` (ms) and `urlPattern` (substring filter for concurrent downloads). |
| `fetch_with_session` | Fire an HTTP request from inside the active tab, automatically including that tab's cookies and session credentials. Returns status, headers, and parsed body (JSON auto-detected). Supports all HTTP methods, custom headers, request body, and `maxBodySize` to cap large responses. |

### Audit

| Tool | Description |
|---|---|
| `run_lighthouse` | Run a Lighthouse-style page audit against the active tab using the extension's own Chrome Debugger connection — no headless browser, no separate process, real session included. Audits: **Performance** (FCP, LCP, CLS, TTFB, DOM node count, script duration via CDP), **Accessibility** (missing alt text, unlabeled inputs, unnamed buttons, heading structure, empty links), **SEO** (title, meta description, canonical, structured data, viewport, robots meta), **Best Practices** (HTTPS, doctype, charset, image dimensions). Returns per-category scores 0–100 with per-check detail. Cannot run concurrently with active network capture on the same tab. |

---

## Security & Privacy

**What Tethernet can access:**

Once connected and consent granted, Claude can read any open tab's content, run JavaScript in any page, capture network traffic, and read non-HttpOnly cookies. This is equivalent to having DevTools open with a developer in the console.

**What Tethernet cannot do:**

- Connect to any external server — all WebSocket traffic is `ws://localhost:PORT`
- Store any data persistently beyond the current session
- Access HttpOnly cookies (Chrome platform restriction)
- Run without your explicit consent (onboarding gate)

**Prompt injection risk:**

Malicious pages can embed hidden instructions designed to manipulate AI assistants. A page you visit could attempt to instruct Claude to read data from other tabs, extract tokens, or submit forms on your behalf. Mitigations:

- Use Tethernet only on sites you trust
- Review what Claude is about to do before it acts on forms or accounts
- Disconnect from the popup when you're not actively using it
- Do not use Tethernet on pages with user-generated content you haven't reviewed

---

## Platform Notes

**macOS:** All features supported. `native_click` (real mouse coordinate click via `cliclick` or AppleScript) is macOS-only and requires `cliclick` to be installed (`brew install cliclick`). All other tools work without it.

**Linux / Windows:** Core features work (screenshots, page reading, network capture, DOM interaction, script execution). `native_click` is unavailable — use `click_element` instead.

**Chrome:** Required. Firefox is supported by a separate extension ([tetherweb](https://github.com/DrBenedictPorkins/tetherweb)).

**Node.js:** 18 or later required for the MCP server.

**CSP-strict sites:** Pages that block `unsafe-eval` in their Content Security Policy will also block `execute_script` — the same restriction that applies to the DevTools console on those pages.

---

## Troubleshooting

**"Content script not loaded" badge on a tab**

The content script didn't inject when the tab loaded. Reload the page — the content script will inject on the next load. The badge clears automatically.

**Extension disconnects after ~30 seconds**

This should not happen — the offscreen document keeps the connection alive. If it does, ensure you're running Chrome 116 or later (offscreen document support) and check `chrome://extensions` for errors in the service worker.

**"Chrome is being controlled by automated software" bar**

This appears on the active tab whenever network capture is running (the Chrome Debugger API is attached). It disappears when you stop the capture. This is normal Chrome behavior.

**`execute_script` returns an error on a specific site**

The site likely has a strict CSP that blocks `unsafe-eval`. This is a browser security boundary — the same code would fail in the DevTools console on that site. Use `get_dom_structure`, `find`, or `get_accessibility_tree` instead of script execution on those pages.

**`get_connection_info` returns "not connected"**

The MCP server isn't running. Check that:
1. The `tethernet` MCP server is registered (`claude mcp list` or check `claude_desktop_config.json`)
2. The server process started cleanly (run `node /path/to/dist/index.js` directly to check for errors)
3. Node.js 18+ is on your PATH

**Two Claude sessions — wrong port**

Each Claude session gets its own server and port. Call `get_connection_info` from the specific session you want to connect, then enter that port in the extension popup.

---

## Architecture

Two repositories, both required:

| Repo | What it is |
|---|---|
| `chrome-tethernet` (this repo) | Chrome extension — content scripts, service worker, popup UI |
| [`tethernet-mcp`](https://github.com/DrBenedictPorkins/tethernet-mcp) | MCP server — spawned by Claude Code/Desktop, bridges MCP tools to the extension via WebSocket |

The MCP server is browser-agnostic and works with both the Chrome and Firefox extensions.

---

## License

MIT
