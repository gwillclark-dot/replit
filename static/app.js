const REFRESH_MS = 30_000;

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
  const key = item.channel || item.project || item.name;
  return key ? `/track/${encodeURIComponent(key)}` : '#';
}

function renderNowPlaying(np) {
  const bar = document.getElementById('np-bar');
  if (!np) {
    setText('np-title', 'silent');
    setText('np-artist', 'no track');
    setText('np-summary', 'queue empty — mac is idle');
    setText('np-elapsed', '0:00');
    setText('np-status', '—');
    if (bar) bar.style.width = '0%';
    return;
  }
  setText('np-title', np.project || '—');
  const titleLink = document.getElementById('np-title');
  if (titleLink && titleLink.tagName === 'A') {
    titleLink.href = trackHref(np);
  }
  setText('np-artist', np.channel ? `#${np.channel}` : '—');
  setText('np-summary', np.summary || '—');

  const elapsed = np.duration_seconds || 0;
  setText('np-elapsed', fmtDuration(elapsed));
  const pct = Math.min(100, (elapsed / 600) * 100);
  if (bar) bar.style.width = `${pct}%`;

  const pill = document.getElementById('np-status');
  if (pill) {
    pill.textContent = np.status || '—';
    pill.className = `status-pill ${np.status || ''}`;
  }
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
    li.innerHTML = `
      <span class="num">${num}</span>
      <span>
        <a class="title" href="${href}">${title}</a>
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
    const card = document.createElement('a');
    card.className = 'lib-card';
    card.href = trackHref(item);
    card.innerHTML = `
      <div class="name">${esc(item.project || item.name)}</div>
      <span class="status-pill ${item.status || ''}">${esc(item.status || '—')}</span>
    `;
    el.appendChild(card);
  });
}

async function refresh() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    const data = await res.json();
    renderNowPlaying(data.now_playing);
    renderList('up-next', data.up_next);
    renderList('recent', data.recently_played, { showWhen: true });
    renderLibrary(data.library);
    setText('updated', `updated ${fmtRelative(data.updated_at)}`);
  } catch (e) {
    setText('updated', 'offline');
  }
}

refresh();
setInterval(refresh, REFRESH_MS);

const copyBtn = document.getElementById('copy-embed');
if (copyBtn) {
  copyBtn.addEventListener('click', () => {
    const code = document.getElementById('embed-code');
    if (!code) return;
    navigator.clipboard.writeText(code.textContent).then(() => {
      const prev = copyBtn.textContent;
      copyBtn.textContent = 'copied';
      setTimeout(() => { copyBtn.textContent = prev; }, 1500);
    });
  });
}
