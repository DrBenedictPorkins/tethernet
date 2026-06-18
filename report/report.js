chrome.runtime.sendMessage({ type: 'popup_summarize_passive_log' }, (data) => {
  const content = document.getElementById('content');
  const meta = document.getElementById('meta');

  if (!data || !data.count) {
    content.innerHTML = '<div class="empty">No passive log data. Enable Passive Mode and browse first.</div>';
    return;
  }

  const { count, netCount, interactionCount, timespan, domains, slowest, statusCodes, errors, interactions } = data;

  const fmt = (ms) => ms >= 1000 ? `${(ms/1000).toFixed(1)}s` : `${ms}ms`;
  const ts = (epochMs) => new Date(epochMs).toLocaleTimeString();
  const truncate = (url, n = 80) => url.length > n ? url.slice(0, n) + '…' : url;

  meta.innerHTML = `
    <span>${count} events</span>
    <span>${ts(timespan.fromMs)} → ${ts(timespan.toMs)}</span>
    <span>${timespan.durationSec}s captured</span>
  `;

  // Status badge colors
  const statusColor = (s) => s < 300 ? '#22c55e' : s < 400 ? '#f59e0b' : '#ef4444';

  // Status codes row
  const statusHtml = Object.entries(statusCodes)
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `<span class="badge" style="background:${statusColor(+code)}22;color:${statusColor(+code)};border-color:${statusColor(+code)}44">${code} × ${n}</span>`)
    .join('');

  // Domain table
  const domainRows = domains.map(d => `
    <tr>
      <td class="domain-cell">${d.domain}</td>
      <td class="num">${d.count}</td>
      <td class="num">${fmt(d.avgMs)}</td>
      <td class="methods">${Object.entries(d.methods).map(([m,n]) => `<span class="method method-${m.toLowerCase()}">${m}</span>`).join('')}</td>
      <td class="statuses">${Object.entries(d.statuses).map(([s,n]) => `<span style="color:${statusColor(+s)}">${s}×${n}</span>`).join(' ')}</td>
      <td class="slowest-cell">${d.slowest ? `<span class="slowest-ms">${fmt(d.slowest.ms)}</span> <span class="slowest-url">${truncate(d.slowest.url, 60)}</span>` : '—'}</td>
    </tr>
  `).join('');

  // Top slowest
  const slowestRows = slowest.map(e => `
    <tr>
      <td class="num slow-ms">${fmt(e.ms)}</td>
      <td><span class="method method-${e.method.toLowerCase()}">${e.method}</span></td>
      <td class="num"><span style="color:${statusColor(e.status)}">${e.status}</span></td>
      <td class="url-cell" title="${e.url}">${truncate(e.url, 90)}</td>
    </tr>
  `).join('');

  // Errors
  const errorHtml = errors.length === 0
    ? '<div class="none">No errors</div>'
    : `<table class="data-table"><thead><tr><th>Status</th><th>Method</th><th>ms</th><th>URL</th></tr></thead><tbody>
        ${errors.map(e => `<tr>
          <td class="num" style="color:${statusColor(e.status)}">${e.status}</td>
          <td><span class="method method-${e.method.toLowerCase()}">${e.method}</span></td>
          <td class="num">${fmt(e.ms)}</td>
          <td class="url-cell" title="${e.url}">${truncate(e.url, 90)}</td>
        </tr>`).join('')}
      </tbody></table>`;

  // Interactions
  const interactionHtml = interactions.length === 0
    ? '<div class="none">No interactions captured</div>'
    : `<table class="data-table"><thead><tr><th>Action</th><th>Element</th><th>URL</th><th>Time</th></tr></thead><tbody>
        ${interactions.map(e => `<tr>
          <td><span class="method">${e.action}</span></td>
          <td class="url-cell">${e.el || '—'}</td>
          <td class="url-cell">${truncate(e.url || '', 60)}</td>
          <td class="num">${ts(e.t)}</td>
        </tr>`).join('')}
      </tbody></table>`;

  content.innerHTML = `
    <div class="section">
      <h2>Status Codes</h2>
      <div class="badges">${statusHtml}</div>
    </div>

    <div class="section">
      <h2>By Domain <span class="count">${domains.length} domains</span></h2>
      <table class="data-table">
        <thead><tr><th>Domain</th><th>Reqs</th><th>Avg</th><th>Methods</th><th>Statuses</th><th>Slowest</th></tr></thead>
        <tbody>${domainRows}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>Top 10 Slowest</h2>
      <table class="data-table">
        <thead><tr><th>ms</th><th>Method</th><th>Status</th><th>URL</th></tr></thead>
        <tbody>${slowestRows}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>Errors <span class="count">${errors.length}</span></h2>
      ${errorHtml}
    </div>

    <div class="section">
      <h2>Interactions <span class="count">${interactionCount}</span></h2>
      ${interactionHtml}
    </div>
  `;
});
