/**
 * Tethernet Service Worker
 * Thin router: delegates WebSocket to the offscreen document,
 * handles all extension commands directly.
 */

let SERVER_URL = null;
let connectionState = 'disconnected';
let connectedAt = null;
let sessionInfo = null;
let consentGranted = false;

const contentScriptTabs = new Set();

// --- Offscreen document management ---

async function hasOffscreenDocument() {
  const clients = await self.clients.matchAll();
  return clients.some(c => c.url.includes('offscreen/offscreen.html'));
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen/offscreen.html');

  // Check via runtime.getContexts (available Chrome 116+)
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    });
    if (contexts.length > 0) return;
  } catch (e) {
    // getContexts not available — fall through to createDocument
  }

  try {
    await chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'Maintain persistent WebSocket connection to MCP server',
    });
  } catch (e) {
    if (!e.message?.includes('Only a single offscreen')) throw e;
  }
}

// --- Connection management ---

async function connect() {
  if (!SERVER_URL) return;

  connectionState = 'connecting';
  updateIcon();

  // createDocument resolves after the document is loaded and scripts have run,
  // so the ws_connect message will always find a ready listener.
  await ensureOffscreenDocument();
  chrome.runtime.sendMessage({ type: 'ws_connect', serverUrl: SERVER_URL }).catch(() => {});
}

function sendToServer(data) {
  chrome.runtime.sendMessage({ type: 'ws_send', data }).catch(() => {});
}

// --- Icon management (uses OffscreenCanvas — works in service workers) ---

const ICON_SIZES = [16, 32, 48, 96];
let recordingIconCache = null;

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function generateRecordingIconImageData(size) {
  const iconUrl = chrome.runtime.getURL(`icons/icon-connected-${size}.png`);
  const response = await fetch(iconUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, size, size);

  const dotRadius = Math.max(3, size * 0.28);
  const dotX = size - dotRadius - Math.max(1, size * 0.05);
  const dotY = dotRadius + Math.max(1, size * 0.05);

  ctx.beginPath();
  ctx.arc(dotX, dotY, dotRadius + Math.max(1, size * 0.05), 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#dc3545';
  ctx.fill();

  return ctx.getImageData(0, 0, size, size);
}

async function buildRecordingIconCache() {
  try {
    const entries = await Promise.all(
      ICON_SIZES.map(async (size) => [size, await generateRecordingIconImageData(size)])
    );
    recordingIconCache = Object.fromEntries(entries);
  } catch (e) {
    console.error('[Tethernet] Failed to generate recording icons:', e);
    recordingIconCache = null;
  }
}

function setBaseIcon() {
  const iconPath = connectionState === 'connected'
    ? 'icons/icon-connected-'
    : 'icons/icon-';

  chrome.action.setIcon({
    path: {
      16: iconPath + '16.png',
      32: iconPath + '32.png',
      48: iconPath + '48.png',
      96: iconPath + '96.png'
    }
  }).catch(() => {});
}

function updateIcon() {
  if (networkCapture.active && recordingIconCache) {
    chrome.action.setIcon({ imageData: recordingIconCache }).catch(() => {});
  } else {
    setBaseIcon();
  }

  chrome.runtime.sendMessage({
    type: 'state_changed',
    connectionState,
    connectedAt,
    sessionInfo
  }).catch(() => {});
}

function updateRecordingIndicator() {
  if (networkCapture.active) {
    chrome.action.setBadgeText({ text: 'REC' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#dc3545' }).catch(() => {});
    if (recordingIconCache) {
      chrome.action.setIcon({ imageData: recordingIconCache }).catch(() => {});
    }
  } else {
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
    setBaseIcon();
  }
}

function updateTabBadge(tabId) {
  if (contentScriptTabs.has(tabId)) {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  } else {
    chrome.action.setBadgeText({ text: '!', tabId }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#ffc107', tabId }).catch(() => {});
  }
}

async function checkContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' }, { frameId: 0 });
    if (response && response.pong) {
      contentScriptTabs.add(tabId);
      updateTabBadge(tabId);
      return true;
    }
  } catch (e) {
    contentScriptTabs.delete(tabId);
    updateTabBadge(tabId);
  }
  return false;
}

async function sendTabList() {
  try {
    const tabs = await chrome.tabs.query({});
    const tabList = tabs.map(tab => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      active: tab.active,
      windowId: tab.windowId
    }));
    sendToServer({ type: 'tab_list', data: { tabs: tabList } });
  } catch (error) {
    console.error('[Tethernet] Failed to get tab list:', error);
  }
}

// --- Command handlers ---

async function handleServerCommand(action, params) {
  switch (action) {
    case 'list_tabs':
      return handleListTabs();

    case 'create_tab':
      return handleCreateTab(params);

    case 'close_tab':
      return handleCloseTab(params);

    case 'focus_tab':
      return handleFocusTab(params);

    case 'navigate':
      return handleNavigate(params);

    case 'reload_tab':
      return handleReloadTab(params);

    case 'go_back':
      return handleGoBack(params);

    case 'go_forward':
      return handleGoForward(params);

    case 'list_frames':
      return handleListFrames(params);

    case 'take_screenshot':
      return handleTakeScreenshot(params);

    case 'get_cookies':
      return handleGetCookies(params);

    case 'set_cookie':
      return handleSetCookie(params);

    case 'execute_script':
      return handleExecuteScriptViaAPI(params);

    case 'get_outer_html': {
      const target = { tabId: params.tabId };
      if (params.frameId) target.frameIds = [params.frameId];
      const results = await chrome.scripting.executeScript({
        target,
        func: () => document.documentElement.outerHTML,
        world: 'ISOLATED',
      });
      return { result: results?.[0]?.result ?? null };
    }

    case 'capture_network':
      return handleCaptureNetwork(params);

    case 'start_network_capture':
      return startCapture(params);

    case 'stop_network_capture':
      return stopCapture('manual');

    case 'get_capture':
      return { capture: getCurrentCapture(params || {}) };

    case 'find_in_capture':
      return findInCapture(params || {});

    case 'clear_capture':
      return clearCapture();

    case 'get_passive_log': {
      const { limit, type: typeFilter } = params || {};
      let entries = passiveLog;
      if (typeFilter === 'net') entries = entries.filter(e => !e.kind);
      else if (typeFilter === 'interaction') entries = entries.filter(e => e.kind === 'interaction');
      if (limit) entries = entries.slice(-limit);
      return { enabled: passiveMode, count: passiveLog.length, entries };
    }

    case 'clear_passive_log':
      passiveLog = [];
      passivePending.clear();
      chrome.runtime.sendMessage({ type: 'passive_count_changed', count: 0 }).catch(() => {});
      return { cleared: true };

    case 'summarize_passive_log':
      return buildPassiveSummary();

    case 'find_beacons': {
      const BEACON_VENDORS = [
        { vendor: 'Video Analytics', pattern: '/va/api/' },
        { vendor: 'Streaming Beacon', pattern: '/streamer/' },
        { vendor: 'Conviva', pattern: 'cws.conviva.com' },
        { vendor: 'Nielsen DCR', pattern: 'imrworldwide.com' },
        { vendor: 'Comscore', pattern: 'scorecardresearch.com' },
        { vendor: 'New Relic', pattern: 'nr-data.net' },
        { vendor: 'Google Analytics', pattern: 'google-analytics.com' },
        { vendor: 'Google Analytics 4', pattern: 'analytics.google.com' },
        { vendor: 'Segment', pattern: 'segment.io' },
        { vendor: 'Segment', pattern: 'segment.com' },
        { vendor: 'Amplitude', pattern: 'amplitude.com' },
        { vendor: 'Mixpanel', pattern: 'mixpanel.com' },
        { vendor: 'Heap', pattern: 'heapanalytics.com' },
        { vendor: 'FullStory', pattern: 'fullstory.com' },
        { vendor: 'Hotjar', pattern: 'hotjar.com' },
        { vendor: 'Google Ads', pattern: 'doubleclick.net' },
        { vendor: 'Google Ads', pattern: 'googlesyndication.com' },
        { vendor: 'Facebook Pixel', pattern: 'facebook.com/tr' },
        { vendor: 'Microsoft UET', pattern: 'bat.bing.com' },
        { vendor: 'LinkedIn', pattern: 'snap.licdn.com' },
        { vendor: 'LinkedIn', pattern: 'linkedin.com/px' },
        { vendor: 'Twitter/X Ads', pattern: 'ads-twitter.com' },
        { vendor: 'Twitter/X Ads', pattern: 'twitter.com/i/adsct' },
        { vendor: 'TikTok Pixel', pattern: 'tiktok.com' },
        { vendor: 'Adobe Analytics', pattern: 'omtrdc.net' },
        { vendor: 'Adobe Analytics', pattern: '2o7.net' },
        { vendor: 'Adobe Launch', pattern: 'adobedtm.com' },
        { vendor: 'Chartbeat', pattern: 'chartbeat.com' },
        { vendor: 'Quantcast', pattern: 'quantserve.com' },
        { vendor: 'Taboola', pattern: 'taboola.com' },
        { vendor: 'Outbrain', pattern: 'outbrain.com' },
        { vendor: 'Criteo', pattern: 'criteo.com' },
        { vendor: 'Sentry', pattern: 'sentry.io' },
        { vendor: 'Datadog', pattern: 'datadoghq.com' },
        { vendor: 'FreeWheel', pattern: 'fwmrm.net' },
        { vendor: 'FreeWheel', pattern: 'freewheel.tv' },
        { vendor: 'SpotX', pattern: 'spotx.tv' },
      ];
      const netEvents = passiveLog.filter(e => !e.kind);
      const vendorMap = {};
      for (const e of netEvents) {
        for (const { vendor, pattern } of BEACON_VENDORS) {
          if (e.url && e.url.includes(pattern)) {
            const key = vendor;
            if (!vendorMap[key]) vendorMap[key] = { vendor, count: 0, urls: [], lastTs: 0 };
            vendorMap[key].count++;
            vendorMap[key].lastTs = Math.max(vendorMap[key].lastTs, e.t || 0);
            if (!vendorMap[key].urls.includes(e.url)) vendorMap[key].urls.push(e.url);
            break;
          }
        }
      }
      const beacons = Object.values(vendorMap).sort((a, b) => b.count - a.count);
      return { total: netEvents.length, beaconsFound: beacons.length, beacons };
    }

    case 'click_element':
    case 'type_text':
    case 'press_key':
    case 'scroll':
    case 'scroll_to_element':
    case 'hover_element':
    case 'focus_element':
    case 'select_option':
    case 'set_checkbox':
    case 'get_element_bounds':
    case 'get_ref':
    case 'get_accessibility_tree':
    case 'find_elements':
      return forwardToContentScript(params.tabId, action, params);

    case 'storage_get': {
      const result = await chrome.storage.local.get(params.key);
      return { key: params.key, value: result[params.key] ?? null };
    }

    case 'storage_set':
      await chrome.storage.local.set({ [params.key]: params.value });
      return { key: params.key, saved: true };

    case 'storage_list': {
      const all = await chrome.storage.local.get(null);
      const prefix = params.prefix || '';
      const keys = Object.keys(all).filter(k => k.startsWith(prefix));
      if (params.valuesIncluded) return { items: Object.fromEntries(keys.map(k => [k, all[k]])) };
      return { keys };
    }

    case 'storage_delete':
      await chrome.storage.local.remove(params.key);
      return { key: params.key, deleted: true };

    case 'get_window_bounds':
      return handleGetWindowBounds(params);

    case 'wait_for_download':
      return handleWaitForDownload(params);

    case 'fetch_with_session':
      return handleFetchWithSession(params);

    case 'handle_dialog':
      return handleDialog(params);

    case 'upload_file':
      return handleUploadFile(params);

    case 'run_lighthouse':
      return handleRunLighthouse(params);

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

async function handleListTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(tab => checkContentScript(tab.id)));
  return tabs.map(tab => ({
    id: tab.id,
    url: tab.url,
    title: tab.title,
    active: tab.active,
    windowId: tab.windowId,
    status: tab.status,
    contentScriptReady: contentScriptTabs.has(tab.id)
  }));
}

