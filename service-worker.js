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
let popupPrimaryTabId = null;

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
    SERVER_URL = null;
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
    chrome.storage.local.remove('tetherwebServerUrl');
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'popup_start_capture') {
    startCapture(message.params || {}).then(sendResponse);
    return true;
  }

  if (message.type === 'popup_stop_capture') {
    stopCapture('manual').then(sendResponse);
    return true;
  }

  if (message.type === 'popup_get_capture') {
    sendResponse({ capture: getCurrentCapture(), state: getCaptureState() });
    return false;
  }

  if (message.type === 'popup_clear_capture') {
    sendResponse(clearCapture());
    return false;
  }

  if (message.type === 'popup_set_primary_tab') {
    const tabId = message.tabId != null ? Number(message.tabId) : null;
    popupPrimaryTabId = tabId;
    sendToServer({ type: 'primary_tab_changed', data: { tabId } });
    sendResponse({ ok: true, primaryTabId: tabId });
    return false;
  }

  if (message.type === 'popup_get_primary_tab') {
    sendResponse({ primaryTabId: popupPrimaryTabId });
    return false;
  }
});

// --- Tab lifecycle ---

chrome.tabs.onRemoved.addListener((tabId) => {
  contentScriptTabs.delete(tabId);

  if (networkCapture.active && networkCapture.tabId === tabId) {
    stopCapture('tab_closed');
  }

  if (popupPrimaryTabId === tabId) {
    popupPrimaryTabId = null;
    sendToServer({ type: 'primary_tab_changed', data: { tabId: null } });
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  checkContentScript(activeInfo.tabId);
});

// --- Init ---

chrome.storage.local.remove('tetherwebServerUrl');
connectionState = 'disconnected';
updateIcon();
updateRecordingIndicator();
buildRecordingIconCache();

chrome.storage.local.get('tetherwebConsent').then(({ tetherwebConsent }) => {
  consentGranted = !!tetherwebConsent;
  console.log(`[Tethernet] Consent: ${consentGranted ? 'granted' : 'not granted'}`);
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
