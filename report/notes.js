/**
 * Site Notes report — everything recorded under site:* keys, grouped by domain.
 *
 * Records written as { facts: { name: { v, verifiedAt } }, log: [ { t, note } ] } are
 * rendered structurally. Anything else is shown as raw JSON rather than dropped: a note
 * saved in an older shape is still a note, and hiding it would misreport coverage.
 */

const STALE_DAYS = 90;

function daysSince(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function parse(value) {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_) { return value; }
  }
  return value;
}

function renderFacts(facts) {
  const wrap = document.createDocumentFragment();
  wrap.appendChild(el('div', 'subhead', 'Facts'));
  for (const [name, entry] of Object.entries(facts)) {
    const row = el('div', 'fact');
    const isObj = entry && typeof entry === 'object' && !Array.isArray(entry);
    const value = isObj && 'v' in entry ? entry.v : entry;
    const verifiedAt = isObj ? entry.verifiedAt : null;
    const age = verifiedAt ? daysSince(verifiedAt) : null;
    if (age != null && age > STALE_DAYS) row.classList.add('fact-stale');

    row.appendChild(el('div', 'fact-name', name));
    const v = el('div', 'fact-value');
    v.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (verifiedAt) {
      v.appendChild(el('span', 'fact-verified',
        age == null ? `  verified ${verifiedAt}` : `  verified ${verifiedAt} · ${age}d ago`));
    }
    row.appendChild(v);
    wrap.appendChild(row);
  }
  return wrap;
}

function renderLog(log) {
  const wrap = document.createDocumentFragment();
  wrap.appendChild(el('div', 'subhead', `Log (${log.length})`));
  for (const entry of [...log].reverse()) {
    const row = el('div', 'log-entry');
    row.appendChild(el('div', 'log-date', entry && entry.t ? entry.t : '—'));
    row.appendChild(el('div', 'log-note',
      entry && entry.note ? entry.note : JSON.stringify(entry)));
    wrap.appendChild(row);
  }
  return wrap;
}

function renderRecord(key, value) {
  const rec = el('div', 'record');
  rec.appendChild(el('div', 'record-key', key));
  const data = parse(value);

  if (!data || typeof data !== 'object') {
    rec.appendChild(el('div', 'raw', String(data)));
    return rec;
  }

  let structured = false;
  if (data.facts && typeof data.facts === 'object') {
    rec.appendChild(renderFacts(data.facts));
    structured = true;
  }
  if (Array.isArray(data.log) && data.log.length) {
    rec.appendChild(renderLog(data.log));
    structured = true;
  }
  if (!structured) {
    // Older / freeform shape — show it whole rather than pretend it is empty.
    rec.appendChild(el('div', 'raw', JSON.stringify(data, null, 2)));
  }
  return rec;
}

function countFacts(data) {
  if (!data || typeof data !== 'object') return 0;
  if (data.facts && typeof data.facts === 'object') return Object.keys(data.facts).length;
  return Object.keys(data).filter(k => k !== 'log').length;
}

function newestDate(data) {
  let newest = data && data.savedAt ? data.savedAt : null;
  if (data && Array.isArray(data.log)) {
    for (const e of data.log) if (e && e.t && (!newest || e.t > newest)) newest = e.t;
  }
  return newest;
}

chrome.storage.local.get(null).then((all) => {
  const content = document.getElementById('content');
  const meta = document.getElementById('meta');
  content.replaceChildren();

  const byDomain = new Map();
  for (const key of Object.keys(all).sort()) {
    if (!key.startsWith('site:')) continue;
    const domain = key.slice(5).split(':')[0];
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push([key, all[key]]);
  }

  let totalFacts = 0, totalLog = 0;
  for (const records of byDomain.values()) {
    for (const [, v] of records) {
      const d = parse(v);
      totalFacts += countFacts(d);
      if (d && Array.isArray(d.log)) totalLog += d.log.length;
    }
  }

  meta.replaceChildren(
    el('span', null, `${byDomain.size} site${byDomain.size === 1 ? '' : 's'}`),
    el('span', null, `${totalFacts} fact${totalFacts === 1 ? '' : 's'}`),
    el('span', null, `${totalLog} log entr${totalLog === 1 ? 'y' : 'ies'}`),
  );

  if (byDomain.size === 0) {
    content.appendChild(el('div', 'empty', 'Nothing recorded yet.'));
    return;
  }

  for (const [domain, records] of [...byDomain.entries()].sort()) {
    const site = el('div', 'site');
    const head = el('div', 'site-head');
    head.appendChild(el('h2', null, domain));

    let facts = 0, logs = 0, newest = null;
    for (const [, v] of records) {
      const d = parse(v);
      facts += countFacts(d);
      if (d && Array.isArray(d.log)) logs += d.log.length;
      const n = newestDate(d);
      if (n && (!newest || n > newest)) newest = n;
    }
    head.appendChild(el('span', 'tally',
      `${records.length} record${records.length === 1 ? '' : 's'} · ${facts} facts · ${logs} log`));
    if (newest) {
      const age = daysSince(newest);
      head.appendChild(el('span', 'age', age == null ? newest : `updated ${newest} · ${age}d ago`));
    }
    site.appendChild(head);

    for (const [key, value] of records) site.appendChild(renderRecord(key, value));
    content.appendChild(site);
  }
}).catch((err) => {
  document.getElementById('content').replaceChildren(
    el('div', 'empty', `Could not read storage: ${err.message}`));
});
