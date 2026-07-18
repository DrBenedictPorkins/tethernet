# Chrome Web Store — Tethernet Listing

## Name
Tethernet

## Category
Developer Tools

## Short Description (132 chars max)
MCP browser extension for Claude Code: network capture + response bodies, passive mode, request interception, telemetry detection.

## Detailed Description

**What Tethernet gives Claude Code that other browser extensions don't**

Most browser MCP extensions give Claude the ability to click buttons and read pages. Tethernet goes deeper — into the network layer, into live request payloads, into what your pages are actually sending to third parties.

**Full HTTP response bodies.** Claude captures complete request and response payloads using Chrome's Debugger API — not just URLs and status codes. It sees exactly what your API returns, the same data you'd get in the DevTools Network panel, without you opening DevTools.

**Passive Mode.** Tethernet silently logs all network activity in a ring buffer as you browse normally. No capture session to start. No DevTools panel to open. Just browse, then ask Claude what was on the wire. Works across page navigations automatically.

**Request interception and replay.** Claude hooks into the page's `fetch` and `XMLHttpRequest` calls, captures outgoing requests mid-flight, replays them with modified payloads, and stubs responses with synthetic data — without touching your server. Test how your page behaves under different API responses by mocking any endpoint.

**Telemetry detection.** Claude scans captured traffic and classifies third-party calls by vendor — Conviva, Nielsen, Comscore, Google Analytics 4, Segment, Amplitude, New Relic, and more. Audit what data a page is actually sending, not what the privacy policy claims.

---

**Standard browser co-pilot capabilities**

On top of network depth, Claude can also:

- Read page content, DOM structure, and extracted text from any open tab
- Take screenshots of pages or specific elements
- Click, type, scroll, hover, and fill forms at your direction
- Execute JavaScript in the page — same access as the DevTools console
- Read and set cookies to debug authentication and session state
- Manage tabs, navigate, handle dialogs, upload files
- Intercept WebSocket frames
- Run Lighthouse-style performance, accessibility, and SEO audits on your real authenticated session — no headless Chrome
- Store site layout maps and reusable scripts that persist across Claude sessions

---

**Who it is for**

Developers using Claude Code, Claude Desktop, or any MCP-compatible AI assistant who need to debug APIs, audit network traffic, investigate third-party telemetry, or test how pages behave under different server responses.

This extension does nothing on its own — it requires the Tethernet MCP server running locally. Not for general browser users.

**How to connect**

1. Install this extension
2. Run: `claude mcp add tethernet --scope user -- npx -y @drbenedictporkins/tethernet-mcp`
3. Ask Claude: "What is the Tethernet connection port?"
4. Click the Tethernet icon and enter the port

All traffic goes to `ws://localhost:PORT` — your own machine. Nothing is sent to any external server.

**Privacy**

This extension does not collect, store, or transmit your data anywhere. All WebSocket communication is exclusively to localhost. No analytics, no telemetry, no external connections of any kind. Full privacy policy: https://drbenedictporkins.github.io/tethernet/privacy.html

**Permissions explained**

- `debugger` — captures full HTTP response bodies (same data as the DevTools Network panel). Attached only to the active tab during capture, detaches immediately when done.
- `scripting` + `<all_urls>` — runs JavaScript in pages at your direction. Equivalent to the DevTools console. Required on all URLs because developers work across many sites.
- `webRequest` — reads request metadata for passive mode and network debugging. Idle when passive mode is off.
- `cookies` — reads non-HttpOnly cookies to debug authentication and session state. HttpOnly cookies are inaccessible by Chrome design.
- `offscreen` — keeps the WebSocket connection alive. Chrome MV3 service workers are killed after ~30s of inactivity; the offscreen document prevents this.

**Consent gate**

On first install, a full onboarding page opens explaining every capability and its risks, including prompt injection. The extension is completely inactive until you read the disclosure and explicitly consent. Consent can be revoked from the popup at any time.

**Open source**

https://github.com/DrBenedictPorkins/tethernet

---

## Screenshots (1280×800 required — 5 recommended)

1. Onboarding consent page — full risk disclosure and consent gate
2. Popup connected state — active session, passive mode toggle, entry count
3. Passive mode report — domain breakdown, slowest calls, beacon classification
4. Claude Code terminal — network capture showing full response body
5. Request interception — captured fetch calls with mock endpoint in action

## Privacy Policy URL
https://drbenedictporkins.github.io/tethernet/privacy.html
