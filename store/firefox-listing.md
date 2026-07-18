# Firefox AMO — Tetherweb Listing

## Name
Tetherweb

## Summary (250 chars max)
MCP browser add-on for Claude Code with full network depth: HTTP response body capture, passive background logging, request interception and replay, telemetry vendor detection. Localhost only. No cloud. No AI inside.

## Description

**What Tetherweb gives Claude Code that other browser extensions don't**

Most browser MCP extensions give Claude the ability to click buttons and read pages. Tetherweb goes deeper — into the network layer, into live request payloads, into what your pages are actually sending to third parties.

**Full HTTP response bodies.** Claude captures complete request and response payloads — not just URLs and status codes. It sees exactly what your API returns, the same data you'd get in DevTools, without you opening DevTools.

**Passive Mode.** Tetherweb silently logs all network activity in a ring buffer as you browse normally. No capture session to start. No DevTools panel to open. Just browse, then ask Claude what was on the wire. Works across page navigations automatically.

**Request interception and replay.** Claude hooks into the page's `fetch` and `XMLHttpRequest` calls, captures outgoing requests mid-flight, replays them with modified payloads, and stubs responses with synthetic data — without touching your server. Test how your page behaves under different API responses by mocking any endpoint.

**Telemetry detection.** Claude scans captured traffic and classifies third-party calls by vendor — Conviva, Nielsen, Comscore, Google Analytics 4, Segment, Amplitude, New Relic, and more. Audit what data a page is actually sending, not what the privacy policy claims.

---

**Standard browser co-pilot capabilities**

On top of network depth, Claude can also:

- Read page content, DOM structure, and extracted text from any open tab
- Take screenshots of pages or specific elements
- Click, type, scroll, hover, and fill forms at your direction
- Execute JavaScript in the page — same access as the browser console
- Read and set cookies to debug authentication and session state
- Manage tabs, navigate pages, handle dialogs, upload files
- Intercept WebSocket frames
- Read pages using Readability (article extraction) and Turndown (HTML to Markdown)

---

**Who it is for**

Developers using Claude Code, Claude Desktop, or any MCP-compatible AI assistant who need to debug APIs, audit network traffic, investigate third-party telemetry, or test how pages behave under different server responses.

This add-on does nothing on its own — it requires the Tethernet MCP server running locally. Not intended for general Firefox users.

**How to connect**

1. Install this add-on
2. Run: `claude mcp add tethernet --scope user -- npx -y @drbenedictporkins/tethernet-mcp`
3. Ask Claude: "What is the Tethernet connection port?"
4. Click the Tetherweb icon and enter the port

All communication is to `ws://localhost:PORT` — your own machine only. Nothing is sent to any external server.

**Privacy**

This add-on does not collect, store, or transmit your data to any external party. All WebSocket communication is exclusively to localhost. No analytics, no tracking, no remote connections. Full privacy policy: https://drbenedictporkins.github.io/tethernet/privacy.html

**Consent**

On first install, a full onboarding page explains every capability and its risks, including prompt injection. The add-on is completely inactive until you explicitly consent. Consent can be revoked from the popup at any time.

**Data collection permissions**

Firefox requires disclosure of data collection categories. This add-on accesses:

- `websiteContent` — reads page DOM, text, and screenshots at the developer's direction
- `browsingActivity` — monitors network requests during capture sessions and passive mode
- `authenticationInfo` — reads non-HttpOnly cookies for authentication debugging
- `websiteActivity` — captures user interactions (clicks, form submissions) when passive mode is enabled

None of this data leaves the user's machine.

**Open source**

https://github.com/DrBenedictPorkins/tethernet

## Privacy Policy URL
https://drbenedictporkins.github.io/tethernet/privacy.html

## Categories
- Developer Tools

## Support Email
mike@byteclub.com