async function handleCreateTab(params) {
  const { url, active } = params;
  const tab = await chrome.tabs.create({ url, active });
  return { tabId: tab.id };
}

async function handleCloseTab(params) {
  const { tabId } = params;
  await chrome.tabs.remove(tabId);
  return { success: true };
}

async function handleFocusTab(params) {
  const { tabId } = params;
  await chrome.tabs.update(tabId, { active: true });
  const tab = await chrome.tabs.get(tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
  return { success: true };
}

async function handleNavigate(params) {
  const { tabId, url } = params;
  await chrome.tabs.update(tabId, { url });
  return { success: true };
}

async function handleReloadTab(params) {
  const { tabId, bypassCache } = params;
  await chrome.tabs.reload(tabId, { bypassCache: bypassCache || false });
  return { success: true };
}

async function handleGoBack(params) {
  const { tabId } = params;
  await chrome.tabs.goBack(tabId);
  return { success: true };
}

async function handleGoForward(params) {
  const { tabId } = params;
  await chrome.tabs.goForward(tabId);
  return { success: true };
}

async function handleGetWindowBounds(params) {
  const { tabId } = params;
  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);
  // win.left/top/width/height = outer window in logical CSS px (screen coords)
  // tab.width/height = content area (innerWidth/innerHeight equivalent)
  // chromeHeight = tab bar + address bar only — exact, no estimation needed
  const chromeHeight = win.height - (tab.height || 0);
  const chromeWidth  = win.width  - (tab.width  || 0);
  return {
    windowLeft:   win.left,
    windowTop:    win.top,
    windowWidth:  win.width,
    windowHeight: win.height,
    tabWidth:     tab.width,
    tabHeight:    tab.height,
    chromeHeight,
    chromeWidth,
  };
}

async function handleListFrames(params) {
  const { tabId } = params;
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    return {
      frames: frames.map(frame => ({
        frameId: frame.frameId,
        parentFrameId: frame.parentFrameId,
        url: frame.url,
        isTopFrame: frame.frameId === 0,
        errorOccurred: frame.errorOccurred || false
      }))
    };
  } catch (error) {
    return { error: error.message, frames: [] };
  }
}

async function cropDataUrl(dataUrl, cssRect, dpr, format, quality, scale) {
  const blob = await fetch(dataUrl).then(r => r.blob());
  const img = await createImageBitmap(blob);

  const x = Math.max(0, Math.round(cssRect.x * dpr));
  const y = Math.max(0, Math.round(cssRect.y * dpr));
  const w = Math.min(Math.round(cssRect.width * dpr), img.width - x);
  const h = Math.min(Math.round(cssRect.height * dpr), img.height - y);
  const outW = scale ? Math.round(w * scale) : w;
  const outH = scale ? Math.round(h * scale) : h;

  const canvas = new OffscreenCanvas(outW, outH);
  canvas.getContext('2d').drawImage(img, x, y, w, h, 0, 0, outW, outH);

  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const qualityArg = format === 'jpeg' ? quality / 100 : undefined;
  const outputBlob = await canvas.convertToBlob({ type: mimeType, quality: qualityArg });
  const buffer = await outputBlob.arrayBuffer();
  return `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`;
}

async function scaleDataUrl(dataUrl, scale, format, quality) {
  const blob = await fetch(dataUrl).then(r => r.blob());
  const img = await createImageBitmap(blob);
  const outW = Math.round(img.width * scale);
  const outH = Math.round(img.height * scale);

  const canvas = new OffscreenCanvas(outW, outH);
  canvas.getContext('2d').drawImage(img, 0, 0, outW, outH);

  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const qualityArg = format === 'jpeg' ? quality / 100 : undefined;
  const outputBlob = await canvas.convertToBlob({ type: mimeType, quality: qualityArg });
  const buffer = await outputBlob.arrayBuffer();
  return `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`;
}

async function handleTakeScreenshot(params) {
  const { tabId, format, quality, cropTo, selector, scale } = params;
  const captureFormat = format || 'jpeg';
  const captureQuality = quality || 80;
  const options = { format: captureFormat };
  if (captureFormat === 'jpeg') options.quality = captureQuality;

  const tab = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, options);

  if (cropTo || selector) {
    let rect = cropTo;

    if (selector) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, width: r.width, height: r.height };
        },
        args: [selector],
        world: 'ISOLATED'
      });
      rect = results?.[0]?.result;
    }

    if (rect && rect.width > 0 && rect.height > 0) {
      const dprResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.devicePixelRatio || 1,
        world: 'ISOLATED'
      });
      const dpr = dprResults?.[0]?.result || 1;
      return { dataUrl: await cropDataUrl(dataUrl, rect, dpr, captureFormat, captureQuality, scale) };
    }
  }

  if (scale && scale < 1) {
    return { dataUrl: await scaleDataUrl(dataUrl, scale, captureFormat, captureQuality) };
  }

  return { dataUrl };
}

async function handleGetCookies(params) {
  const { url } = params;
  // Note: Chrome does not expose HttpOnly cookies — platform limitation
  const cookies = await chrome.cookies.getAll({ url });
  return { cookies };
}

async function handleSetCookie(params) {
  const { cookie } = params;
  await chrome.cookies.set(cookie);
  return { success: true };
}

