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
  badge, which nobody watching a terminal would ever notice. It defaults on, matching the
  checked box on the onboarding page — an absent key reading as off would have the UI claim
  something the worker does not do. Only an explicit off disables it, from the toggle beside
  Passive Mode.

- **`maxEntries` counted page furniture.** The threshold counted every entry, so a small
  capture filled with stylesheets, fonts and scripts before any API call arrived — 25 entries
  on the Best Buy homepage came back as 25 assets and one document, with nothing to audit.
  Only non-asset entries count now, classified by the CDP resource type rather than by
  sniffing the URL. Assets are still captured, since they are real traffic; they just do not
  spend the budget, and a 500-entry hard cap stops an asset-heavy page growing the buffer
  without bound. The same 25-entry capture now returns 163 entries — 25 counted, 138 assets —
  with the GraphQL traffic in it. `countedTowardMax` and `staticAssets` are exposed in the
  capture metadata.

- **Notes only arrived when the session drove the tab.** Delivery hung off the extension's
  `navigate` action, so a user already sitting on the site — the more common way work starts
  — got nothing, and neither did a page they reloaded themselves. Any command naming a tab
  now checks that tab's domain, with an in-memory set so a domain already handled this worker
  life costs nothing and `chrome.storage.session` stays the authority on what was delivered.

- **Site notes are delivered, not just counted.** Detector 2 previously said only whether a
  domain had notes — the caller still had to remember to fetch them, which is the same
  forgetting problem the detectors exist to solve. On the first navigation to a domain the
  whole record now rides out with the next carrier response. Someone working a site tends to
  stay on it, so once per domain is cheap; records over 8KB send their key list and a pointer
  to `browser_storage_get` instead of inlining.

  Delivery is deduped in `chrome.storage.session` rather than memory. MV3 terminates the
  worker after ~30s idle, so an in-memory set meant the full payload — roughly 3.4KB for a
  two-record site — was re-sent after every idle gap. Session storage gives it the intended
  lifetime: once per browser session. Writing notes for a domain also marks it delivered,
  since the writer already holds what it just wrote.

- **Site notes report and per-site counts.** The popup shows how much is recorded for the
  current tab's domain, and View Notes opens a full report of everything under `site:*`,
  grouped by domain, with each fact's `verifiedAt` date and age. Facts past 90 days are
  flagged rather than hidden — stale is not the same as wrong, and deleting on a TTL throws
  away a prior that is usually still right. Records written in an older freeform shape render
  as raw JSON instead of being skipped, so the report cannot understate coverage.

- **Popup showed CONNECTING while commands were executing.** The socket lives in the
  offscreen document, which outlives the service worker. MV3 kills the worker after ~30s
  idle; on restart it reset its state to `connecting` and asked offscreen to connect again,
  but `connect()` returned silently when the socket was already open on that URL. The worker
  never learned it was connected, and `session_info` is only sent once at handshake, so the
  popup also showed no session — while commands kept flowing, because they are forwarded
  independently of that state. Offscreen now re-announces `ws_open` and replays the cached
  `session_info` when a restarted worker asks again.

- **Site notes were attached and then discarded.** Delivery was gated on an allowlist of
  extension actions, but whether the payload survives depends on the MCP *tool*, not the
  action: `get_page_text`, `dom_stats`, `get_dom_structure`, `get_element` and the `wait_for_*`
  family all ride `execute_script` and all reshape its result, dropping anything on the
  wrapper. A fresh session with two records stored for the domain received nothing. The MCP
  server now strips the sideband off every extension result and appends it to whatever the
  tool returns, so the allowlist is gone and any action can carry.

- **Notes delivery is scoped to the MCP session, not the browser.** The dedupe set lived in
  `chrome.storage.session` keyed to nothing in particular, so a second session connecting to
  the same browser — which has never seen those notes — received none. It is now cleared when
  the server reports a new session PID. Not on `ws_open`, which also fires for reconnects
  after a dropped socket or a worker restart, where the session still holds what it was sent;
  and the PID is persisted, since the worker dying would otherwise make every session look new.

### Internal
- `scripts/audit-tool-surface.mjs` cross-references tool schemas, MCP handlers and both
  extensions in each direction: declared-but-never-read parameters, forwarding gaps, action
  orphans, Chrome/Firefox divergence, MV2-era APIs and undeclared permissions.
