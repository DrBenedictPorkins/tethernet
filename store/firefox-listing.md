# Firefox AMO — Tetherweb Listing

## Name
Tetherweb

## Summary (250 chars max)
Developer tool: connects Firefox to a local AI coding session for live DOM inspection, network capture, request interception, and page interaction. Requires a locally-running MCP server. Localhost only.

## Description

Tetherweb is a developer tool that bridges your Firefox browser to an AI assistant (such as Claude Code) running on your own machine.

It contains no AI. It creates a local WebSocket connection to a server you run — giving your AI coding session the ability to see and interact with your browser in real time.

**What it does**

Once connected, your local AI session can:

- Read page content, DOM structure, and extracted text from any open tab
- Take screenshots of pages and specific elements
- Click, type, scroll, hover, and fill forms at your direction
- Execute JavaScript in the page — identical to the browser console
- Capture HTTP requests, headers, and response metadata
- Read and set cookies to debug authentication and session state
- Monitor tab activity and navigate between pages
- Capture all network activity silently in the background (Passive Mode)
- Intercept outgoing fetch/XHR requests and inspect or modify their payloads
- Mock endpoints — intercept requests matching a URL pattern and return your own response
- Replay captured requests with modified payloads for testing
- Auto-identify third-party telemetry calls (analytics, ad pixels, tracking beacons) on any page
- Read pages using Readability (article extraction) and Turndown (HTML to Markdown)

**Who it is for**

Developers using Claude Code, Claude Desktop, or any MCP-compatible AI assistant. This add-on does nothing useful on its own — it requires a locally-running server process. Not intended for general Firefox users.

**How it works**

1. Install the add-on
2. Run the Tetherweb MCP server on your machine
3. Start a Claude Code session and get your connection port
4. Click the Tetherweb icon, enter the port, and connect

All communication is to `ws://localhost:PORT` — your own machine only. Nothing is sent to any external server.

**Privacy**

This add-on does not collect, store, or transmit your data to any external party. All WebSocket communication is exclusively to localhost. No analytics, no tracking, no remote connections. Full privacy policy: https://drbenedictporkins.github.io/tethernet/privacy.html

**Consent**

On first install, a full onboarding page explains every capability and its risks including prompt injection. The add-on is completely inactive until the user explicitly consents. Consent can be revoked from the popup at any time.

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