// Execute developer-provided code strings via chrome.scripting.executeScript in MAIN world.
// Code originates exclusively from the user's own local Claude Code session (localhost only).
// Known limitation: eval() at runtime is subject to the page's CSP — strict sites (unsafe-eval
// blocked) will return an error. This is consistent with DevTools console behavior on those sites.
async function handleExecuteScriptViaAPI(params) {
  const { tabId, script, frameId, preview, force } = params;
  const PAYLOAD_LIMIT = 50000;

  try {
    const target = { tabId };
    if (frameId) target.frameIds = [frameId];

    const results = await chrome.scripting.executeScript({
      target,
      func: (code) => {
        try { return eval(code); }
        catch (e) { return { __tethernet_error: e.message }; }
      },
      args: [script],
      world: 'MAIN'
    });

    const rawResult = results?.[0]?.result;
    if (rawResult && typeof rawResult === 'object' && '__tethernet_error' in rawResult) {
      return { error: rawResult.__tethernet_error };
    }

    let serialized;
    try {
      serialized = JSON.stringify(rawResult);
    } catch (e) {
      serialized = String(rawResult);
    }

    const payloadSize = serialized.length;

    if (payloadSize > PAYLOAD_LIMIT && !preview && !force) {
      return {
        error: 'payload_too_large',
        size: payloadSize,
        sizeFormatted: (payloadSize / 1024).toFixed(1) + 'KB',
        limit: PAYLOAD_LIMIT,
        limitFormatted: (PAYLOAD_LIMIT / 1024).toFixed(0) + 'KB',
        message: `Result exceeds ${(PAYLOAD_LIMIT / 1024).toFixed(0)}KB (actual: ${(payloadSize / 1024).toFixed(1)}KB). Options: 1) Rewrite JS to filter/limit results, 2) Use preview:true for first ${(PAYLOAD_LIMIT / 1024).toFixed(0)}KB sample, 3) Use force:true to get full payload.`
      };
    }

    if (preview && payloadSize > PAYLOAD_LIMIT) {
      return {
        preview: true,
        sample: serialized.slice(0, PAYLOAD_LIMIT),
        truncatedAt: PAYLOAD_LIMIT,
        totalSize: payloadSize,
        totalSizeFormatted: (payloadSize / 1024).toFixed(1) + 'KB',
        message: `Showing first ${(PAYLOAD_LIMIT / 1024).toFixed(0)}KB of ${(payloadSize / 1024).toFixed(1)}KB. Use force:true for full payload or rewrite JS for targeted extraction.`
      };
    }

    return { result: rawResult };
  } catch (error) {
    return { error: error.message };
  }
}

// --- Network Capture ---
// webRequest handles headers/timing/request-bodies (always-on listeners).
// chrome.debugger handles response bodies (attached only during active capture).

const DL_SESSION_KEY = '__tethernet_dl_tracker__';
const DL_SESSION_TTL = 30000;

const HARD_CEILING_MS = 5 * 60 * 1000;
const HEADER_VALUE_LIMIT = 1024;
const MAX_ENTRIES_HARD_CAP = 500;
const DEFAULT_MAX_ENTRIES = 100;

const networkCapture = {
  active: false,
  startedAt: null,
  endedAt: null,
  endReason: null,
  tabId: null,
  urlFilter: '',
  methodFilter: '',
  maxEntries: DEFAULT_MAX_ENTRIES,
  maxBodySize: 4000,
  entries: [],
  pendingRequests: new Map(),
  ceilingTimer: null,
  debuggerAttached: false,
};

// --- Passive mode ---
const PASSIVE_MAX = 500;
let passiveMode = false;
let passiveLog = [];
const passivePending = new Map();

function passiveBeforeRequest(details) {
  if (details.tabId < 0) return;
  passivePending.set(details.requestId, {
    url: details.url,
    method: details.method,
    tabId: details.tabId,
    t: details.timeStamp,
  });
}

function passiveOnCompleted(details) {
  const p = passivePending.get(details.requestId);
  if (!p) return;
  passivePending.delete(details.requestId);
  passiveLog.push({
    t: details.timeStamp,
    method: p.method,
    url: p.url,
    status: details.statusCode,
    type: details.type,
    ms: Math.round(details.timeStamp - p.t),
    tabId: p.tabId,
  });
  if (passiveLog.length > PASSIVE_MAX) passiveLog.shift();
  chrome.runtime.sendMessage({ type: 'passive_count_changed', count: passiveLog.length }).catch(() => {});
}

function passiveOnError(details) {
  passivePending.delete(details.requestId);
}

function buildPassiveSummary() {
  if (!passiveLog.length) return { enabled: passiveMode, count: 0, summary: null };
  const netEvents = passiveLog.filter(e => !e.kind);
  const interactions = passiveLog.filter(e => e.kind === 'interaction');
  const times = passiveLog.map(e => e.t);
  const fromMs = Math.min(...times);
  const toMs = Math.max(...times);
  const domainMap = {};
  for (const e of netEvents) {
    let domain;
    try { domain = new URL(e.url).hostname; } catch (_) { domain = 'unknown'; }
    if (!domainMap[domain]) domainMap[domain] = { domain, count: 0, totalMs: 0, methods: {}, statuses: {}, slowest: null };
    const d = domainMap[domain];
    d.count++;
    d.totalMs += e.ms || 0;
    d.methods[e.method] = (d.methods[e.method] || 0) + 1;
    d.statuses[e.status] = (d.statuses[e.status] || 0) + 1;
    if (!d.slowest || e.ms > d.slowest.ms) d.slowest = { url: e.url, ms: e.ms };
  }
  const domains = Object.values(domainMap)
    .map(d => ({ ...d, avgMs: Math.round(d.totalMs / d.count) }))
    .sort((a, b) => b.count - a.count);
  const slowest = [...netEvents].filter(e => e.ms > 0).sort((a, b) => b.ms - a.ms).slice(0, 10)
    .map(e => ({ url: e.url, ms: e.ms, method: e.method, status: e.status }));
  const statusCodes = {};
  for (const e of netEvents) statusCodes[e.status] = (statusCodes[e.status] || 0) + 1;
  const errors = netEvents.filter(e => e.status >= 400)
    .map(e => ({ url: e.url, status: e.status, method: e.method, ms: e.ms }));
  return { enabled: passiveMode, count: passiveLog.length, netCount: netEvents.length,
    interactionCount: interactions.length,
    timespan: { fromMs, toMs, durationSec: Math.round((toMs - fromMs) / 1000) },
    domains, slowest, statusCodes, errors, interactions };
}

function setPassiveMode(enabled) {
  passiveMode = enabled;
  chrome.storage.local.set({ tethernetPassiveMode: enabled });
  if (enabled) {
    chrome.webRequest.onBeforeRequest.addListener(passiveBeforeRequest, { urls: ['<all_urls>'] });
    chrome.webRequest.onCompleted.addListener(passiveOnCompleted, { urls: ['<all_urls>'] }, ['responseHeaders']);
    chrome.webRequest.onErrorOccurred.addListener(passiveOnError, { urls: ['<all_urls>'] });
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'passive_enable' }).catch(() => {});
      });
    });
  } else {
    try { chrome.webRequest.onBeforeRequest.removeListener(passiveBeforeRequest); } catch (_) {}
    try { chrome.webRequest.onCompleted.removeListener(passiveOnCompleted); } catch (_) {}
    try { chrome.webRequest.onErrorOccurred.removeListener(passiveOnError); } catch (_) {}
    passivePending.clear();
    passiveLog = [];
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'passive_disable' }).catch(() => {});
      });
    });
    chrome.runtime.sendMessage({ type: 'passive_count_changed', count: 0 }).catch(() => {});
  }
}

// CDP request tracking: CDP requestId → { url }
const debuggerState = {
  requestUrls: new Map(),
  bodies: new Map(), // url → body string
};

function truncateHeaderList(headers) {
  if (!Array.isArray(headers)) return headers;
  return headers.map(h => {
    if (h && typeof h.value === 'string' && h.value.length > HEADER_VALUE_LIMIT) {
      return { ...h, value: h.value.slice(0, HEADER_VALUE_LIMIT) + '...[truncated]' };
    }
    return h;
  });
}

function broadcastCaptureState() {
  chrome.runtime.sendMessage({
    type: 'capture_state_changed',
    state: getCaptureState(),
  }).catch(() => {});
}

function getCaptureState() {
  return {
    active: networkCapture.active,
    startedAt: networkCapture.startedAt,
    endedAt: networkCapture.endedAt,
    endReason: networkCapture.endReason,
    tabId: networkCapture.tabId,
    urlFilter: networkCapture.urlFilter,
    methodFilter: networkCapture.methodFilter,
    maxEntries: networkCapture.maxEntries,
    count: networkCapture.entries.length,
    debuggerUsed: networkCapture.debuggerAttached || networkCapture.debuggerWasUsed || false,
  };
}

function truncateBody(s) {
  if (!s) return null;
  return s.length > networkCapture.maxBodySize
    ? s.slice(0, networkCapture.maxBodySize) + '...[truncated]'
    : s;
}

