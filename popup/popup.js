/**
 * Tethernet Popup Script
 */

const consentRequired = document.getElementById('consent-required');
const mainUI = document.getElementById('main-ui');
const openOnboarding = document.getElementById('open-onboarding');
const revokeConsentBtn = document.getElementById('revoke-consent-btn');

function showConsentRequired() {
  consentRequired.classList.remove('hidden');
  mainUI.classList.add('hidden');
}

function showMainUI() {
  consentRequired.classList.add('hidden');
  mainUI.classList.remove('hidden');
}

chrome.storage.local.get('tetherwebConsent').then(({ tetherwebConsent }) => {
  if (tetherwebConsent) {
    showMainUI();
    initMainUI();
  } else {
    showConsentRequired();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.tetherwebConsent) {
    if (changes.tetherwebConsent.newValue) {
      showMainUI();
      initMainUI();
    } else {
      showConsentRequired();
    }
  }
});

openOnboarding.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  window.close();
});

revokeConsentBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove('tetherwebConsent');
  chrome.runtime.sendMessage({ type: 'disconnect' }).catch(() => {});
  showConsentRequired();
});

let mainUIInitialized = false;

function initMainUI() {
  if (mainUIInitialized) return;
  mainUIInitialized = true;

  const statusElement = document.getElementById('status');
  const sessionInfoElement = document.getElementById('session-info');
  const tabStatusElement = document.getElementById('tab-status');
  const tabInfoElement = document.getElementById('tab-info');
  const tabIdValue = document.getElementById('tab-id-value');
  const reloadNotice = document.getElementById('reload-notice');
  const reloadBtn = document.getElementById('reload-btn');
  const connectionTimeElement = document.getElementById('connection-time');
  const disconnectBtn = document.getElementById('disconnect-btn');
  const connectForm = document.querySelector('.connect-form');
  const serverHostportInput = document.getElementById('server-hostport');
  const connectBtn = document.getElementById('connect-btn');

  const passiveToggle = document.getElementById('passive-toggle');
  const passiveCount = document.getElementById('passive-count');

  let connectedAt = null;
  let updateTimer = null;
  let currentTabId = null;

  const PROTECTED_URL_PATTERNS = [
    /^about:/,
    /^chrome:/,
    /^chrome-extension:/,
    /^https?:\/\/chromewebstore\.google\.com/,
    /^file:\/\//,
    /^data:/,
    /^view-source:/
  ];

  const statusConfig = {
    connected: { text: 'Connected', class: 'connected' },
    connecting: { text: 'Connecting', class: 'connecting' },
    disconnected: { text: 'Disconnected', class: 'disconnected' }
  };

  function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  function updateConnectionTime() {
    if (connectedAt) {
      connectionTimeElement.textContent = `Connected for ${formatDuration(Date.now() - connectedAt)}`;
      connectionTimeElement.classList.remove('hidden');
    } else {
      connectionTimeElement.classList.add('hidden');
    }
  }

  function updateSessionInfo(session) {
    if (!session) {
      const noSession = document.createElement('span');
      noSession.className = 'session-none';
      noSession.textContent = 'No session connected';
      sessionInfoElement.replaceChildren(noSession);
      return;
    }
    const project = document.createElement('div');
    project.className = 'session-project';
    project.textContent = `${session.clientType || 'Claude'} • localhost:${session.port}`;
    const details = document.createElement('div');
    details.className = 'session-details';
    details.textContent = `PID: ${session.pid} • ${session.connectedAt ? formatDuration(Date.now() - session.connectedAt) : ''}`;
    sessionInfoElement.replaceChildren(project, details);
  }

  function updateConnectSection(state) {
    if (state === 'connected') {
      connectForm.classList.add('hidden');
      disconnectBtn.classList.remove('hidden');
    } else {
      connectForm.classList.remove('hidden');
      disconnectBtn.classList.add('hidden');
      connectBtn.textContent = state === 'connecting' ? 'Connecting...' : 'Connect';
    }
  }

  function updateStatus(state, _serverUrl, timestamp) {
    const config = statusConfig[state] || statusConfig.disconnected;
    statusElement.textContent = config.text;
    statusElement.className = `status-badge ${config.class}`;
    connectedAt = timestamp;
    updateConnectionTime();
    updateConnectSection(state);
    if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }
    if (state === 'connected' && connectedAt) {
      updateTimer = setInterval(updateConnectionTime, 1000);
    }
  }

  function isProtectedUrl(url) {
    if (!url) return true;
    return PROTECTED_URL_PATTERNS.some(pattern => pattern.test(url));
  }

  function updateTabStatus(currentTab) {
    if (!currentTab) {
      tabStatusElement.textContent = 'Unknown';
      tabStatusElement.className = 'tab-badge not-ready';
      tabInfoElement.textContent = '';
      tabIdValue.textContent = '—';
      reloadNotice.classList.add('hidden');
      return;
    }
    tabIdValue.textContent = currentTab.id != null ? currentTab.id : '—';
    const isProtected = isProtectedUrl(currentTab.url);
    const isReady = currentTab.contentScriptReady;
    tabInfoElement.textContent = currentTab.url || 'No URL';
    if (isProtected) {
      tabStatusElement.textContent = 'Protected';
      tabStatusElement.className = 'tab-badge protected';
      reloadNotice.classList.add('hidden');
    } else if (isReady) {
      tabStatusElement.textContent = 'Ready';
      tabStatusElement.className = 'tab-badge ready';
      reloadNotice.classList.add('hidden');
    } else {
      tabStatusElement.textContent = 'Reload Needed';
      tabStatusElement.className = 'tab-badge not-ready';
      reloadNotice.classList.remove('hidden');
    }
  }

  function doConnect() {
    const raw = serverHostportInput.value.trim();
    if (!raw) return;
    let hostport;
    if (/^\d+$/.test(raw)) {
      hostport = `localhost:${raw}`;
    } else {
      const parts = raw.split(':');
      if (parts.length !== 2 || !parts[1] || isNaN(Number(parts[1]))) {
        serverHostportInput.style.borderColor = '#dc3545';
        return;
      }
      hostport = raw;
    }
    serverHostportInput.style.borderColor = '';
    const serverUrl = `ws://${hostport}/extension`;
    chrome.storage.local.set({ tetherwebServerUrl: serverUrl });
    chrome.runtime.sendMessage({ type: 'reconnect', serverUrl }).catch(() => {});
    connectBtn.textContent = 'Connecting...';
  }

  function updatePassiveCount(count) {
    if (count > 0) {
      passiveCount.textContent = `${count} captured`;
      passiveCount.classList.remove('hidden');
    } else {
      passiveCount.classList.add('hidden');
    }
  }

  chrome.runtime.sendMessage({ type: 'popup_get_passive_mode' })
    .then(res => {
      if (res) {
        passiveToggle.checked = res.enabled;
        updatePassiveCount(res.count);
      }
    })
    .catch(() => {});

  passiveToggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: 'popup_set_passive_mode', enabled: passiveToggle.checked }).catch(() => {});
    if (!passiveToggle.checked) updatePassiveCount(0);
  });

  connectBtn.addEventListener('click', doConnect);
  disconnectBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'disconnect' }).catch(() => {});
  });
  serverHostportInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doConnect();
  });

  chrome.runtime.sendMessage({ type: 'get_state' })
    .then(response => {
      if (response) {
        updateStatus(response.connectionState, response.serverUrl, response.connectedAt);
        updateSessionInfo(response.sessionInfo);
        if (response.currentTab) {
          currentTabId = response.currentTab.id;
          updateTabStatus(response.currentTab);
        }
      }
    })
    .catch(() => updateStatus('disconnected'));

  reloadBtn.addEventListener('click', () => {
    if (currentTabId) {
      chrome.tabs.reload(currentTabId).then(() => window.close()).catch(() => {});
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'state_changed') {
      updateStatus(message.connectionState, null, message.connectedAt);
      updateSessionInfo(message.sessionInfo);
    }
    if (message.type === 'session_info_updated') {
      updateSessionInfo(message.sessionInfo);
    }
    if (message.type === 'passive_count_changed') {
      updatePassiveCount(message.count);
    }
  });
}

console.log('[Tethernet] Popup initialized');
