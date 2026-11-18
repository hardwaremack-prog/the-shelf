// Folder locks UI: host controls + viewing-password prompt for everyone else.
// Server enforces everything; this file only presents it.
(function () {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  let status = { isLocal: false, hasPassword: false, areas: [], locked: [], unlocked: true };
  let promptOpen = false;

  const css = document.createElement('style');
  css.textContent = `
  .lk-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px}
  .lk-card{background:var(--ink-deep,#1B1424);color:var(--text,#F0E9E3);border:1px solid var(--divider,#4A3B5C);border-radius:12px;padding:22px;max-width:420px;width:100%;max-height:90vh;overflow:auto;font-family:inherit}
  .lk-card h2{margin:0 0 6px;font-size:18px}
  .lk-card p{margin:0 0 12px;font-size:13px;color:var(--text-muted,#B7ABBA)}
  .lk-card input[type=password],.lk-card input[type=text]{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:8px;border:1px solid var(--divider,#4A3B5C);background:var(--surface,#322542);color:inherit;font-size:14px;margin-bottom:10px}
  .lk-card label.lk-row{display:flex;gap:8px;align-items:center;padding:4px 0;font-size:14px}
  .lk-group{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted,#B7ABBA);margin:10px 0 2px}
  .lk-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
  .lk-btn{padding:8px 14px;border-radius:8px;border:1px solid var(--divider,#4A3B5C);background:transparent;color:inherit;cursor:pointer;font-size:13px}
  .lk-btn.primary{background:var(--accent,#F2B441);color:var(--accent-ink,#2A1D0E);border-color:transparent;font-weight:600}
  .lk-err{color:#E2725B;font-size:13px;min-height:18px}
  .lk-ok{color:#6FCF97;font-size:13px}
  .lk-sidebtn{display:block;width:100%;text-align:left;background:none;border:none;color:inherit;font-size:13px;padding:6px 0;cursor:pointer;opacity:.9}
  .lk-sidebtn:hover{opacity:1}
  .lk-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#322542;color:#F0E9E3;border:1px solid #4A3B5C;border-radius:8px;padding:10px 16px;z-index:99999;font-size:13px}
  `;
  document.head.appendChild(css);

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'lk-toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }
  function overlay(inner) {
    const o = document.createElement('div');
    o.className = 'lk-overlay';
    const c = document.createElement('div');
    c.className = 'lk-card';
    c.appendChild(inner);
    o.appendChild(c);
    o.addEventListener('mousedown', (e) => { if (e.target === o) o.remove(); });
    document.body.appendChild(o);
    return o;
  }
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    Object.assign(e, props || {});
    kids.forEach(k => e.append(k));
    return e;
  }
  async function jpost(url, method, body) {
    const r = await nativeFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let data = {}; try { data = await r.json(); } catch { /* none */ }
    return { ok: r.ok, status: r.status, data };
  }

  // ---- unlock prompt (shown to anyone who isn't the host) ----
  function showUnlock(message) {
    if (promptOpen) return;
    promptOpen = true;
    const pw = h('input', { type: 'password', placeholder: 'Viewing password', autocomplete: 'off' });
    const err = h('div', { className: 'lk-err' });
    const go = h('button', { className: 'lk-btn primary', textContent: 'Unlock (read-only)' });
    const cancel = h('button', { className: 'lk-btn', textContent: 'Cancel' });
    const box = h('div', {}, h('h2', { textContent: '🔒 Locked folder' }),
      h('p', { textContent: message || 'This folder needs the viewing password. Unlocking lets you look, not change anything.' }),
      pw, err, h('div', { className: 'lk-btns' }, go, cancel));
    const o = overlay(box);
    const close = () => { promptOpen = false; o.remove(); };
    cancel.onclick = close;
    o.addEventListener('mousedown', (e) => { if (e.target === o) promptOpen = false; });
    const submit = async () => {
      err.textContent = '';
      const r = await jpost('/api/locks/unlock', 'POST', { password: pw.value });
      if (r.ok) { close(); location.reload(); } else { err.textContent = r.data.error || 'Could not unlock.'; pw.select(); }
    };
    go.onclick = submit;
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    setTimeout(() => pw.focus(), 30);
  }

  // Any request the server turns away because of a lock gets the prompt.
  window.fetch = async function (...args) {
    const res = await nativeFetch(...args);
    if (res.status === 403) {
      try {
        const body = await res.clone().json();
        if (body && body.locked) {
          if (body.readOnly) toast('That folder is locked and read-only.');
          else if (!status.isLocal) showUnlock();
        } else if (body && body.hostOnly) toast(body.error);
      } catch { /* not JSON */ }
    }
    return res;
  };

  // ---- host settings ----
  function showHostSettings() {
    const checks = new Map();
    const groups = {};
    status.areas.forEach(a => (groups[a.group] = groups[a.group] || []).push(a));
    const list = h('div');
    Object.keys(groups).forEach(g => {
      list.append(h('div', { className: 'lk-group', textContent: g }));
      groups[g].forEach(a => {
        const cb = h('input', { type: 'checkbox', checked: (status.configured || []).includes(a.id) });
        checks.set(a.id, cb);
        list.append(h('label', { className: 'lk-row' }, cb, a.label));
      });
    });
    const pw = h('input', { type: 'password', placeholder: status.hasPassword ? 'New password (leave blank to keep)' : 'Choose a viewing password', autocomplete: 'new-password' });
    const msg = h('div', { className: 'lk-err' });
    const save = h('button', { className: 'lk-btn primary', textContent: 'Save' });
    const kick = h('button', { className: 'lk-btn', textContent: 'Lock everyone out now' });
    const off = h('button', { className: 'lk-btn', textContent: 'Remove all locks' });
    const close = h('button', { className: 'lk-btn', textContent: 'Close' });
    const box = h('div', {}, h('h2', { textContent: '🔒 Folder locks' }),
      h('p', { textContent: 'Tick what should need the viewing password. Other devices can look once they enter it, but can never change locked folders — only this computer can. This computer is never asked.' }),
      list, h('div', { className: 'lk-group', textContent: 'Viewing password' }), pw, msg,
      h('div', { className: 'lk-btns' }, save, kick, off, close),
      h('p', { style: 'margin-top:12px', textContent: 'Tip: Tidy Suite runs entirely in each person’s own browser, so it can’t be locked. Backups are host-only while any lock is on.' }));
    const o = overlay(box);
    close.onclick = () => o.remove();
    save.onclick = async () => {
      msg.className = 'lk-err'; msg.textContent = '';
      const body = { areas: [...checks].filter(([, c]) => c.checked).map(([id]) => id) };
      if (pw.value) body.password = pw.value;
      const r = await jpost('/api/locks/config', 'PUT', body);
      if (r.ok) { msg.className = 'lk-ok'; msg.textContent = 'Saved.'; pw.value = ''; await refresh(); }
      else msg.textContent = r.data.error || 'Could not save.';
    };
    kick.onclick = async () => {
      const r = await jpost('/api/locks/lock-everyone', 'POST');
      msg.className = r.ok ? 'lk-ok' : 'lk-err'; msg.textContent = r.ok ? 'Everyone has been signed out of locked folders.' : (r.data.error || 'Failed.');
    };
    off.onclick = async () => {
      if (!confirm('Remove the password and unlock every folder for everyone?')) return;
      const r = await jpost('/api/locks', 'DELETE');
      if (r.ok) { await refresh(); o.remove(); } else { msg.textContent = r.data.error || 'Failed.'; }
    };
  }

  // ---- sidebar entry + lock icons ----
  function renderSidebar() {
    const group = document.querySelector('.power-toggle-group');
    if (!group) return;
    let row = document.getElementById('lkToggleRow');
    if (!row) {
      const cb = h('input', { type: 'checkbox', id: 'lkToggle' });
      row = h('div', { className: 'power-toggle', id: 'lkToggleRow' },
        h('label', { className: 'toggle-switch' }, cb, h('span', { className: 'toggle-slider' })),
        h('span', { id: 'lkToggleLabel' }));
      group.appendChild(row);
      cb.addEventListener('change', async () => {
        const want = cb.checked;
        if (want && (!status.hasPassword || !(status.configured || []).length)) {
          cb.checked = false; showHostSettings(); return;
        }
        const r = await jpost('/api/locks/config', 'PUT', { enabled: want });
        if (!r.ok) cb.checked = !want;
        await refresh();
      });
    }
    row.hidden = !status.isLocal;
    if (status.isLocal) {
      row.querySelector('input').checked = !!(status.enabled && status.hasPassword && (status.configured || []).length);
      row.querySelector('#lkToggleLabel').textContent = row.querySelector('input').checked ? 'Read-only password: on' : 'Read-only password: off';
    }
    let btn = document.getElementById('lkSideBtn');
    if (!btn) {
      btn = h('button', { id: 'lkSideBtn', className: 'lk-sidebtn' });
      group.appendChild(btn);
    }
    if (status.isLocal) {
      btn.hidden = false;
      btn.textContent = '🔒 Folder locks…' + (status.locked.length ? ` (${status.locked.length} locked)` : '');
      btn.onclick = showHostSettings;
    } else if (status.locked.length) {
      btn.hidden = false;
      btn.textContent = status.unlocked ? '🔓 Lock folders again' : '🔒 Unlock folders…';
      btn.onclick = async () => { if (status.unlocked) { await jpost('/api/locks/relock', 'POST'); location.reload(); } else showUnlock(); };
    } else btn.hidden = true;
    markNav();
  }
  function markNav() {
    const labels = new Map(status.areas.map(a => [a.label.toLowerCase(), a.id]));
    const locked = new Set(status.locked);
    document.querySelectorAll('#shelfNav button, #toolNav button, #shelfNav a, #toolNav a').forEach(b => {
      const had = b.querySelector('.lk-icon');
      const clone = b.cloneNode(true);
      clone.querySelectorAll('.lk-icon').forEach(n => n.remove());
      const text = (clone.textContent || '').replace(/[^\w ]/g, '').trim().toLowerCase();
      const id = [...labels].find(([l]) => text === l || text.endsWith(' ' + l))?.[1];
      const want = !!(id && locked.has(id));
      if (want && !had) b.append(h('span', { className: 'lk-icon', textContent: ' \uD83D\uDD12', title: 'Locked' }));
      else if (!want && had) had.remove();
    });
  }
  async function refresh() {
    try {
      const r = await nativeFetch('/api/locks/status');
      if (r.ok) status = await r.json();
    } catch { /* leave as is */ }
    renderSidebar();
  }

  refresh();
  // markNav only touches the DOM when something needs to change, so
  // watching the nav can't feed back on itself.
  ['shelfNav', 'toolNav'].forEach(id => {
    const n = document.getElementById(id);
    if (n) new MutationObserver(() => markNav()).observe(n, { childList: true, subtree: true });
  });
})();