function matchesCaptureFilters(url, method, tabId) {
  if (!networkCapture.active) return false;
  if (networkCapture.tabId && tabId !== networkCapture.tabId) return false;
  if (networkCapture.urlFilter && !url.includes(networkCapture.urlFilter)) return false;
  if (networkCapture.methodFilter && method.toUpperCase() !== networkCapture.methodFilter.toUpperCase()) return false;
  return true;
}

function serializeBody(requestBody) {
  if (!requestBody) return null;
  try {
    if (requestBody.raw && Array.isArray(requestBody.raw)) {
      const decoder = new TextDecoder('utf-8');
      const parts = requestBody.raw.map(part =>
        part.bytes instanceof ArrayBuffer ? decoder.decode(part.bytes) : ''
      );
      return parts.join('');
    }
    if (requestBody.formData) return JSON.stringify(requestBody.formData);
    return null;
  } catch (e) { return null; }
}

// webRequest listeners — always installed, idle when not capturing
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!matchesCaptureFilters(details.url, details.method || 'GET', details.tabId)) return;

    networkCapture.pendingRequests.set(details.requestId, {
      url: details.url,
      method: details.method,
      tabId: details.tabId,
      type: details.type,
      startTime: details.timeStamp,
      requestBody: truncateBody(serializeBody(details.requestBody)),
      requestHeaders: null,
    });
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    const pending = networkCapture.pendingRequests.get(details.requestId);
    if (!pending) return;
    pending.requestHeaders = truncateHeaderList(details.requestHeaders);
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const pending = networkCapture.pendingRequests.get(details.requestId);
    if (!pending) return;
    networkCapture.pendingRequests.delete(details.requestId);

    networkCapture.entries.push({
      url: pending.url,
      method: pending.method,
      status: details.statusCode,
      type: pending.type,
      duration: Math.round(details.timeStamp - pending.startTime),
      requestHeaders: pending.requestHeaders,
      requestBody: pending.requestBody,
      responseHeaders: truncateHeaderList(details.responseHeaders),
      timestamp: details.timeStamp,
    });
    broadcastCaptureState();
    if (networkCapture.active && networkCapture.entries.length >= networkCapture.maxEntries) {
      stopCapture('threshold');
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    const pending = networkCapture.pendingRequests.get(details.requestId);
    if (!pending) return;
    networkCapture.pendingRequests.delete(details.requestId);
    networkCapture.entries.push({
      url: pending.url,
      method: pending.method,
      error: details.error,
      type: pending.type,
      duration: Math.round(details.timeStamp - pending.startTime),
      requestHeaders: pending.requestHeaders,
      requestBody: pending.requestBody,
      timestamp: details.timeStamp,
    });
    broadcastCaptureState();
    if (networkCapture.active && networkCapture.entries.length >= networkCapture.maxEntries) {
      stopCapture('threshold');
    }
  },
  { urls: ['<all_urls>'] }
);

// chrome.debugger listener for response bodies (no DevTools required)
chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (!networkCapture.debuggerAttached) return;
  if (source.tabId !== networkCapture.tabId) return;

  if (method === 'Network.requestWillBeSent') {
    debuggerState.requestUrls.set(params.requestId, params.request.url);
  }

  if (method === 'Network.loadingFinished') {
    const url = debuggerState.requestUrls.get(params.requestId);
    if (!url) return;
    try {
      const bodyResult = await chrome.debugger.sendCommand(
        { tabId: source.tabId },
        'Network.getResponseBody',
        { requestId: params.requestId }
      );
      if (bodyResult) {
        const body = bodyResult.base64Encoded
          ? atob(bodyResult.body)
          : bodyResult.body;
        debuggerState.bodies.set(url, truncateBody(body));
      }
    } catch (e) { /* body not available for this request */ }
    debuggerState.requestUrls.delete(params.requestId);
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === networkCapture.tabId) {
    networkCapture.debuggerAttached = false;
  }
});

async function startDebuggerCapture(tabId) {
  debuggerState.requestUrls.clear();
  debuggerState.bodies.clear();
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
    return true;
  } catch (e) {
    console.log('[Tethernet] Debugger attach failed (DevTools may be open):', e.message);
    return false;
  }
}

async function stopDebuggerCapture(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
  } catch (e) { /* tab closed or already detached */ }
}

async function startCapture(params = {}) {
  if (networkCapture.active) {
    return { error: 'A network capture is already in progress', state: getCaptureState() };
  }

  const requestedMax = Number(params.maxEntries || DEFAULT_MAX_ENTRIES);
  const maxEntries = Math.max(1, Math.min(requestedMax, MAX_ENTRIES_HARD_CAP));

  networkCapture.active = true;
  networkCapture.startedAt = Date.now();
  networkCapture.endedAt = null;
  networkCapture.endReason = null;
  networkCapture.tabId = params.tabId != null ? Number(params.tabId) : null;
  networkCapture.urlFilter = params.urlFilter || '';
  networkCapture.methodFilter = params.methodFilter || '';
  networkCapture.maxEntries = maxEntries;
  networkCapture.maxBodySize = params.maxBodySize || 4000;
  networkCapture.entries = [];
  networkCapture.pendingRequests.clear();
  networkCapture.debuggerAttached = false;
  networkCapture.debuggerWasUsed = false;

  // Attach debugger for response bodies if a specific tab is being captured
  if (networkCapture.tabId) {
    networkCapture.debuggerAttached = await startDebuggerCapture(networkCapture.tabId);
  }

  if (networkCapture.ceilingTimer) clearTimeout(networkCapture.ceilingTimer);
  networkCapture.ceilingTimer = setTimeout(() => {
    if (networkCapture.active) stopCapture('ceiling');
  }, HARD_CEILING_MS);

  // Keep SW alive during capture via offscreen doc pings every 20s
  chrome.runtime.sendMessage({ type: 'capture_keepalive_start' }).catch(() => {});

  updateRecordingIndicator();
  broadcastCaptureState();

  return { started: true, state: getCaptureState() };
}

async function stopCapture(reason = 'manual') {
  if (!networkCapture.active) {
    return { stopped: false, capture: getCurrentCapture() };
  }

  networkCapture.debuggerWasUsed = networkCapture.debuggerAttached;
  networkCapture.active = false;
  networkCapture.endedAt = Date.now();
  networkCapture.endReason = reason;
  networkCapture.pendingRequests.clear();

  if (networkCapture.ceilingTimer) {
    clearTimeout(networkCapture.ceilingTimer);
    networkCapture.ceilingTimer = null;
  }

  // Detach debugger and merge response bodies
  if (networkCapture.debuggerAttached && networkCapture.tabId) {
    await stopDebuggerCapture(networkCapture.tabId);
    networkCapture.debuggerAttached = false;

    // Merge captured bodies into entries by URL match
    for (const entry of networkCapture.entries) {
      if (!entry.responseBody) {
        const baseUrl = entry.url.split('?')[0];
        const body = debuggerState.bodies.get(entry.url)
          || debuggerState.bodies.get(baseUrl);
        if (body) entry.responseBody = body;
      }
    }
  }

  chrome.runtime.sendMessage({ type: 'capture_keepalive_stop' }).catch(() => {});

  updateRecordingIndicator();
  broadcastCaptureState();

  return { stopped: true, capture: getCurrentCapture() };
}

function captureMetadata() {
  return {
    active: networkCapture.active,
    startedAt: networkCapture.startedAt,
    endedAt: networkCapture.endedAt,
    endReason: networkCapture.endReason,
    tabId: networkCapture.tabId,
    urlFilter: networkCapture.urlFilter,
    methodFilter: networkCapture.methodFilter,
    maxEntries: networkCapture.maxEntries,
    count: networkCapture.entries.length,
    debuggerUsed: networkCapture.debuggerAttached || networkCapture.debuggerWasUsed || false,
  };
}

function slimEntry(entry, index) {
  return {
    index,
    url: entry.url,
    method: entry.method,
    status: entry.status,
    type: entry.type,
    duration: entry.duration,
    timestamp: entry.timestamp,
    error: entry.error,
  };
}

function summarizeCapture() {
  const meta = captureMetadata();
  const statusDistribution = {};
  const methodDistribution = {};
  const hostCounts = {};
  let totalBodyBytes = 0;
  let entriesWithError = 0;
  for (const entry of networkCapture.entries) {
    const status = entry.status != null ? String(entry.status) : (entry.error ? 'error' : 'unknown');
    statusDistribution[status] = (statusDistribution[status] || 0) + 1;
    const method = entry.method || 'UNKNOWN';
    methodDistribution[method] = (methodDistribution[method] || 0) + 1;
    if (entry.error) entriesWithError++;
    try {
      const host = new URL(entry.url).host;
      hostCounts[host] = (hostCounts[host] || 0) + 1;
    } catch (e) { /* skip */ }
    if (entry.responseBody) totalBodyBytes += entry.responseBody.length;
    if (entry.requestBody) totalBodyBytes += entry.requestBody.length;
  }
  const topHosts = Object.entries(hostCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([host, count]) => ({ host, count }));
  return { ...meta, statusDistribution, methodDistribution, topHosts, totalBodyBytes, entriesWithError };
}

