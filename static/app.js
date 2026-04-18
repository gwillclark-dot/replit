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

function renderNowPlaying(np) {
  if (!np) {
    setText('np-title', 'silent');
    setText('np-artist', 'no track');
    setText('np-summary', 'queue empty — mac is idle');
    setText('np-elapsed', '0:00');
    setText('np-status', '—');
    document.getElementById('np-bar').style.width = '0%';
    return;
  }
  setText('np-title', np.project || '—');
  setText('np-artist', np.channel ? `#${np.channel}` : '—');
  setText('np-summary', np.summary || '—');

  const elapsed = np.duration_seconds || 0;
  setText('np-elapsed', fmtDuration(elapsed));
  const pct = Math.min(100, (elapsed / 600) * 100);
  document.getElementById('np-bar').style.width = `${pct}%`;

  const pill = document.getElementById('np-status');
  pill.textContent = np.status || '—';
  pill.className = `status-pill ${np.status || ''}`;
}

function renderList(id, items, opts = {}) {
  const el = document.getElementById(id);
  el.innerHTML = '';
  if (!items || !items.length) {
    el.innerHTML = '<li class="empty"><span></span><span class="sub">— empty —</span><span></span></li>';
    return;
  }
  items.forEach((item, i) => {
    const li = document.createElement('li');
    const num = String(i + 1).padStart(2, '0');
    const title = item.project || item.name || '—';
    const sub = item.summary || (item.channel ? `#${item.channel}` : '');
    const right = opts.showWhen && item.played_at
      ? fmtRelative(item.played_at)
      : (item.status ? `<span class="status-pill ${item.status}">${item.status}</span>` : '');
    li.innerHTML = `
      <span class="num">${num}</span>
      <span>
        <div class="title">${title}</div>
        ${sub ? `<div class="sub">${sub}</div>` : ''}
      </span>
      <span class="right">${right}</span>
    `;
    el.appendChild(li);
  });
}

function renderLibrary(items) {
  const el = document.getElementById('library');
  el.innerHTML = '';
  (items || []).forEach(item => {
    const card = document.createElement('div');
    card.className = 'lib-card';
    card.innerHTML = `
      <div class="name">${item.project || item.name}</div>
      <span class="status-pill ${item.status || ''}">${item.status || '—'}</span>
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
