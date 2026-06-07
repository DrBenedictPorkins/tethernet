/**
 * Tethernet Offscreen Document
 * Hosts the persistent WebSocket connection to the MCP server.
 * Service workers die after ~30s of inactivity; offscreen documents don't.
 */

let ws = null;
let pendingUrl = null;
let keepAliveTimer = null;

function connect(serverUrl) {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    if (pendingUrl !== serverUrl) {
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    } else {
      return;
    }
  }

  pendingUrl = serverUrl;

  try {
    ws = new WebSocket(serverUrl);

    ws.onopen = () => {
      console.log('[Tethernet/offscreen] WebSocket connected');
      ws.send(JSON.stringify({ type: 'hello', browser: 'chrome' }));
      chrome.runtime.sendMessage({ type: 'ws_open' }).catch(() => {});
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'session_info') {
          chrome.runtime.sendMessage({ type: 'session_info', data: message.data }).catch(() => {});
          return;
        }

        // Forward server command to service worker, send response back via WS
        chrome.runtime.sendMessage({ type: 'server_command', command: message }, (response) => {
          if (chrome.runtime.lastError) return;
          if (response && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(response));
          }
        });
      } catch (error) {
        console.error('[Tethernet/offscreen] Failed to parse message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[Tethernet/offscreen] WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('[Tethernet/offscreen] WebSocket closed');
      ws = null;
      pendingUrl = null;
      chrome.runtime.sendMessage({ type: 'ws_closed' }).catch(() => {});
    };
  } catch (error) {
    console.error('[Tethernet/offscreen] Failed to create WebSocket:', error);
    chrome.runtime.sendMessage({ type: 'ws_closed' }).catch(() => {});
  }
}

function disconnect() {
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.close();
    ws = null;
    pendingUrl = null;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ws_connect') {
    connect(message.serverUrl);
  } else if (message.type === 'ws_disconnect') {
    disconnect();
  } else if (message.type === 'ws_send') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message.data));
    }
  } else if (message.type === 'capture_keepalive_start') {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'capture_keepalive_ping' }).catch(() => {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      });
    }, 20000);
  } else if (message.type === 'capture_keepalive_stop') {
    if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
  }
});

console.log('[Tethernet/offscreen] Offscreen document initialized');