function getCurrentCapture(opts = {}) {
  if (networkCapture.startedAt == null) return null;

  if (Array.isArray(opts.entries) && opts.entries.length > 0) {
    const requested = opts.entries
      .map(n => Number(n))
      .filter(n => Number.isInteger(n) && n >= 0 && n < networkCapture.entries.length);
    return {
      ...captureMetadata(),
      entries: requested.map(i => ({ ...networkCapture.entries[i], index: i })),
      requestedIndexes: requested,
    };
  }

  const mode = opts.mode || 'full';
  if (mode === 'summary') return summarizeCapture();
  if (mode === 'slim') {
    return { ...captureMetadata(), entries: networkCapture.entries.map((e, i) => slimEntry(e, i)) };
  }
  return { ...captureMetadata(), entries: networkCapture.entries.map((e, i) => ({ ...e, index: i })) };
}

function findInCapture(opts = {}) {
  if (networkCapture.startedAt == null || networkCapture.entries.length === 0) {
    return { matches: [], totalSearched: 0, matchCount: 0 };
  }

  const query = opts.query;
  if (!query || typeof query !== 'string') return { error: 'query is required (string)' };

  const scope = opts.scope || 'response_body';
  const useRegex = !!opts.regex;
  const maxResults = Math.max(1, Math.min(Number(opts.maxResults) || 20, 100));
  const snippetRadius = 100;

  let matcher;
  if (useRegex) {
    try { matcher = new RegExp(query); }
    catch (e) { return { error: `Invalid regex: ${e.message}` }; }
  }

  function matchAndSnippet(text) {
    if (!text || typeof text !== 'string') return null;
    let idx;
    if (useRegex) {
      const m = text.match(matcher);
      if (!m) return null;
      idx = m.index;
    } else {
      idx = text.indexOf(query);
      if (idx < 0) return null;
    }
    const start = Math.max(0, idx - snippetRadius);
    const end = Math.min(text.length, idx + query.length + snippetRadius);
    let snippet = text.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';
    return { snippet, position: idx };
  }

  function searchEntry(entry) {
    const scopes = scope === 'all'
      ? ['url', 'response_body', 'request_body', 'headers']
      : [scope];
    for (const s of scopes) {
      let result = null;
      if (s === 'url') result = matchAndSnippet(entry.url);
      else if (s === 'response_body') result = matchAndSnippet(entry.responseBody);
      else if (s === 'request_body') result = matchAndSnippet(entry.requestBody);
      else if (s === 'headers') {
        const hdrText = JSON.stringify({
          request: entry.requestHeaders || [],
          response: entry.responseHeaders || [],
        });
        result = matchAndSnippet(hdrText);
      }
      if (result) return { matchedScope: s, ...result };
    }
    return null;
  }

  const matches = [];
  for (let i = 0; i < networkCapture.entries.length; i++) {
    const hit = searchEntry(networkCapture.entries[i]);
    if (hit) {
      const entry = networkCapture.entries[i];
      matches.push({ index: i, url: entry.url, method: entry.method, status: entry.status,
        scope: hit.matchedScope, snippet: hit.snippet, position: hit.position });
      if (matches.length >= maxResults) break;
    }
  }

  return { matches, totalSearched: networkCapture.entries.length, matchCount: matches.length,
    truncated: matches.length >= maxResults, query, scope, regex: useRegex };
}

function clearCapture() {
  if (networkCapture.active) stopCapture('manual');
  networkCapture.startedAt = null;
  networkCapture.endedAt = null;
  networkCapture.endReason = null;
  networkCapture.entries = [];
  broadcastCaptureState();
  return { cleared: true };
}

async function handleCaptureNetwork(params) {
  const { duration = 5000, urlFilter = '', methodFilter = '', tabId, maxBodySize = 4000 } = params;
  const cappedDuration = Math.min(duration, 30000);

  if (networkCapture.active) return { error: 'A network capture is already in progress' };

  await startCapture({ tabId, urlFilter, methodFilter, maxBodySize, maxEntries: MAX_ENTRIES_HARD_CAP });
  await new Promise((resolve) => setTimeout(resolve, cappedDuration));

  const stopResult = await stopCapture('manual');
  const capture = stopResult.capture || getCurrentCapture() || { entries: [] };

  return {
    entries: capture.entries,
    count: capture.entries.length,
    duration: cappedDuration,
    bodiesCaptured: capture.entries.filter(e => e.responseBody).length,
    debuggerUsed: capture.debuggerUsed,
  };
}

async function handleWaitForDownload(params) {
  const { timeout = 30000, urlPattern = '' } = params;

  // Grace window: check the persistent download tracker in chrome.storage.session first.
  // The top-level chrome.downloads.onCreated/onChanged listeners (registered at SW startup)
  // record every download into session storage, surviving SW restarts within a browser session.
  // This handles fast downloads that complete before wait_for_download is called.
  const graceMs = 15000;
  const graceCutoff = Date.now() - graceMs;

  const sessionData = await new Promise(resolve => chrome.storage.session.get(DL_SESSION_KEY, resolve));
  const trackedEntries = (sessionData[DL_SESSION_KEY] || [])
    .filter(e => e.recordedAt >= graceCutoff)
    .filter(e => !urlPattern || e.url.includes(urlPattern));

  const alreadyDone = trackedEntries.find(e => e.state === 'complete' || e.state === 'interrupted');
  if (alreadyDone) {
    return {
      id: alreadyDone.id,
      filename: alreadyDone.filename,
      url: alreadyDone.url,
      finalUrl: alreadyDone.finalUrl || alreadyDone.url,
      state: alreadyDone.state,
      fileSize: alreadyDone.fileSize || 0,
      totalBytes: alreadyDone.totalBytes || 0,
      mime: alreadyDone.mime || null,
      startTime: alreadyDone.startTime || null,
      endTime: alreadyDone.endTime || null,
      error: alreadyDone.error || null,
      fromGraceWindow: true,
    };
  }

  // Also check for in-progress downloads tracked in the session store
  const inProgressTracked = trackedEntries.filter(e => e.state === 'in_progress').map(e => e.id);

  // Fallback: also query chrome.downloads directly for any in-progress downloads
  const liveInProgress = await new Promise(resolve => chrome.downloads.search({ state: 'in_progress' }, resolve));
  const liveFiltered = liveInProgress.filter(d => !urlPattern || d.url.includes(urlPattern));

  const pendingIds = new Set([
    ...inProgressTracked,
    ...liveFiltered.map(d => d.id),
  ]);

  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      chrome.downloads.onCreated.removeListener(onCreated);
      chrome.downloads.onChanged.removeListener(onChanged);
      reject(new Error(`Timeout: no download completed within ${timeout}ms`));
    }, timeout);

    function format(item) {
      return {
        id: item.id,
        filename: item.filename,
        url: item.url,
        finalUrl: item.finalUrl || item.url,
        state: item.state,
        fileSize: item.fileSize || item.bytesReceived || 0,
        totalBytes: item.totalBytes || 0,
        mime: item.mime || null,
        startTime: item.startTime || null,
        endTime: item.endTime || null,
        error: item.error || null,
      };
    }

    function finish(id) {
      clearTimeout(deadline);
      chrome.downloads.onCreated.removeListener(onCreated);
      chrome.downloads.onChanged.removeListener(onChanged);
      chrome.downloads.search({ id }, (items) => {
        if (items.length > 0) resolve(format(items[0]));
        else reject(new Error(`Download ${id} not found after completion`));
      });
    }

    function onCreated(item) {
      if (urlPattern && !item.url.includes(urlPattern)) return;
      if (item.state === 'complete') { finish(item.id); return; }
      pendingIds.add(item.id);
    }

    function onChanged(delta) {
      if (!pendingIds.has(delta.id)) return;
      if (!delta.state) return;
      if (delta.state.current === 'complete') {
        pendingIds.delete(delta.id);
        finish(delta.id);
      } else if (delta.state.current === 'interrupted') {
        pendingIds.delete(delta.id);
        clearTimeout(deadline);
        chrome.downloads.onCreated.removeListener(onCreated);
        chrome.downloads.onChanged.removeListener(onChanged);
        resolve({ id: delta.id, state: 'interrupted', error: delta.error?.current || 'UNKNOWN' });
      }
    }

    chrome.downloads.onCreated.addListener(onCreated);
    chrome.downloads.onChanged.addListener(onChanged);
  });
}

