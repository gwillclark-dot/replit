const REFRESH_MS = 30_000;
const TICK_MS = 1_000;

let currentSchedule = null;

function fmtRelative(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function fmtDuration(sec) {
  if (!sec || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function trackHref(item) {
  const key = item && item.channel;
  return key ? `/track/${encodeURIComponent(key)}` : null;
}

function renderNowPlaying(np) {
  const bar = document.getElementById('np-bar');
  if (!np) {
    setText('np-title', 'silent');
    setText('np-artist', 'no track');
    setText('np-summary', 'queue empty — mac is idle');
    setText('np-status', '—');
    if (bar) bar.style.width = '0%';
    paintSchedule();
    return;
  }
  setText('np-title', np.project || '—');
  const titleLink = document.getElementById('np-title');
  if (titleLink && titleLink.tagName === 'A') {
    titleLink.href = trackHref(np) || '#';
  }
  setText('np-artist', np.channel ? `#${np.channel}` : '—');
  setText('np-summary', np.summary || '—');

  const pill = document.getElementById('np-status');
  if (pill) {
    pill.textContent = np.status || '—';
    pill.className = `status-pill ${np.status || ''}`;
  }

  paintSchedule();
}

function fmtCountdown(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function paintSchedule() {
  const bar = document.getElementById('np-bar');
  const sched = currentSchedule;
  if (!sched || !sched.last_run_at || !sched.interval_seconds) {
    setText('np-elapsed', '—');
    if (bar) bar.style.width = '0%';
    return;
  }
  const last = Date.parse(sched.last_run_at);
  if (!Number.isFinite(last)) {
    setText('np-elapsed', '—');
    if (bar) bar.style.width = '0%';
    return;
  }
  const intervalMs = sched.interval_seconds * 1000;
  const elapsedMs = Date.now() - last;
  const remainingSec = (intervalMs - elapsedMs) / 1000;
  const pct = Math.max(0, Math.min(100, (elapsedMs / intervalMs) * 100));
  if (bar) bar.style.width = `${pct}%`;
  setText('np-elapsed', remainingSec > 0
    ? `next in ${fmtCountdown(remainingSec)}`
    : `overdue ${fmtCountdown(-remainingSec)}`);
}

function renderList(id, items, opts = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  if (!items || !items.length) {
    el.innerHTML = '<li class="empty"><span></span><span class="sub">— empty —</span><span></span></li>';
    return;
  }
  items.forEach((item, i) => {
    const li = document.createElement('li');
    const num = String(i + 1).padStart(2, '0');
    const title = esc(item.project || item.name || '—');
    const sub = esc(item.summary || (item.channel ? `#${item.channel}` : ''));
    const right = opts.showWhen && item.played_at
      ? fmtRelative(item.played_at)
      : (item.status ? `<span class="status-pill ${item.status}">${item.status}</span>` : '');
    const href = trackHref(item);
    const titleHtml = href
      ? `<a class="title" href="${href}">${title}</a>`
      : `<span class="title">${title}</span>`;
    li.innerHTML = `
      <span class="num">${num}</span>
      <span>
        ${titleHtml}
        ${sub ? `<div class="sub">${sub}</div>` : ''}
      </span>
      <span class="right">${right}</span>
    `;
    el.appendChild(li);
  });
}

function renderLibrary(items) {
  const el = document.getElementById('library');
  if (!el) return;
  el.innerHTML = '';
  (items || []).forEach(item => {
    const href = trackHref(item);
    const card = document.createElement(href ? 'a' : 'div');
    card.className = 'lib-card';
    if (href) card.href = href;
    card.innerHTML = `
      <div class="name">${esc(item.project || item.name)}</div>
      <span class="status-pill ${item.status || ''}">${esc(item.status || '—')}</span>
    `;
    el.appendChild(card);
  });
}

function summarizeSignal(sig) {
  const b = sig.body || {};
  if (typeof b === 'string') return b;
  const pick = b.event || b.message || b.summary || b.text || b.title || b.raw;
  if (pick) return String(pick);
  try {
    const compact = JSON.stringify(b);
    return compact.length > 140 ? compact.slice(0, 139) + '…' : compact;
  } catch { return '—'; }
}

function renderSignals(id, signals, { limit } = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  const items = (signals || []).slice(0, limit ?? signals?.length ?? 0);
  if (!items.length) {
    el.innerHTML = '<li class="empty"><span></span><span class="sub">silence on the wire — no transmissions yet</span><span></span></li>';
    return;
  }
  items.forEach((sig, i) => {
    const li = document.createElement('li');
    li.className = 'signal-row';
    const num = String(i + 1).padStart(2, '0');
    const summary = esc(summarizeSignal(sig));
    const source = esc(sig.source || 'unknown');
    const when = sig.received_at ? fmtRelative(sig.received_at) : '';
    li.innerHTML = `
      <span class="num">${num}</span>
      <span>
        <div class="title"><span class="source-pill">${source}</span> ${summary}</div>
      </span>
      <span class="right">${when}</span>
    `;
    el.appendChild(li);
  });
}

async function refreshStatus() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    const data = await res.json();
    currentSchedule = data.schedule || null;
    renderNowPlaying(data.now_playing);
    renderList('up-next', data.up_next);
    renderList('recent', data.recently_played, { showWhen: true });
    renderLibrary(data.library);
    setText('updated', `updated ${fmtRelative(data.updated_at)}`);
  } catch (e) {
    setText('updated', 'offline');
  }
}

async function refreshSignals() {
  const fullEl = document.getElementById('signals-feed');
  const previewEl = document.getElementById('signals-preview');
  if (!fullEl && !previewEl) return;
  try {
    const res = await fetch('/api/signals', { cache: 'no-store' });
    const signals = await res.json();
    renderSignals('signals-feed', signals);
    renderSignals('signals-preview', signals, { limit: 3 });
    if (fullEl && signals.length) {
      const newest = signals[0].received_at;
      setText('updated', `last signal ${fmtRelative(newest)}`);
    } else if (fullEl) {
      setText('updated', 'no transmissions yet');
    }
  } catch (e) {
    if (fullEl) setText('updated', 'offline');
  }
}

async function refresh() {
  await Promise.all([refreshStatus(), refreshSignals()]);
}

refresh();
setInterval(refresh, REFRESH_MS);
setInterval(paintSchedule, TICK_MS);
