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
  const tabsCountElement = document.getElementById('tabs-count');
  const tabStatusElement = document.getElementById('tab-status');
  const tabInfoElement = document.getElementById('tab-info');
  const tabIdValue = document.getElementById('tab-id-value');
  const setPrimaryBtn = document.getElementById('set-primary-btn');
  const primaryMarker = document.getElementById('primary-tab-marker');
  const reloadNotice = document.getElementById('reload-notice');
  const reloadBtn = document.getElementById('reload-btn');
  const connectionTimeElement = document.getElementById('connection-time');
  const disconnectBtn = document.getElementById('disconnect-btn');
  const connectForm = document.querySelector('.connect-form');
  const serverHostportInput = document.getElementById('server-hostport');
  const connectBtn = document.getElementById('connect-btn');

  const captureStatusElement = document.getElementById('capture-status');
  const captureIdleControls = document.getElementById('capture-idle-controls');
  const captureActiveControls = document.getElementById('capture-active-controls');
  const captureConfirm = document.getElementById('capture-confirm');
  const captureSummary = document.getElementById('capture-summary');
  const captureSummaryInfo = document.getElementById('capture-summary-info');
  const captureMaxEntriesInput = document.getElementById('capture-max-entries');
  const captureUrlFilterInput = document.getElementById('capture-url-filter');
  const startCaptureBtn = document.getElementById('start-capture-btn');
  const stopCaptureBtn = document.getElementById('stop-capture-btn');
  const cancelCaptureBtn = document.getElementById('cancel-capture-btn');
  const confirmCaptureBtn = document.getElementById('confirm-capture-btn');
  const confirmTabIdElement = document.getElementById('confirm-tab-id');
  const captureProgress = document.getElementById('capture-progress');
  const viewCaptureBtn = document.getElementById('view-capture-btn');
  const clearCaptureBtn = document.getElementById('clear-capture-btn');

  let connectedAt = null;
  let updateTimer = null;
  let currentTabId = null;
  let popupPrimaryTabId = null;

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
      updatePrimaryMarker();
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
    updatePrimaryMarker();
  }

  function updatePrimaryMarker() {
    if (popupPrimaryTabId != null && currentTabId != null && popupPrimaryTabId === currentTabId) {
      primaryMarker.classList.remove('hidden');
    } else {
      primaryMarker.classList.add('hidden');
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

  setPrimaryBtn.addEventListener('click', () => {
    if (currentTabId == null) return;
    chrome.runtime.sendMessage({ type: 'popup_set_primary_tab', tabId: currentTabId })
      .then(() => {
        popupPrimaryTabId = currentTabId;
        updatePrimaryMarker();
        setPrimaryBtn.textContent = 'Set!';
        setTimeout(() => { setPrimaryBtn.textContent = 'Set Primary'; }, 1500);
      })
      .catch(() => {});
  });

  function renderCaptureState(state, capture) {
    if (!state) {
      captureStatusElement.textContent = 'IDLE';
      captureStatusElement.className = 'capture-status idle';
      captureIdleControls.classList.remove('hidden');
      captureActiveControls.classList.add('hidden');
      captureConfirm.classList.add('hidden');
      captureSummary.classList.add('hidden');
      return;
    }

    if (state.active) {
      captureStatusElement.textContent = 'RECORDING';
      captureStatusElement.className = 'capture-status recording';
      captureIdleControls.classList.add('hidden');
      captureActiveControls.classList.remove('hidden');
      captureConfirm.classList.add('hidden');
      captureSummary.classList.add('hidden');
      captureProgress.textContent = `${state.count}/${state.maxEntries}`;
      return;
    }

    if (capture && capture.startedAt != null) {
      captureStatusElement.textContent = 'COMPLETED';
      captureStatusElement.className = 'capture-status completed';
      captureIdleControls.classList.remove('hidden');
      captureActiveControls.classList.add('hidden');
      captureConfirm.classList.add('hidden');
      captureSummary.classList.remove('hidden');
      renderCaptureSummary(capture);
      return;
    }

    captureStatusElement.textContent = 'IDLE';
    captureStatusElement.className = 'capture-status idle';
    captureIdleControls.classList.remove('hidden');
    captureActiveControls.classList.add('hidden');
    captureConfirm.classList.add('hidden');
    captureSummary.classList.add('hidden');
  }

  function renderCaptureSummary(capture) {
    const durationMs = (capture.endedAt || Date.now()) - capture.startedAt;
    const seconds = Math.round(durationMs / 100) / 10;
    const reason = capture.endReason || '—';
    const lines = [
      ['Entries', capture.count != null ? capture.count : (capture.entries ? capture.entries.length : 0)],
      ['Duration', `${seconds}s`],
      ['Stopped', reason],
    ];
    if (capture.tabId != null) lines.push(['Tab', String(capture.tabId)]);
    if (capture.urlFilter) lines.push(['Filter', capture.urlFilter]);

    captureSummaryInfo.replaceChildren(...lines.map(([k, v]) => {
      const row = document.createElement('div');
      row.className = 'summary-line';
      const ks = document.createElement('span');
      ks.className = 'summary-key';
      ks.textContent = k;
      const vs = document.createElement('span');
      vs.className = 'summary-value';
      vs.textContent = String(v);
      row.appendChild(ks);
      row.appendChild(vs);
      return row;
    }));
  }

  function refreshCapture() {
    chrome.runtime.sendMessage({ type: 'popup_get_capture' })
      .then(res => { if (res) renderCaptureState(res.state, res.capture); })
      .catch(() => {});
  }

  startCaptureBtn.addEventListener('click', () => {
    if (currentTabId == null) return;
    confirmTabIdElement.textContent = currentTabId;
    captureIdleControls.classList.add('hidden');
    captureSummary.classList.add('hidden');
    captureConfirm.classList.remove('hidden');
  });

  cancelCaptureBtn.addEventListener('click', () => {
    captureConfirm.classList.add('hidden');
    refreshCapture();
  });

  confirmCaptureBtn.addEventListener('click', async () => {
    if (currentTabId == null) return;
    const maxEntries = Math.max(1, Math.min(parseInt(captureMaxEntriesInput.value, 10) || 100, 500));
    const urlFilter = captureUrlFilterInput.value.trim();
    const params = { maxEntries, tabId: currentTabId };
    if (urlFilter) params.urlFilter = urlFilter;
    try {
      await chrome.runtime.sendMessage({ type: 'popup_start_capture', params });
    } catch (e) { /* ignore */ }
    captureConfirm.classList.add('hidden');
    refreshCapture();
  });

  stopCaptureBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'popup_stop_capture' })
      .then(() => refreshCapture())
      .catch(() => {});
  });

  clearCaptureBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'popup_clear_capture' })
      .then(() => refreshCapture())
      .catch(() => {});
  });

  viewCaptureBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'popup_get_capture' })
      .then(res => {
        if (!res || !res.capture) return;
        const json = JSON.stringify(res.capture, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        chrome.tabs.create({ url });
      })
      .catch(() => {});
  });

  connectBtn.addEventListener('click', doConnect);
  disconnectBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'disconnect' }).catch(() => {});
  });
  serverHostportInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doConnect();
  });

  chrome.tabs.query({}).then(tabs => {
    tabsCountElement.textContent = tabs.length;
  }).catch(() => {});

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

  chrome.runtime.sendMessage({ type: 'popup_get_primary_tab' })
    .then(res => {
      if (res) {
        popupPrimaryTabId = res.primaryTabId;
        updatePrimaryMarker();
      }
    })
    .catch(() => {});

  refreshCapture();

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
    if (message.type === 'capture_state_changed') {
      refreshCapture();
    }
  });
}

console.log('[Tethernet] Popup initialized');