async function handleFetchWithSession(params) {
  const { tabId, url, method = 'GET', headers = {}, body = null, timeout = 30000, maxBodySize = 50000 } = params;
  const BODY_LIMIT = Math.min(maxBodySize, 200000);

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (fetchUrl, fetchMethod, fetchHeaders, fetchBody, fetchTimeout, bodyLimit) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), fetchTimeout);
      try {
        const init = { method: fetchMethod, headers: fetchHeaders, credentials: 'include', signal: controller.signal };
        if (fetchBody !== null && fetchMethod !== 'GET' && fetchMethod !== 'HEAD') {
          init.body = typeof fetchBody === 'string' ? fetchBody : JSON.stringify(fetchBody);
        }
        const resp = await fetch(fetchUrl, init);
        clearTimeout(timer);
        const responseHeaders = {};
        resp.headers.forEach((v, k) => { responseHeaders[k] = v; });
        const contentType = resp.headers.get('content-type') || '';
        let responseBody, bodyType = 'text';
        const text = await resp.text();
        const truncated = text.length > bodyLimit;
        const sample = truncated ? text.slice(0, bodyLimit) : text;
        if (contentType.includes('application/json')) {
          try { responseBody = JSON.parse(sample); bodyType = 'json'; }
          catch { responseBody = sample; }
        } else {
          responseBody = sample;
        }
        return {
          status: resp.status,
          statusText: resp.statusText,
          ok: resp.ok,
          url: resp.url,
          headers: responseHeaders,
          body: responseBody,
          bodyType,
          truncated,
          totalBodySize: text.length,
        };
      } catch (e) {
        clearTimeout(timer);
        return { error: e.name === 'AbortError' ? `Request timed out after ${fetchTimeout}ms` : e.message };
      }
    },
    args: [url, method, headers, body, timeout, BODY_LIMIT],
    world: 'MAIN',
  });

  const result = results?.[0]?.result;
  if (!result) return { error: 'Script execution returned no result (tab may not have a loaded page)' };
  return result;
}

async function handleDialog(params) {
  const { tabId, accept = true, promptText = '', drain = false } = params;

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (acceptVal, promptTextVal, drainOnly) => {
      window.__tethernetDialogLog = window.__tethernetDialogLog || [];

      if (drainOnly) {
        const logged = window.__tethernetDialogLog.splice(0);
        return { drained: true, dialogs: logged };
      }

      // Save originals once so we can always restore
      if (!window.__tethernetDialogOriginals) {
        window.__tethernetDialogOriginals = {
          alert: window.alert,
          confirm: window.confirm,
          prompt: window.prompt,
        };
      }

      window.alert = function(msg) {
        window.__tethernetDialogLog.push({ type: 'alert', message: String(msg ?? ''), at: Date.now() });
      };
      window.confirm = function(msg) {
        const result = acceptVal;
        window.__tethernetDialogLog.push({ type: 'confirm', message: String(msg ?? ''), result, at: Date.now() });
        return result;
      };
      window.prompt = function(msg, defaultValue) {
        const result = acceptVal ? (promptTextVal || defaultValue || '') : null;
        window.__tethernetDialogLog.push({ type: 'prompt', message: String(msg ?? ''), defaultValue, result, at: Date.now() });
        return result;
      };

      const pending = window.__tethernetDialogLog.splice(0);
      return { installed: true, accept: acceptVal, promptText: promptTextVal, pendingDialogs: pending };
    },
    args: [accept, promptText, drain],
    world: 'MAIN',
  });

  return results?.[0]?.result ?? { error: 'Script returned no result' };
}

async function handleUploadFile(params) {
  const { tabId, frameId, selector, filename, content, mimeType = '', encoding = 'text' } = params;

  const target = { tabId };
  if (frameId != null) target.frameIds = [frameId];

  const results = await chrome.scripting.executeScript({
    target,
    func: (sel, fname, fileContent, fileMime, enc) => {
      const el = document.querySelector(sel);
      if (!el) return { error: `No element found: ${sel}` };
      if (el.tagName !== 'INPUT' || el.type !== 'file') {
        return { error: `Element is not a file input (got <${el.tagName.toLowerCase()} type="${el.type}">): ${sel}` };
      }

      let bytes;
      try {
        if (enc === 'base64') {
          const binary = atob(fileContent);
          bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        } else {
          bytes = new TextEncoder().encode(fileContent);
        }
      } catch (e) {
        return { error: `Failed to decode content: ${e.message}` };
      }

      const file = new File([bytes], fname, { type: fileMime || '' });
      const dt = new DataTransfer();
      dt.items.add(file);

      try {
        el.files = dt.files;
      } catch (e) {
        return { error: `Could not set files on input: ${e.message}` };
      }

      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));

      return { uploaded: true, filename: file.name, size: file.size, type: file.type };
    },
    args: [selector, filename, content, mimeType, encoding],
    world: 'MAIN',
  });

  return results?.[0]?.result ?? { error: 'Script returned no result' };
}

