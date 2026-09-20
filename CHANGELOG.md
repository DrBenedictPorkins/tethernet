# Changelog

## [Unreleased]

### Fixed
- **Response bodies were attributed to the wrong requests.** Capture built entries from
  `chrome.webRequest` but collected bodies over CDP, and the two assign different ids to
  the same request — so the only field they shared was the URL, which is not unique. Bodies
  were stored in a `url → body` map and merged on URL at stop, so every request to a
  repeated endpoint received whichever body landed last. Measured on a Best Buy capture:
  23 POSTs to `/gateway/graphql` all carried one body, 22 of them wrong; 28 of 300 entries
  (9%) sat on a duplicated URL. Any GraphQL gateway, polling endpoint or repeated analytics
  beacon hit this, silently, and `bodiesCaptured` counts were inflated to match.

  `capture_network` and `start_network_capture` are now CDP-only. Entries are built from
  `Network.requestWillBeSent` → `responseReceived` → `loadingFinished`/`loadingFailed`, and
  the body is fetched with the same `requestId` that identified the request, so a repeated
  URL no longer collides. Verified on the same site: 39 POSTs to one URL returned 39
  distinct bodies with no nulls, across 14 GraphQL operations. A body evicted from the CDP
  buffer now stays `null` — an empty body is a fact, a neighbour's body is a lie.

  Passive mode deliberately stays on `webRequest`: it is always-on and browser-wide, it
  records no bodies, and it never joined two id spaces, so it never had this bug. Moving it
  would mean holding the debugger attached to every tab permanently.

- **Failures were reported as successes.** Handlers that returned `{error}` as a resolved
  value put the message in the envelope's `result` slot, so the MCP layer rendered a failed
  call as a success. Now thrown: `list_frames`, `startCapture`, `capture_network`,
  `find_in_capture`, `run_lighthouse`, `handle_dialog`, `upload_file`, `execute_script`,
  `fetch_with_session`. `handle_dialog` and `upload_file` also throw on the injected
  function's own `{error}`, so a bad selector no longer reads as a completed upload.
  `startCapture` now requires a `tabId` and throws when the debugger cannot attach, rather
  than silently degrading to metadata-only.

- **`frameId` could never reach a subframe.** `all_frames` was `false`, so `content.js` ran
  only in the top frame while `frameId` was declared and forwarded on ten content-script
  tools. Enabled `all_frames`; `autorun` is now guarded to the top frame so site scripts
  still run once per page rather than once per iframe.

### Added
- **`take_screenshot({ fullPage: true })` now captures the full page.** The parameter was
  declared in the schema, forwarded, and never read — `captureVisibleTab` is viewport-only,
  so `fullPage` silently returned a viewport shot. Added scroll-and-stitch: `position:fixed`
  and `sticky` elements are hidden after the first slice so a sticky header does not repeat
  down the image, scroll position and visibility are restored in a `finally`, slices are
  spaced to stay inside Chrome's capture quota with one backoff retry, and pages beyond the
  `OffscreenCanvas` limit report `truncated` instead of silently losing the tail.

### Internal
- `scripts/audit-tool-surface.mjs` cross-references tool schemas, MCP handlers and both
  extensions in each direction: declared-but-never-read parameters, forwarding gaps, action
  orphans, Chrome/Firefox divergence, MV2-era APIs and undeclared permissions.
