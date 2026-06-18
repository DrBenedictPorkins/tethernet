# Chrome Web Store — Tethernet Listing

## Name
Tethernet

## Category
Developer Tools

## Short Description (132 chars max)
Connect Chrome to a local AI coding session. Live DOM inspection, network capture, request interception, and page interaction for developers.

## Detailed Description

Tethernet is a developer tool that creates a local bridge between your Chrome browser and an AI assistant (such as Claude Code) running on your own machine.

It is not an AI extension. It contains no AI. It connects your browser to a local server you run — giving your AI coding session the ability to see and interact with what's in your browser in real time.

**What it does**

Once connected, your local AI session can:

- Read page content, DOM structure, and extracted text from any open tab
- Take screenshots of pages and specific elements
- Click, type, scroll, hover, and fill forms at your direction
- Execute JavaScript in a page — identical to the DevTools console
- Capture HTTP requests and responses, including response bodies, without opening DevTools
- Read and set cookies to debug authentication and session state
- Monitor downloads, manage tabs, and navigate between pages
- Capture all network activity silently in the background (Passive Mode)
- Intercept outgoing fetch/XHR requests and inspect or modify their payloads
- Mock endpoints — intercept requests matching a URL pattern and return your own response
- Replay captured requests with modified payloads for testing
- Auto-identify third-party telemetry calls (analytics, ad pixels, tracking beacons) on any page

**Who it is for**

Developers who use Claude Code, Claude Desktop, or any MCP-compatible AI assistant for web development, debugging, or site analysis. Not for general browser users — this tool requires running a local server process and does not do anything useful on its own.

**How it works**

1. Install the extension
2. Run the Tethernet MCP server on your machine (`node dist/index.js`)
3. Start a Claude Code session and call `get_connection_info` to get your port
4. Click the Tethernet icon, enter the port, and connect

All traffic goes to `ws://localhost:PORT` — your own machine. Nothing is sent to any external server.

**Privacy**

This extension does not collect, store, or transmit your data anywhere. All WebSocket communication is exclusively to localhost. No analytics, no telemetry, no external connections of any kind. See the full privacy policy at: https://drbenedictporkins.github.io/tethernet/privacy.html

**Permissions explained**

Every permission is required for a specific developer workflow:

- `debugger` — captures HTTP response bodies during active capture sessions (same data as the DevTools Network panel). Attached only to the active tab, only while recording. Detaches immediately when capture ends.
- `scripting` + `<all_urls>` — executes JavaScript in pages at the developer's direction. Equivalent to typing in the DevTools console. Required on all URLs because developers work across many sites.
- `webRequest` — reads request metadata (URLs, headers, timing) for network debugging. Listeners are registered but idle until a capture session starts.
- `cookies` — reads non-HttpOnly cookies to debug auth and session state. HttpOnly cookies are inaccessible by platform design.
- `offscreen` — holds the WebSocket connection open. Chrome MV3 service workers are killed after ~30s of inactivity; the offscreen document keeps the connection alive.

**Consent gate**

On first install, a full onboarding page opens explaining every capability and its risks, including prompt injection. The extension is completely inactive until the user reads the disclosure and explicitly checks a consent checkbox. Consent can be revoked from the popup at any time.

**Open source**

Source code available at: https://github.com/DrBenedictPorkins/tethernet

---

## Screenshots (1280×800 required — 5 recommended)

1. Onboarding consent page — shows the risk disclosure and consent gate
2. Popup connected state — shows active session, tab status, passive mode toggle
3. Claude Code terminal running a DOM inspection command with result
4. Passive Mode report page — domain breakdown, API call analysis
5. Network capture in action — request/response list with body preview

## Privacy Policy URL
https://drbenedictporkins.github.io/tethernet/privacy.html