async function handleRunLighthouse(params) {
  const { tabId, categories = ['performance', 'accessibility', 'seo', 'best-practices'] } = params;

  if (networkCapture.debuggerAttached && networkCapture.tabId === tabId) {
    return { error: 'Network capture is active on this tab — call stop_network_capture first.' };
  }

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (e) {
    return { error: `Tab ${tabId} not found` };
  }

  let debuggerAttached = false;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    debuggerAttached = true;
  } catch (e) {
    return { error: `Could not attach debugger: ${e.message}. Close DevTools on this tab and try again.` };
  }

  const audit = { url: tab.url, categories: {} };

  try {
    // ── PERFORMANCE ──────────────────────────────────────────────
    if (categories.includes('performance')) {
      await chrome.debugger.sendCommand({ tabId }, 'Performance.enable');
      const { metrics } = await chrome.debugger.sendCommand({ tabId }, 'Performance.getMetrics');
      const cdp = Object.fromEntries(metrics.map(m => [m.name, m.value]));

      const cwvResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const nav = performance.getEntriesByType('navigation')[0] || {};
          const fcp = performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint')?.startTime ?? null;

          let lcp = null;
          try {
            const obs = new PerformanceObserver(() => {});
            obs.observe({ type: 'largest-contentful-paint', buffered: true });
            const entries = obs.takeRecords();
            lcp = entries.length ? entries[entries.length - 1].startTime : null;
            obs.disconnect();
          } catch (_) {}

          let cls = 0;
          try {
            const obs = new PerformanceObserver(() => {});
            obs.observe({ type: 'layout-shift', buffered: true });
            for (const e of obs.takeRecords()) { if (!e.hadRecentInput) cls += e.value; }
            obs.disconnect();
          } catch (_) {}

          return {
            fcp: fcp != null ? Math.round(fcp) : null,
            lcp: lcp != null ? Math.round(lcp) : null,
            cls: Math.round(cls * 1000) / 1000,
            ttfb: nav.responseStart ? Math.round(nav.responseStart - nav.requestStart) : null,
            domContentLoaded: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : null,
            loadTime: nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null,
          };
        },
        world: 'MAIN',
      });
      const cwv = cwvResult?.[0]?.result ?? {};

      function scoreMetric(v, good, poor) {
        if (v == null) return null;
        if (v <= good) return 100;
        if (v >= poor) return 0;
        return Math.round(100 * (1 - (v - good) / (poor - good)));
      }
      function rating(s) { return s == null ? null : s >= 90 ? 'good' : s >= 50 ? 'needs-improvement' : 'poor'; }

      const scores = {
        fcp: scoreMetric(cwv.fcp, 1800, 3000),
        lcp: scoreMetric(cwv.lcp, 2500, 4000),
        cls: scoreMetric(cwv.cls, 0.1, 0.25),
        ttfb: scoreMetric(cwv.ttfb, 800, 1800),
      };
      const validScores = Object.values(scores).filter(s => s != null);

      audit.categories.performance = {
        score: validScores.length ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length) : null,
        metrics: {
          fcp:  { value: cwv.fcp,  unit: 'ms', score: scores.fcp,  rating: rating(scores.fcp) },
          lcp:  { value: cwv.lcp,  unit: 'ms', score: scores.lcp,  rating: rating(scores.lcp) },
          cls:  { value: cwv.cls,  unit: '',   score: scores.cls,  rating: rating(scores.cls) },
          ttfb: { value: cwv.ttfb, unit: 'ms', score: scores.ttfb, rating: rating(scores.ttfb) },
          domContentLoaded: { value: cwv.domContentLoaded, unit: 'ms' },
          loadTime:         { value: cwv.loadTime,         unit: 'ms' },
        },
        cdpMetrics: {
          scriptDuration: cdp.ScriptDuration != null ? Math.round(cdp.ScriptDuration * 1000) : null,
          taskDuration:   cdp.TaskDuration   != null ? Math.round(cdp.TaskDuration   * 1000) : null,
          jsHeapUsedKB:   cdp.JSHeapUsedSize != null ? Math.round(cdp.JSHeapUsedSize / 1024) : null,
          domNodes:       cdp.Nodes          != null ? cdp.Nodes      : null,
          layoutCount:    cdp.LayoutCount    != null ? cdp.LayoutCount : null,
        },
      };
    }

    // ── ACCESSIBILITY ─────────────────────────────────────────────
    if (categories.includes('accessibility')) {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const issues = [];

          const imgsNoAlt = document.querySelectorAll('img:not([alt])').length;
          if (imgsNoAlt) issues.push({ id: 'image-alt', impact: 'critical', count: imgsNoAlt, description: `${imgsNoAlt} image(s) missing alt attribute` });

          const inputs = Array.from(document.querySelectorAll(
            'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea'
          ));
          const unlabeled = inputs.filter(el =>
            !el.getAttribute('aria-label') &&
            !el.getAttribute('aria-labelledby') &&
            !(el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) &&
            !el.closest('label') &&
            !el.getAttribute('title')
          ).length;
          if (unlabeled) issues.push({ id: 'label', impact: 'critical', count: unlabeled, description: `${unlabeled} form input(s) without accessible labels` });

          const btns = Array.from(document.querySelectorAll('button, [role=button], input[type=button], input[type=submit]'));
          const unnamedBtns = btns.filter(el =>
            !(el.textContent || '').trim() &&
            !el.getAttribute('aria-label') &&
            !el.getAttribute('aria-labelledby') &&
            !el.getAttribute('title') &&
            !el.querySelector('img[alt]')
          ).length;
          if (unnamedBtns) issues.push({ id: 'button-name', impact: 'critical', count: unnamedBtns, description: `${unnamedBtns} button(s) without accessible names` });

          if (!document.documentElement.getAttribute('lang'))
            issues.push({ id: 'html-has-lang', impact: 'serious', count: 1, description: 'Document missing lang attribute on <html>' });

          const h1Count = document.querySelectorAll('h1').length;
          if (h1Count > 1) issues.push({ id: 'multiple-h1', impact: 'moderate', count: h1Count, description: `${h1Count} <h1> elements — should have exactly one` });
          if (h1Count === 0) issues.push({ id: 'missing-h1', impact: 'moderate', count: 1, description: 'No <h1> found on page' });

          const emptyLinks = Array.from(document.querySelectorAll('a[href]')).filter(a =>
            !(a.textContent || '').trim() && !a.getAttribute('aria-label') && !a.querySelector('img[alt]')
          ).length;
          if (emptyLinks) issues.push({ id: 'link-name', impact: 'serious', count: emptyLinks, description: `${emptyLinks} link(s) without accessible names` });

          const weights = { critical: 10, serious: 5, moderate: 2, minor: 1 };
          const deduction = issues.reduce((sum, i) => sum + (weights[i.impact] || 2) * Math.min(i.count, 5), 0);

          return {
            score: Math.max(0, 100 - deduction),
            issues,
            totals: {
              images: document.querySelectorAll('img').length,
              inputs: inputs.length,
              buttons: btns.length,
              links: document.querySelectorAll('a[href]').length,
            },
          };
        },
        world: 'MAIN',
      });
      audit.categories.accessibility = result?.[0]?.result ?? { error: 'Script failed' };
    }

    // ── SEO ───────────────────────────────────────────────────────
    if (categories.includes('seo')) {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const getMeta = name =>
            document.querySelector(`meta[name="${name}"]`)?.content ??
            document.querySelector(`meta[property="${name}"]`)?.content ?? null;

          const checks = [];

          const title = document.title;
          const titleLen = title?.length ?? 0;
          checks.push({ id: 'document-title', pass: titleLen >= 10 && titleLen <= 60, score: !title ? 0 : (titleLen >= 10 && titleLen <= 60) ? 100 : 50, description: !title ? 'Missing <title>' : `Title: "${title}" (${titleLen} chars${titleLen < 10 || titleLen > 60 ? ' — optimal: 10-60' : ''})` });

          const desc = getMeta('description');
          const descLen = desc?.length ?? 0;
          checks.push({ id: 'meta-description', pass: descLen >= 50 && descLen <= 160, score: !desc ? 0 : (descLen >= 50 && descLen <= 160) ? 100 : 50, description: !desc ? 'Missing meta description' : `Meta description: ${descLen} chars${descLen < 50 || descLen > 160 ? ' — optimal: 50-160' : ''}` });

          const h1s = Array.from(document.querySelectorAll('h1')).map(h => h.textContent.trim().slice(0, 80));
          checks.push({ id: 'single-h1', pass: h1s.length === 1, score: h1s.length === 1 ? 100 : 0, description: h1s.length === 0 ? 'No <h1> found' : h1s.length > 1 ? `${h1s.length} <h1> elements` : `H1: "${h1s[0]}"` });

          const viewport = document.querySelector('meta[name="viewport"]');
          checks.push({ id: 'viewport', pass: !!viewport, score: viewport ? 100 : 0, description: viewport ? `Viewport: ${viewport.content}` : 'Missing viewport meta tag' });

          const canonical = document.querySelector('link[rel="canonical"]')?.href;
          checks.push({ id: 'canonical', pass: !!canonical, score: canonical ? 100 : 50, description: canonical ? `Canonical: ${canonical}` : 'No canonical URL set' });

          const robots = getMeta('robots');
          const blocking = robots && (robots.includes('noindex') || robots.includes('none'));
          checks.push({ id: 'robots-txt', pass: !blocking, score: blocking ? 0 : 100, description: blocking ? `Robots meta blocks indexing: "${robots}"` : robots ? `Robots: "${robots}"` : 'No robots meta (defaults to index, follow)' });

          const imgsNoAlt = document.querySelectorAll('img:not([alt])').length;
          checks.push({ id: 'image-alt', pass: imgsNoAlt === 0, score: Math.max(0, 100 - imgsNoAlt * 10), description: imgsNoAlt === 0 ? 'All images have alt attributes' : `${imgsNoAlt} image(s) missing alt` });

          const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
            .map(s => { try { return JSON.parse(s.textContent); } catch (_) { return null; } })
            .filter(Boolean);
          checks.push({ id: 'structured-data', pass: jsonLd.length > 0, score: jsonLd.length > 0 ? 100 : 50, description: jsonLd.length ? `Structured data: ${jsonLd.map(d => d['@type']).filter(Boolean).join(', ')}` : 'No JSON-LD structured data' });

          return {
            score: Math.round(checks.reduce((s, c) => s + c.score, 0) / checks.length),
            passed: checks.filter(c => c.pass).length,
            total: checks.length,
            checks,
          };
        },
        world: 'MAIN',
      });
      audit.categories.seo = result?.[0]?.result ?? { error: 'Script failed' };
    }

    // ── BEST PRACTICES ────────────────────────────────────────────
    if (categories.includes('best-practices')) {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (url) => {
          const checks = [];

          checks.push({ id: 'https', pass: url.startsWith('https://'), description: url.startsWith('https://') ? 'Served over HTTPS' : 'Not served over HTTPS' });

          checks.push({ id: 'doctype', pass: document.doctype?.name === 'html', description: document.doctype?.name === 'html' ? 'Valid HTML5 doctype' : 'Missing or invalid doctype' });

          const charset = (document.characterSet || '').toLowerCase();
          checks.push({ id: 'charset', pass: charset === 'utf-8', description: charset === 'utf-8' ? 'UTF-8 charset' : `Charset: ${charset || 'not declared'}` });

          const unsized = Array.from(document.querySelectorAll('img'))
            .filter(img => !img.getAttribute('width') || !img.getAttribute('height')).length;
          checks.push({ id: 'image-dimensions', pass: unsized === 0, description: unsized === 0 ? 'All images have explicit dimensions' : `${unsized} image(s) missing explicit width/height (layout shift risk)` });

          const passwordInputs = document.querySelectorAll('input[type=password]').length;
          if (passwordInputs > 0) {
            const insecure = !url.startsWith('https://');
            checks.push({ id: 'password-over-https', pass: !insecure, description: insecure ? 'Password input on non-HTTPS page — credentials at risk' : 'Password input served over HTTPS' });
          }

          const externalScripts = Array.from(document.querySelectorAll('script[src]'))
            .filter(s => { try { return new URL(s.src).origin !== location.origin; } catch(_) { return false; } }).length;
          checks.push({ id: 'external-scripts', pass: true, description: `${externalScripts} external script(s) loaded` });

          const passed = checks.filter(c => c.pass).length;
          return { score: Math.round(100 * passed / checks.length), passed, total: checks.length, checks };
        },
        args: [tab.url],
        world: 'MAIN',
      });
      audit.categories['best-practices'] = result?.[0]?.result ?? { error: 'Script failed' };
    }

  } finally {
    if (debuggerAttached) {
      try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    }
  }

  const scores = Object.values(audit.categories).map(c => c.score).filter(s => typeof s === 'number');
  audit.overallScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  return audit;
}

