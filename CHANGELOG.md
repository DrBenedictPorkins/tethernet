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

- **Commands were refused with "not enabled" after the worker went idle.** `consentGranted`
  initialises to `false` and was only set inside an async storage read. MV3 terminates the
  service worker after ~30s idle, so a command that woke it could reach the consent gate
  before that read resolved and be refused — telling the user to grant consent they had
  already granted, which is an instruction that cannot change the outcome. The gate now
  awaits the stored value. It still never defaults to granted: the read resolves to the
  stored flag and a failed read leaves it `false`. The duplicate read in the init block was
  removed so a revoke landing between the two reads cannot be clobbered by a stale snapshot.

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
- **Note reminders.** Site notes only get written when someone remembers to write them,
  and an instruction to remember is not a mechanism. Three detectors fire on facts the
  extension can observe directly, queue a short line, and ride it out on the next response
  the MCP layer passes through untouched — no extra round trip:
  - an interaction failed on a selector and a later one succeeded on the same selector,
    which is the workaround worth recording and can only be learned by failing first;
  - a navigation to a domain with no `site:<domain>` key, once per domain;
  - a capture that yielded five or more distinct non-asset endpoints with nothing recorded
    since it started.

  Hints are earned, never periodic. One that fires when nothing happened teaches the reader
  to skip hints, which costs more than it saves.

  This is a single yes/no, chosen during onboarding, because it means feeding observations
  to an AI session and that is the user's call to make once — not a prompt that interrupts
  them later. There is no per-event asking: an earlier cut queued hints behind a toolbar
  badge, which nobody watching a terminal would ever notice. An install that predates the
  question stays off until switched on in the popup, beside Passive Mode.

### Internal
- `scripts/audit-tool-surface.mjs` cross-references tool schemas, MCP handlers and both
  extensions in each direction: declared-but-never-read parameters, forwarding gaps, action
  orphans, Chrome/Firefox divergence, MV2-era APIs and undeclared permissions.
