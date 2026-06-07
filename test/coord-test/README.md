# coord-test.html — native_click Coordinate Test Page

A visual test harness for verifying `native_click` coordinate accuracy. Use this whenever:
- The MCP server is changed (cap value, calibration logic, coordinate formula)
- Chrome is updated
- The browser window is moved to a different monitor
- You suspect clicks are landing off-target

## Setup

1. Open `coord-test.html` in Chrome (`File → Open File`, or drag into Chrome)
2. Start the Claude Code session (MCP server spawns via stdio)
3. Connect the tethernet extension popup to the port shown by `get_connection_info`
4. Set the tab as primary: `set_primary_tab({ tabId: <id> })`

## What it tests

The page is a **2800×2200px canvas** — larger than any typical viewport in both dimensions.  
It contains 23 labeled buttons (A–W) at random sizes and positions:

- **A–R** — spread across the main canvas, requiring vertical scroll for lower buttons
- **S, T, U, V, W** — placed at x > 1974px, requiring **horizontal scroll** to reach

Each button click logs to the fixed panel on the right:
- `getBoundingClientRect()` after scroll
- Viewport center (CSS px)
- Current scroll offset
- `screenXY` + `effCh` used for the OS click
- Computed OS target coordinates

A yellow crosshair appears at the click center so you can visually confirm accuracy.

## Test sequence

### 1. Calibration probe (first click each session)
The first `native_click` auto-probes chrome height — no manual step needed. Watch `_debug.effectiveChromeH` in the result to confirm the measured value is reasonable (~85–130px depending on toolbar config).

### 2. Basic accuracy
```
native_click({ selector: '#btn-C' })   // top area, no scroll
native_click({ selector: '#btn-G' })   // no scroll
```

### 3. Vertical scroll
```
native_click({ selector: '#btn-O' })   // y=720, needs scroll
native_click({ selector: '#btn-R' })   // y=660, needs scroll
native_click({ selector: '#btn-K' })   // y=520, needs scroll
```

### 4. Horizontal scroll
```
native_click({ selector: '#btn-S' })   // x=2050, needs horizontal scroll
native_click({ selector: '#btn-U' })   // x=2500, needs ~700px horizontal scroll
```

### 5. Both axes
```
native_click({ selector: '#btn-W' })   // x=2350, y=600 — both axes
native_click({ selector: '#btn-V' })   // x=2050, y=500 — both axes
```

### 6. Auto-recalibration test
1. Run a click → confirm hit
2. Toggle bookmarks bar (`Cmd+Shift+B`) — hides/shows ~34px of chrome
3. Run another click — server detects `rawChromeH` drift >20px, re-probes automatically
4. Confirm hit with new calibration

## How calibration works

On the first `native_click` per session (or after a toolbar change):

1. A transparent full-page overlay is injected at `z-index: MAX`
2. A probe `cliclick` fires at `screenY + 250` (conservative offset, always lands in viewport)
3. The document capture listener records `clientY` where the click landed
4. `actual_chrome_h = 250 - clientY`
5. Result cached as `calibratedChromeH` for the rest of the session

Auto-invalidation: if `|rawChromeH - calibratedRawChromeH| > 20`, the cache is cleared and re-probe runs on the next click. This handles bookmarks bar, extensions bar, and zoom-level changes without any user action.

## Pass criteria

Every button in the log panel should show a `dom click` entry. The yellow crosshair should appear at or very near the button center. Misses appear as crosshair outside the button bounds.
