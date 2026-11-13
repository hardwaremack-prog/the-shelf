// The Shelf - Mesh Coms: the text mesh between Shelf boards (Heltec V3/V4 on 900 MHz LoRa and
// 2.4 GHz, plain ESP32 boards on 2.4 GHz), joined through a board on the same network. The
// computer can't send those radio frames itself, so the server passes /api/mesh/... on to the
// board's own Coms (see server.js). Same screen as the boards' Coms tab.
(function () {
  let timer = null, last = '', drafting = false;
  const LEVEL_NAMES = ['Low', 'Normal', 'High'];
  const BAND_NAME = 'Mesh Coms';
  const API = '/api/mesh';
  let gw = null;                                   // the board this goes through
  const NOLORA = false;
  const boardLabel = b => (+b === 32 ? 'ESP32' : 'V' + (b || '?'));
  const sig = r => (r ? r + ' dBm' : '2.4 GHz');   // 0: heard over 2.4 GHz (no signal reading there)
  const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : new Date(t).toLocaleDateString(); };
  const time = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const post = (u, d) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d || {}) });

  function viewing() { return typeof state !== 'undefined' && state.view === 'mesh'; }

  async function refresh(force) {
    if (!viewing()) { clearInterval(timer); timer = null; return; }
    let c, res;
    try { res = await fetch(API); c = await res.json(); } catch { c = { error: 'The Shelf didn\'t answer.' }; res = { ok: false }; }
    if (!res.ok || !c.log) {
      const sig = 'nogw:' + (c.error || '');
      if (!force && sig === last) return;
      last = sig; renderNoBoard(c.error); return;
    }
    const sig = JSON.stringify([c.enabled, c.radio, c.receipts, c.log.length, c.log.length && c.log[c.log.length - 1].id, c.neighbors.length, c.error, c.heard, c.relayed, c.synced, c.receivedBy,
      (c.devices || []).map(d => [d.node, d.name, d.hops, d.batt, d.ro, d.admin, Math.floor((Date.now() - d.at) / 60000)])]);
    if (!force && sig === last) return;
    last = sig;
    render(c);
  }

  function render(c) {
    const content = el('#content');
    const keep = content.querySelector('#comsInput');
    const draft = keep ? keep.value : '';
    const hadFocus = keep && document.activeElement === keep;
    const neigh = c.neighbors.filter(n => n.node !== c.node);
    const devs = (c.devices || []).filter(d => d.node !== c.node).sort((a, b) => b.at - a.at);
    const log = c.log.slice().sort((a, b) => a.t - b.t);
    let day = '';
    const msgs = log.map(m => {
      const d = new Date(m.t).toDateString(); let sep = '';
      if (d !== day) { day = d; sep = `<div class="coms-day">${escapeHtml(d === new Date().toDateString() ? 'Today' : new Date(m.t).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }))}</div>`; }
      const got = (c.receivedBy || {})[m.id] || [];
      const meta = m.mine ? `${time(m.t)} · ${got.length ? '\u2713 Received by ' + got.map(escapeHtml).join(', ') : 'sent'}` : `${time(m.t)} · ${m.hops ? m.hops + (m.hops === 1 ? ' hop' : ' hops') : 'direct'}${m.rssi !== undefined ? ' · ' + sig(m.rssi) : ''}${m.synced ? ' · caught up' : ''}`;
      return sep + `<div class="coms-msg ${m.mine ? 'mine' : ''}"><div class="who">${escapeHtml(m.mine ? 'You' : (m.from || 'Unknown'))}</div><div class="txt">${escapeHtml(m.text)}</div><div class="meta">${meta}</div></div>`;
    }).join('');
    content.innerHTML = `
      <div class="coms">
        ${gatewayBar()}
        <div class="coms-card">
          <div class="coms-top">
            <label class="toggle-switch"><input type="checkbox" id="comsToggle" ${c.enabled ? 'checked' : ''}><span class="toggle-slider"></span></label>
            <span class="power-label">${c.enabled ? (c.radio ? BAND_NAME + ' is on' : 'Starting the radio…') : BAND_NAME + ' is off'}</span>
            <span class="sub">${c.enabled ? 'This board is on the mesh and relays messages for everyone else on it.' : 'Turn it on to join the mesh. Any Shelf board with Coms on can talk, and each one relays for the others.'}</span>
          </div>
          ${c.enabled ? `
          <div class="coms-chips">
            <span class="coms-chip">You are <b>${escapeHtml(c.name)}</b></span>
            ${c.hasLora === false ? '' : `<span class="coms-chip">${c.freq.toFixed(1)} MHz${c.lora ? '' : ' (off)'}</span>`}
            <span class="coms-chip" title="Boards hear each other over 2.4 GHz only on the same Wi-Fi channel">2.4 GHz${c.wifi ? ' · channel ' + c.channel : ' (off)'}</span>
            <span class="coms-chip">Heard <b>${c.heard}</b></span>
            <span class="coms-chip">Relayed <b>${c.relayed}</b></span>
            <span class="coms-chip">Caught up <b>${c.synced}</b></span>
            <button class="coms-chip coms-receipts ${c.receipts ? 'on' : ''}" id="comsReceipts" title="When on, this board tells senders it got their message">${c.receipts ? '\u2713 Sending \u201creceived\u201d' : 'Not sending \u201creceived\u201d'}</button>
          </div>
          <div class="coms-devs-head"><span>Boards on the mesh</span><button class="coms-chip coms-who" id="comsWho" title="Ask every board on the mesh to say hello">Refresh</button></div>
          <div class="coms-devs">${devs.length ? devs.map(d => `<button class="coms-dev" data-node="${d.node}">
              <span class="cd-chip">${boardLabel(d.board)}</span>
              <span class="cd-main"><b>${escapeHtml(d.name || d.node)}</b><small>${d.hops ? d.hops + (d.hops === 1 ? ' hop' : ' hops') : 'direct · ' + sig(d.rssi)} · ${d.batt < 0 ? 'USB' : d.batt + '%'} · ${ago(d.at)}${d.ro ? ' · 🔒' : ''}</small></span>
              <span class="cd-go">${d.admin ? 'Manage ›' : '<span class="cd-none" title="Set an admin password on that board to manage it from here">No password</span>'}</span></button>`).join('')
            : '<div class="coms-neigh" style="margin:0">No boards yet. Each board says hello when it comes on and every 15 minutes. Tap Refresh to ask now.</div>'}</div>
          <div class="coms-neigh">${neigh.length ? 'In range: ' + neigh.map(n => `<b style="color:var(--text)">${escapeHtml(n.name || n.node)}</b> (${sig(n.rssi)}, ${ago(n.at)})`).join(', ') : 'No other boards heard yet. They show up here as soon as one transmits.'}</div>
          <details style="margin-top:10px"><summary style="cursor:pointer;color:var(--text-muted);font-size:13px">Settings</summary>
            <div class="coms-settings">
              <label>Your name on the mesh<input id="comsName" maxlength="16" value="${escapeHtml(c.name)}"></label>
              ${c.hasLora === false ? '' : `<label>Transmit power<select id="comsLevel">${LEVEL_NAMES.map((l, i) => `<option value="${i}" ${i === c.level ? 'selected' : ''}>${l} (~${(c.levels || [11, 20, 27])[i]} dBm)</option>`).join('')}</select></label>`}
              <button class="coms-btn secondary" id="comsSave">Save</button>
              <button class="coms-btn secondary" id="comsClear">Clear log</button>
            </div>
          </details>` : ''}
          ${c.error ? `<div class="coms-err">${escapeHtml(c.error)}</div>` : ''}
        </div>
        ${c.enabled ? `
          <div class="coms-log" id="comsLog">${msgs || '<div class="coms-off" style="margin:auto;text-align:center">No messages in the last while.<br>Anything said on the mesh shows up here, and when this board joins, nearby boards fill in the last 12 hours.</div>'}</div>
          <form class="coms-compose" id="comsForm"><input id="comsInput" maxlength="180" placeholder="Message everyone on the mesh…" autocomplete="off"><button type="submit">Send</button></form>
          <div class="coms-count" id="comsCount"></div>
        ` : `<div class="coms-card coms-off">
            ${NOLORA ? `<b>How it works:</b> Shelf boards talk to each other directly over 2.4 GHz (ESP-NOW, the ESP32's own board-to-board radio frames), with no router in between. Phones can stay joined to a board's own Wi-Fi the whole time. Each board re-sends what it hears, so messages hop from board to board as far as the mesh reaches, and a board that joins late is caught up on the last 12 hours by its neighbors. Heltec V3 and V4 boards join in too and carry messages on to their 900 MHz mesh.<br><br>
            Boards hear each other only on the same Wi-Fi channel. Boards on their own Wi-Fi all use channel 1; a board joined to a home Wi-Fi uses that router's channel. Range is about that of Wi-Fi: a house, or a few hundred feet in the open.`
            : `<b>How it works:</b> every Heltec V3 and V4 running The Shelf has a 900 MHz LoRa radio, and every Shelf board (plain ESP32 boards too) also talks over 2.4 GHz. With Coms on, boards in range hear each other directly, and each board re-sends what it hears, on both, so messages hop from board to board as far as the mesh reaches. A board that joins late is caught up on the last 12 hours by its neighbors. No internet or Wi-Fi network needed between boards.<br><br>
            Fit the LoRa antenna before switching it on. It uses its own channel (915.0 MHz), separate from Meshtastic. Over 2.4 GHz, boards hear each other only on the same Wi-Fi channel (channel 1 on their own Wi-Fi).`}</div>`}
      </div>`;
    const logEl = content.querySelector('#comsLog');
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
    content.querySelector('#comsToggle').addEventListener('change', async e => { await post(API + '/toggle', { on: e.target.checked }); last = ''; setTimeout(() => refresh(true), 400); });
    const input = content.querySelector('#comsInput');
    if (input) {
      input.value = draft;
      if (hadFocus) input.focus();
      const count = () => { const n = new TextEncoder().encode(input.value).length; content.querySelector('#comsCount').textContent = n ? `${n}/180` : ''; };
      input.addEventListener('input', count); count();
      content.querySelector('#comsForm').addEventListener('submit', async e => {
        e.preventDefault();
        const text = input.value.trim(); if (!text) return;
        if (new TextEncoder().encode(text).length > 180) { alert('That’s too long for one radio message (180 characters max).'); return; }
        input.value = '';
        const r = await post(API + '/send', { text });
        if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || 'Couldn’t send.'); input.value = text; }
        last = ''; refresh(true);
      });
    }
    const who = content.querySelector('#comsWho');
    if (who) who.addEventListener('click', async () => { who.textContent = 'Asking…'; await post(API + '/remote/who'); setTimeout(() => { who.textContent = 'Refresh'; }, 8000); });
    content.querySelectorAll('.coms-dev').forEach(b => b.addEventListener('click', () => {
      const d = devs.find(x => x.node === b.dataset.node);
      if (d) openRemote(d);
    }));
    const rc = content.querySelector('#comsReceipts');
    if (rc) rc.addEventListener('click', async () => { await post(API + '/settings', { receipts: !c.receipts }); last = ''; refresh(true); });
    const save = content.querySelector('#comsSave');
    if (save) save.addEventListener('click', async () => { await post(API + '/settings', { name: content.querySelector('#comsName').value, level: Number(content.querySelector('#comsLevel').value) }); last = ''; refresh(true); });
    const clear = content.querySelector('#comsClear');
    if (clear) clear.addEventListener('click', async () => { if (confirm('Clear the message log on this board?')) { await post(API + '/clear'); last = ''; refresh(true); } });
  }

  // ---- Remote admin over 900MHz: connect to a board with its admin password ----
  const SHELVES = ['Pictures', 'Music', 'MIDI', 'Videos', 'Games', 'Programs', 'Books'];
  function openRemote(dev) {
    const R = { dev, session: null, busy: null, st: null, out: '', err: '' };
    const ov = document.createElement('div');
    ov.className = 'rm-overlay';
    document.body.appendChild(ov);
    const close = () => { if (R.session) post(API + '/remote/disconnect', { session: R.session }); ov.remove(); };
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    const nm = escapeHtml(dev.name || dev.node);
    const up = s => s > 86400 ? Math.floor(s / 86400) + 'd ' + Math.floor(s % 86400 / 3600) + 'h' : Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm';
    const fmtB = b => b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';

    async function waitFor(req, label) {
      const t0 = Date.now();
      R.busy = label; draw();
      for (;;) {
        await new Promise(r => setTimeout(r, 1000));
        if (!document.body.contains(ov)) return null;
        let j; try { j = await fetch(API + '/remote/result?req=' + req).then(r => r.json()); } catch { continue; }
        if (j.state === 'waiting') { R.busy = `${label}… ${Math.round((Date.now() - t0) / 1000)} s`; drawBusy(); continue; }
        R.busy = null;
        return j;
      }
    }
    async function cmd(n, arg, label, confirmText) {
      if (R.busy) return;
      if (confirmText && !confirm(confirmText)) return;
      R.err = '';
      const r = await post(API + '/remote/cmd', { session: R.session, cmd: n, arg: arg == null ? '' : String(arg) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { R.err = j.error || 'Couldn’t send that.'; if (r.status === 401) R.session = null; draw(); return; }
      const t0 = Date.now();
      const res = await waitFor(j.req, label + ' — waiting for ' + (dev.name || 'it'));
      if (!res) return;
      if (res.state === 'failed') R.err = res.error;
      else if (res.status) R.st = res.status;
      if (res.text) R.out = res.text + (n === 10 ? ` (answered in ${Math.round((Date.now() - t0) / 1000)} s)` : '');
      draw();
    }
    async function connect(pw) {
      R.err = '';
      const r = await post(API + '/remote/connect', { node: dev.node, password: pw });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { R.err = j.error || 'Couldn’t connect.'; draw(); return; }
      R.session = j.session;
      const res = await waitFor(j.req, 'Asking ' + (dev.name || 'it'));
      if (!res) return;
      if (res.state === 'failed') { R.err = res.error; post(API + '/remote/disconnect', { session: R.session }); R.session = null; }
      else R.st = res.status;
      draw();
    }
    function drawBusy() { const b = ov.querySelector('.rm-busy'); if (b) b.textContent = R.busy || ''; else draw(); }
    function draw() {
      const s = R.st;
      let body;
      if (!R.session || !s) {
        body = `<p class="rm-sub">Sends a signed request over ${NOLORA ? '2.4 GHz' : 'the mesh'}${dev.hops ? `, through ${dev.hops} other ${dev.hops === 1 ? 'board' : 'boards'}` : ''}. Nothing is encrypted, so anyone listening can read the commands and replies, but only someone with that board's admin password can give them.</p>
          ${R.busy ? '' : `<input type="password" class="rm-input" id="rmPw" placeholder="${nm}'s admin password" autocomplete="current-password">
          <div class="rm-row"><button type="button" class="coms-btn secondary" data-close>Cancel</button><button class="coms-btn" id="rmGo">Connect</button></div>`}`;
      } else {
        const kv = [['Board', `${escapeHtml(boardLabel(s.b))} · v${escapeHtml(s.fw)}`], ['Battery', s.bat < 0 ? 'On USB power' : s.bat + '%'], ['Up for', s.up != null ? up(s.up) : '—'],
          ['Wi-Fi', escapeHtml(s.w || '—')], ['Address', escapeHtml(s.ip || '—') + (s.cl ? ` · ${s.cl} connected` : '')], ['Storage', `${s.st === 'SD' ? 'microSD' : 'Board flash'}` + (s.fm != null ? ` · ${fmtB(s.fm * 1e6)} free` : '')],
          ['Mode', s.ro ? '🔒 Read-only' : 'Anyone can make changes'], ['Screen', s.scr ? 'On' : 'Asleep'],
          ['On the mesh', `${escapeHtml(s.cm || dev.name || '')} · ${LEVEL_NAMES[s.lv]} (~${(s.b === '3' ? [11, 17, 22] : [11, 20, 27])[s.lv]} dBm)` + (s.mb != null ? ` · knows ${s.mb} ${s.mb === 1 ? 'board' : 'boards'}` : '')],
          ['Heard / relayed', (s.hd != null ? `${s.hd} / ${s.rl}` : '—') + (s.rc ? ' · sends receipts' : '')]];
        const dis = R.busy ? 'disabled' : '';
        body = `<div class="rm-kv">${kv.map(r => `<div><span>${r[0]}</span><span>${r[1]}</span></div>`).join('')}</div>
          <div class="rm-grid">
            <div class="rm-sec"><label>Mode</label><div class="rm-seg"><button ${dis} class="${s.ro ? 'on' : ''}" data-c="2" data-a="1">Read-only</button><button ${dis} class="${s.ro ? '' : 'on'}" data-c="2" data-a="0">Anyone can change</button></div></div>
            <div class="rm-sec"><label>Screen</label><div class="rm-seg"><button ${dis} class="${s.scr ? 'on' : ''}" data-c="4" data-a="1">Wake</button><button ${dis} class="${s.scr ? '' : 'on'}" data-c="4" data-a="0">Sleep</button></div></div>
            <div class="rm-sec"><label>Transmit power</label><div class="rm-seg">${LEVEL_NAMES.map((l, i) => `<button ${dis} class="${i === s.lv ? 'on' : ''}" data-c="5" data-a="${i}">${l}</button>`).join('')}</div></div>
            <div class="rm-sec"><label>"Received" receipts</label><div class="rm-seg"><button ${dis} class="${s.rc ? 'on' : ''}" data-c="6" data-a="1">On</button><button ${dis} class="${s.rc ? '' : 'on'}" data-c="6" data-a="0">Off</button></div></div>
            <div class="rm-sec"><label>Name on the mesh</label><div class="rm-inline"><input id="rmName" maxlength="16" value="${escapeHtml(s.cm || '')}"><button ${dis} class="coms-btn secondary" id="rmRename">Rename</button></div></div>
            <div class="rm-sec"><label>Look in a shelf</label><div class="rm-inline"><select id="rmShelf">${SHELVES.map(x => `<option>${x}</option>`).join('')}</select><button ${dis} class="coms-btn secondary" id="rmList">List files</button></div></div>
          </div>
          ${R.out ? `<div class="rm-out">${escapeHtml(R.out)}</div>` : ''}
          <div class="rm-row rm-wrap">
            <button ${dis} class="coms-btn secondary" data-c="1">Refresh</button>
            <button ${dis} class="coms-btn secondary" data-c="10">Ping</button>
            <button ${dis} class="coms-btn secondary" data-c="7" data-confirm="Switch ${nm} to its own Wi-Fi? It restarts, and stays on the mesh.">Its own Wi-Fi</button>
            <button ${dis} class="coms-btn secondary" data-c="8" data-confirm="Switch ${nm} back to its home Wi-Fi? It restarts, and stays on the mesh.">Home Wi-Fi</button>
            <button ${dis} class="coms-btn secondary rm-bad" data-c="3" data-confirm="Restart ${nm}?">Restart</button>
            <span style="flex:1"></span>
            <button class="coms-btn secondary" data-close>Disconnect</button>
          </div>`;
      }
      ov.innerHTML = `<div class="rm-box"><div class="rm-head"><span class="cd-chip">V${dev.board || '?'}</span><h3>${nm}</h3><button class="rm-x" data-close title="Close">&times;</button></div>
        ${body}<div class="rm-busy">${R.busy ? escapeHtml(R.busy) : ''}</div><div class="rm-err">${escapeHtml(R.err)}</div></div>`;
      ov.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
      const go = ov.querySelector('#rmGo'), pw = ov.querySelector('#rmPw');
      if (go) { go.onclick = () => { if (pw.value) connect(pw.value); }; pw.onkeydown = e => { if (e.key === 'Enter' && pw.value) connect(pw.value); }; setTimeout(() => pw.focus(), 30); }
      ov.querySelectorAll('[data-c]').forEach(b => b.onclick = () => cmd(Number(b.dataset.c), b.dataset.a, b.textContent.trim(), b.dataset.confirm));
      const rn = ov.querySelector('#rmRename'); if (rn) rn.onclick = () => cmd(9, ov.querySelector('#rmName').value.trim(), 'Renaming');
      const ls = ov.querySelector('#rmList'); if (ls) ls.onclick = () => { R.out = ''; cmd(11, ov.querySelector('#rmShelf').value, 'Listing ' + ov.querySelector('#rmShelf').value); };
    }
    draw();
  }

  function gatewayBar() {
    if (!gw || !gw.gateway) return '';
    const me = (gw.candidates || []).find(x => x.ip === gw.gateway);
    return `<div class="coms-gw">Through the board <b>${escapeHtml(me ? me.name : gw.gateway)}</b> (${escapeHtml(gw.gateway)})${gw.manual ? '' : ', found on your network'} &middot; <button class="link-btn" id="meshGwChange">Change</button></div>`;
  }
  async function loadGateway() { try { gw = await fetch('/api/mesh-gateway').then(r => r.json()); } catch { gw = null; } }
  function renderNoBoard(err) {
    const content = el('#content');
    const cands = (gw && gw.candidates) || [];
    content.innerHTML = `<div class="coms"><div class="coms-card coms-off">
        <b>No Shelf board to go through.</b><br>${escapeHtml(err || '')}<br><br>
        Mesh Coms on a computer goes through a Heltec or ESP32 board running The Shelf on the same Wi-Fi (the board does the radio part).
        ${cands.length ? `<div style="margin-top:10px">Boards this Shelf has met:</div>${cands.map(b => `<button class="coms-chip coms-gw-pick" data-ip="${escapeHtml(b.ip)}">${escapeHtml(b.name)} &middot; ${escapeHtml(b.ip)}</button>`).join(' ')}` : ''}
        <form id="meshGwForm" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><input id="meshGwIp" placeholder="Board's address, e.g. 10.0.0.126" style="flex:1;min-width:180px"><button class="coms-btn" type="submit">Use this board</button></form>
      </div></div>`;
    const use = async ip => { await post('/api/mesh-gateway', { gateway: ip }); await loadGateway(); last = ''; refresh(true); };
    content.querySelectorAll('.coms-gw-pick').forEach(b => b.addEventListener('click', () => use(b.dataset.ip)));
    content.querySelector('#meshGwForm').addEventListener('submit', e => { e.preventDefault(); const ip = content.querySelector('#meshGwIp').value.trim(); if (ip) use(ip); });
  }
  document.addEventListener('click', async e => {
    if (!e.target.closest || !e.target.closest('#meshGwChange')) return;
    const cands = (gw && gw.candidates) || [];
    const ip = prompt('Go through which board? Type its address' + (cands.length ? ' (' + cands.map(b => b.name + ' ' + b.ip).join(', ') + ')' : '') + ', or leave it empty to pick one by itself.', gw && gw.manual ? gw.gateway : '');
    if (ip === null) return;
    await post('/api/mesh-gateway', { gateway: ip.trim() }); await loadGateway(); last = ''; refresh(true);
  });

  window.loadMeshView = async function () {
    await loadGateway();
    setToolHeader(BAND_NAME, 'A simple radio mesh between Shelf boards', null, null);
    last = '';
    refresh(true);
    clearInterval(timer);
    timer = setInterval(() => { if (document.activeElement && (document.activeElement.id === 'comsName' || document.activeElement.id === 'meshGwIp')) return; refresh(false); }, 2000);
  };
})();