async function forwardToContentScript(tabId, action, params) {
  try {
    const frameId = params.frameId ?? 0;
    const response = await chrome.tabs.sendMessage(tabId, { action, params }, { frameId });
    return response;
  } catch (error) {
    throw new Error(`Failed to communicate with content script: ${error.message}`);
  }
}

// --- Message listener (from popup, offscreen doc, content scripts) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'capture_keepalive_ping') return false;

  // Messages from offscreen document
  if (message.type === 'ws_open') {
    connectionState = 'connected';
    connectedAt = Date.now();
    updateIcon();
    sendTabList();
    return false;
  }

  if (message.type === 'ws_closed') {
    connectionState = 'disconnected';
    connectedAt = null;
    sessionInfo = null;
    updateIcon();
    return false;
  }

  if (message.type === 'session_info') {
    sessionInfo = message.data;
    console.log('[Tethernet] Session info received:', sessionInfo.projectName, 'PID:', sessionInfo.pid);
    chrome.runtime.sendMessage({ type: 'session_info_updated', sessionInfo }).catch(() => {});
    return false;
  }

  if (message.type === 'server_command') {
    const { action, params, requestId } = message.command;

    if (!consentGranted) {
      sendResponse({
        requestId,
        result: null,
        error: 'Tethernet is not enabled. The user must grant consent via the extension popup or onboarding page before commands can be executed.',
      });
      return false;
    }

    handleServerCommand(action, params)
      .then(result => sendResponse({ requestId, result, error: null }))
      .catch(error => {
        console.error(`[Tethernet] Command ${action} failed:`, error);
        sendResponse({ requestId, result: null, error: error.message });
      });
    return true; // keep channel open for async response
  }

  // Autorun: execute site-specific scripts in the page's main world
  if (message.type === 'autorun_check') {
    const tabId = sender.tab?.id;
    if (!tabId) return false;
    const domain = (message.hostname || '').replace(/^www\./, '');
    if (!domain) return false;
    chrome.storage.local.get('site:' + domain, async (result) => {
      let data = result['site:' + domain];
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch(e) { return; } }
      if (!data || !Array.isArray(data.autorun) || !data.autorun.length || !data.scripts) return;
      for (const name of data.autorun) {
        const code = data.scripts[name];
        if (typeof code !== 'string') continue;
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (c) => { (new Function(c))(); },
            args: [code],
          });
          console.log(`[Tethernet] Autorun: ran "${name}" in tab ${tabId}`);
        } catch(e) {
          console.warn(`[Tethernet] Autorun error "${name}":`, e.message);
        }
      }
    });
    return false;
  }

  // Messages from content scripts
  if (message.type === 'content_script_ready') {
    const tabId = sender.tab?.id;
    if (tabId) {
      contentScriptTabs.add(tabId);
      updateTabBadge(tabId);
      console.log(`[Tethernet] Content script ready in tab ${tabId}`);
    }
    return false;
  }

  // Messages from popup
  if (message.type === 'get_state') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async tabs => {
      const currentTab = tabs[0];
      let contentScriptReady = false;
      if (currentTab) {
        contentScriptReady = await checkContentScript(currentTab.id);
      }
      sendResponse({
        connectionState,
        connectedAt,
        serverUrl: SERVER_URL,
        sessionInfo,
        currentTab: currentTab ? {
          id: currentTab.id,
          url: currentTab.url,
          title: currentTab.title,
          contentScriptReady
        } : null
      });
    });
    return true;
  }

  if (message.type === 'reconnect') {
    SERVER_URL = message.serverUrl;
    chrome.storage.local.set({ tethernetServerUrl: SERVER_URL });
    chrome.runtime.sendMessage({ type: 'ws_disconnect' }).catch(() => {});
    connect();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'disconnect') {
    chrome.runtime.sendMessage({ type: 'ws_disconnect' }).catch(() => {});
    SERVER_URL = null;
    connectionState = 'disconnected';
    connectedAt = null;
    sessionInfo = null;
    updateIcon();
    chrome.storage.local.remove('tethernetServerUrl');
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'popup_set_passive_mode') {
    setPassiveMode(!!message.enabled);
    sendResponse({ ok: true, enabled: passiveMode });
    return false;
  }

  if (message.type === 'popup_get_passive_mode') {
    sendResponse({ enabled: passiveMode, count: passiveLog.length });
    return false;
  }

  if (message.type === 'popup_summarize_passive_log') {
    sendResponse(buildPassiveSummary());
    return false;
  }

  if (message.type === 'passive_interaction') {
    if (passiveMode && message.data) {
      passiveLog.push({ kind: 'interaction', ...message.data });
      if (passiveLog.length > PASSIVE_MAX) passiveLog.shift();
      chrome.runtime.sendMessage({ type: 'passive_count_changed', count: passiveLog.length }).catch(() => {});
    }
    return false;
  }
});

// --- Tab lifecycle ---

chrome.tabs.onRemoved.addListener((tabId) => {
  contentScriptTabs.delete(tabId);

  if (networkCapture.active && networkCapture.tabId === tabId) {
    stopCapture('tab_closed');
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  checkContentScript(activeInfo.tabId);
});

// --- Persistent download tracker ---
// Top-level listeners wake the SW on every download event and record entries in
// chrome.storage.session so wait_for_download can read them across SW restarts.
// chrome.storage.session is cleared when the browser profile session ends.

function pruneDownloadTracker(entries) {
  const cutoff = Date.now() - DL_SESSION_TTL;
  return entries.filter(e => e.recordedAt >= cutoff);
}

chrome.downloads.onCreated.addListener((item) => {
  console.log('[Tethernet] download created:', item.id, item.url, item.state);
  chrome.storage.session.get(DL_SESSION_KEY, (result) => {
    const entries = pruneDownloadTracker(result[DL_SESSION_KEY] || []);
    entries.push({ id: item.id, url: item.url, finalUrl: item.finalUrl || item.url, state: item.state, mime: item.mime || null, startTime: item.startTime, endTime: item.endTime || null, filename: item.filename || '', totalBytes: item.totalBytes || 0, fileSize: item.fileSize || item.bytesReceived || 0, error: item.error || null, recordedAt: Date.now() });
    chrome.storage.session.set({ [DL_SESSION_KEY]: entries });
  });
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state) return;
  chrome.storage.session.get(DL_SESSION_KEY, (result) => {
    const entries = result[DL_SESSION_KEY] || [];
    const idx = entries.findIndex(e => e.id === delta.id);
    if (idx === -1) {
      // Not yet tracked — fetch the full item and add it
      chrome.downloads.search({ id: delta.id }, (items) => {
        if (!items || !items.length) return;
        const item = items[0];
        const pruned = pruneDownloadTracker(entries);
        pruned.push({ id: item.id, url: item.url, finalUrl: item.finalUrl || item.url, state: item.state, mime: item.mime || null, startTime: item.startTime, endTime: item.endTime || null, filename: item.filename || '', totalBytes: item.totalBytes || 0, fileSize: item.fileSize || item.bytesReceived || 0, error: item.error || null, recordedAt: Date.now() });
        chrome.storage.session.set({ [DL_SESSION_KEY]: pruned });
      });
      return;
    }
    if (delta.state) entries[idx].state = delta.state.current;
    if (delta.endTime) entries[idx].endTime = delta.endTime.current;
    if (delta.error) entries[idx].error = delta.error.current;
    if (delta.filename) entries[idx].filename = delta.filename.current;
    if (delta.fileSize) entries[idx].fileSize = delta.fileSize.current;
    if (delta.totalBytes) entries[idx].totalBytes = delta.totalBytes.current;
    entries[idx].recordedAt = Date.now();
    chrome.storage.session.set({ [DL_SESSION_KEY]: pruneDownloadTracker(entries) });
  });
});

// --- Init ---

chrome.storage.local.remove('tetherwebServerUrl');
connectionState = 'disconnected';
updateIcon();
updateRecordingIndicator();
buildRecordingIconCache();

chrome.storage.local.get(['tetherwebConsent', 'tethernetPassiveMode', 'tethernetServerUrl']).then(({ tetherwebConsent, tethernetPassiveMode, tethernetServerUrl }) => {
  consentGranted = !!tetherwebConsent;
  console.log(`[Tethernet] Consent: ${consentGranted ? 'granted' : 'not granted'}`);
  if (tethernetPassiveMode) {
    setPassiveMode(true);
    console.log('[Tethernet] Passive mode restored from storage');
  }
  if (tethernetServerUrl) {
    SERVER_URL = tethernetServerUrl;
    console.log('[Tethernet] Reconnecting to', SERVER_URL);
    connect();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.tetherwebConsent) {
    consentGranted = !!changes.tetherwebConsent.newValue;
    console.log(`[Tethernet] Consent ${consentGranted ? 'granted' : 'revoked'}`);
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  }
});


console.log('[Tethernet] Service worker initialized');
