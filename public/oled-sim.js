// The Shelf boards' little screen, simulated on the Home page (under Quick links). On a computer it
// shows this computer; on a board (handy when it has no screen of its own) it shows the board.
//
// The same pages the ESP32 and Heltec boards show on their 128x64 OLED, drawn pixel for pixel
// with the boards' own fonts (oled-sim-data.js, made from the firmware): this computer's
// status, the song playing here, a watch face, the sunlit earth, a big clock, the outside
// temperature over the last 4 days, today's affirmation and the color of the day.
// Click it once to stay on a page (click again to let them turn); double-click for the next page.
(function () {
  'use strict';
  const W = 128, H = 64;
  const F = window.OLED_FONTS || {};
  const buf = new Uint8Array(W * H);
  let color = 1, font = null;
  const WDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---- a little U8g2
  const px = (x, y) => { x |= 0; y |= 0; if (x >= 0 && x < W && y >= 0 && y < H) buf[y * W + x] = color; };
  const hline = (x, y, w) => { for (let i = 0; i < w; i++) px(x + i, y); };
  const vline = (x, y, h) => { for (let i = 0; i < h; i++) px(x, y + i); };
  const box = (x, y, w, h) => { for (let j = 0; j < h; j++) hline(x, y + j, w); };
  const frame = (x, y, w, h) => { hline(x, y, w); hline(x, y + h - 1, w); vline(x, y, h); vline(x + w - 1, y, h); };
  function line(x0, y0, x1, y1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) { px(x0, y0); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  }
  function circle(cx, cy, r) {
    let x = r, y = 0, e = 1 - r;
    while (x >= y) {
      [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]].forEach(([a, b]) => px(cx + a, cy + b));
      y++; if (e < 0) e += 2 * y + 1; else { x--; e += 2 * (y - x) + 1; }
    }
  }
  function disc(cx, cy, r) {
    let x = r, y = 0, e = 1 - r;
    while (x >= y) {
      hline(cx - x, cy + y, 2 * x + 1); hline(cx - x, cy - y, 2 * x + 1);
      hline(cx - y, cy + x, 2 * y + 1); hline(cx - y, cy - x, 2 * y + 1);
      y++; if (e < 0) e += 2 * y + 1; else { x--; e += 2 * (y - x) + 1; }
    }
  }
  function rframe(x, y, w, h, r) {
    hline(x + r, y, w - 2 * r); hline(x + r, y + h - 1, w - 2 * r); vline(x, y + r, h - 2 * r); vline(x + w - 1, y + r, h - 2 * r);
    for (let a = 0; a <= 90; a += 6) {
      const c = Math.cos(a * Math.PI / 180) * r, s = Math.sin(a * Math.PI / 180) * r;
      px(x + r - c, y + r - s); px(x + w - 1 - r + c, y + r - s); px(x + r - c, y + h - 1 - r + s); px(x + w - 1 - r + c, y + h - 1 - r + s);
    }
  }
  function triangle(x0, y0, x1, y1, x2, y2) {
    const minY = Math.min(y0, y1, y2), maxY = Math.max(y0, y1, y2);
    const ed = [[x0, y0, x1, y1], [x1, y1, x2, y2], [x2, y2, x0, y0]];
    for (let y = minY; y <= maxY; y++) {
      const xs = [];
      ed.forEach(([ax, ay, bx, by]) => { if ((y >= ay && y <= by) || (y >= by && y <= ay)) { if (ay === by) xs.push(ax, bx); else xs.push(ax + (bx - ax) * (y - ay) / (by - ay)); } });
      if (xs.length) { const a = Math.round(Math.min(...xs)), b = Math.round(Math.max(...xs)); hline(a, y, b - a + 1); }
    }
    line(x0, y0, x1, y1); line(x1, y1, x2, y2); line(x2, y2, x0, y0);
  }
  const setFont = n => { font = F[n] || null; };
  const code = ch => { const c = ch.charCodeAt(0); return c === 0xB0 || c === 0xB7 ? c : c < 32 || c > 126 ? 63 : c; };
  function glyph(ch) { return font && (font.g[code(ch)] || font.g[63]); }
  function strWidth(s) {
    if (!font) return 0;
    let w = 0; const cs = [...String(s)];
    cs.forEach((ch, i) => { const g = glyph(ch); if (!g) return; w += i === cs.length - 1 ? Math.max(g[0], g[1] + g[2]) : g[0]; });
    return w;
  }
  function drawStr(x, y, s) {
    if (!font) return;
    for (const ch of String(s)) {
      const g = glyph(ch); if (!g) continue;
      const [adv, xo, w, rows] = g;
      rows.forEach((bits, r) => { for (let i = 0; i < w; i++) if (Math.floor(bits / Math.pow(2, w - 1 - i)) % 2) px(x + xo + i, y - font.a + r); });
      x += adv;
    }
  }

  // ---- what the pages show
  let scrolling = false;
  const SCROLL = 30;
  const passMs = tw => tw <= 128 ? 0 : 1500 + (tw - 128) * 1000 / SCROLL + 1500;
  function drawPass(y, t, el) {
    const tw = strWidth(t);
    if (tw <= 128) { drawStr((128 - tw) >> 1, y, t); return; }
    scrolling = true;
    const off = el < 1500 ? 0 : Math.min(Math.floor((el - 1500) * SCROLL / 1000), tw - 128);
    drawStr(-off, y, t);
  }
  function drawLoop(y, t, el) {
    const tw = strWidth(t);
    if (tw <= 128) { drawStr((128 - tw) >> 1, y, t); return; }
    scrolling = true;
    const span = tw + 40, off = el < 1500 ? 0 : Math.floor((el - 1500) * SCROLL / 1000) % span;
    drawStr(-off, y, t); drawStr(span - off, y, t);
  }
  function header(t) { setFont('f5x7'); drawStr((128 - strWidth(t)) >> 1, 7, t); hline(0, 10, 128); }
  const ampm = d => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  const plain = s => String(s || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7e°·]/g, '');

  // this computer, or the board this page comes from (a board without a screen of its own)
  const info = { host: location.hostname || 'this computer', ip: '', peers: 0 };
  let board = null;                                  // /api/board/info, on a board
  function loadInfo() {
    fetch('/api/board/info', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { if (j && j.board) board = j; }).catch(() => {});
    fetch('/api/network-info').then(r => r.json()).then(j => { info.ip = (j.ips && j.ips[0]) || ''; info.port = j.port; }).catch(() => {});
    fetch('/api/messaging/peers').then(r => r.json()).then(j => { info.peers = Array.isArray(j) ? j.length : (j.peers || []).length; }).catch(() => {});
  }
  const fmtShort = b => b >= 1e9 ? (b / 1e9).toFixed(1) + 'GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + 'MB' : Math.round(b / 1e3) + 'KB';
  function drawBoardStatus() {                       // as the board's own screen draws it
    const b = board, short = String(b.board).replace(/^Heltec /, '');
    setFont('helvB08'); drawStr(0, 9, 'THE SHELF');
    let x = strWidth('THE SHELF') + 3;
    setFont('f5x7'); drawStr(x, 9, short); x += strWidth(short) + 4;
    drawStr(x, 9, b.storage === 'microSD card' ? 'SD' : 'FLASH');
    setFont('f4x6'); drawStr(128 - strWidth('USB'), 8, 'USB');
    hline(0, 12, 128);
    setFont('f6x10');
    let l1, l2, bottom;
    if (b.ssid) { l1 = b.host + '.local'; l2 = `Wi-Fi ${b.rssi} dBm`; bottom = 'IP ' + b.ip; }
    else if (b.ap) { l1 = 'WiFi ' + b.apName; l2 = b.apOpen ? 'Open network' : 'Password: ' + (b.apPass || ''); bottom = 'IP ' + b.ip; }
    else { l1 = 'Connecting Wi-Fi...'; l2 = b.homeSsid || ''; bottom = b.board + ' v' + b.fw; }
    if (strWidth(l1) > 128) setFont('f5x7');
    drawStr(0, 24, l1); setFont('f6x10'); drawStr(0, 35, l2);
    if (b.total) {
      frame(0, 39, 64, 7); box(1, 40, Math.floor(b.used * 62 / b.total), 5);
      setFont('f5x7'); const fr = fmtShort(b.total - b.used) + ' free'; drawStr(128 - strWidth(fr), 46, fr);
    }
    setFont('f6x10'); drawStr(0, 62, bottom);
  }
  function drawTemp() {                              // the board's CPU temperature
    const c = board.temp;
    header('CPU TEMPERATURE');
    rframe(8, 13, 9, 26, 4); circle(12, 41, 6); disc(12, 41, 4);
    color = 0; box(9, 35, 7, 4); color = 1;
    const lvl = Math.max(2, Math.min(20, Math.floor((c - 20) * 20 / 70))); box(10, 37 - lvl, 5, lvl + 3);
    setFont('helvB18'); drawStr(30, 36, Math.round(c) + '\u00b0C');
    setFont('helvB10'); const f = Math.round(c * 9 / 5 + 32) + '\u00b0F'; drawStr(128 - strWidth(f), 36, f);
    const up = Math.floor(board.uptime / 60), u = up >= 1440 ? `Up ${Math.floor(up / 1440)}d ${Math.floor(up % 1440 / 60)}h` : `Up ${Math.floor(up / 60)}h ${up % 60}m`;
    setFont('f5x7'); drawStr((128 - strWidth(u)) >> 1, 55, u);
    const m = `${Math.floor(board.heap / 1024)} KB free \u00b7 ${board.cpuMhz || 240} MHz`; drawStr((128 - strWidth(m)) >> 1, 63, m);
  }
  function drawStatus() {
    if (board) { drawBoardStatus(); return; }
    setFont('helvB08'); drawStr(0, 9, 'THE SHELF');
    let x = strWidth('THE SHELF') + 3;
    setFont('f5x7'); drawStr(x, 9, 'PC');
    setFont('f4x6'); drawStr(128 - strWidth('ON'), 8, 'ON');
    hline(0, 12, 128);
    setFont('f6x10');
    let h = info.ip ? `${info.ip}:${info.port || location.port || 8080}` : location.host;
    if (strWidth(h) > 128) setFont('f5x7');
    drawStr(0, 24, h);
    setFont('f6x10');
    drawStr(0, 35, info.peers ? `${info.peers} ${info.peers === 1 ? 'Shelf' : 'Shelves'} nearby` : 'Running on this PC');
    const d = new Date();
    setFont('f5x7');
    const up = `Open ${Math.floor((Date.now() - started) / 60000)} min`;
    drawStr(128 - strWidth(up), 46, up);
    setFont('f6x10'); drawStr(0, 62, 'Home · ' + ampm(d));
  }
  const started = Date.now();

  // the song playing on this page
  let np = { name: '', at: 0, last: '' };
  function trackName() {
    try { return typeof state !== 'undefined' && state.currentTrackName ? state.currentTrackName : ''; } catch (e) { return ''; }
  }
  function playing() { try { return typeof audio !== 'undefined' && audio && !audio.paused; } catch (e) { return false; } }
  function watchTrack() {
    const t = trackName();
    if (t && t !== np.last && playing()) { np.last = t; np.name = plain(t.replace(/\.[^.]+$/, '').replace(/_/g, ' ')); np.at = Date.now(); }
    if (!t) np.last = '';
  }
  const npFresh = () => np.at && Date.now() - np.at < 30000;
  const npRecent = () => np.at && Date.now() - np.at < 600000;
  function drawNow(el) {
    setFont('f5x7');
    disc(3, 7, 2); vline(5, 0, 8); line(5, 0, 9, 2);
    drawStr(13, 7, 'NOW PLAYING'); hline(0, 10, 128);
    setFont('helvB12'); drawLoop(34, np.name, el);
    scrolling = true;
    const f = Math.floor(Date.now() / 110);
    for (let i = 0; i < 16; i++) {
      const h = (Math.imul(f, 2654435761) + Math.imul(i, 40503)) ^ Math.imul(f >>> 3, 977);
      const bh = 2 + ((h >>> 7) % 15);
      box(i * 8 + 1, 64 - bh, 6, bh);
    }
  }

  function hand(cx, cy, a, len, w) {
    const s = Math.sin(a), c = Math.cos(a), tx = cx + Math.round(s * len), ty = cy - Math.round(c * len), x = Math.round(c * w), y = Math.round(s * w);
    triangle(cx + x, cy + y, cx - x, cy - y, tx, ty); line(cx, cy, tx, ty);
  }
  function drawWatch() {
    const d = new Date(), cx = 31, cy = 32;
    circle(cx, cy, 31); circle(cx, cy, 30);
    for (let i = 0; i < 60; i++) {
      const a = i * Math.PI / 30;
      if (i % 5 === 0) {
        const r0 = i % 15 === 0 ? 22 : 24;
        for (let k = -1; k <= (i % 15 === 0 ? 1 : 0); k++) { const ka = a + k * 0.025; line(cx + Math.round(Math.sin(ka) * r0), cy - Math.round(Math.cos(ka) * r0), cx + Math.round(Math.sin(ka) * 28), cy - Math.round(Math.cos(ka) * 28)); }
      } else px(cx + Math.round(Math.sin(a) * 27), cy - Math.round(Math.cos(a) * 27));
    }
    const sec = d.getSeconds() + d.getMilliseconds() / 1000, mn = d.getMinutes() + d.getSeconds() / 60, hr = d.getHours() % 12 + mn / 60;
    hand(cx, cy, hr * Math.PI / 6, 15, 2.5); hand(cx, cy, mn * Math.PI / 30, 23, 2);
    const sa = sec * Math.PI / 30;
    line(cx - Math.round(Math.sin(sa) * 6), cy + Math.round(Math.cos(sa) * 6), cx + Math.round(Math.sin(sa) * 26), cy - Math.round(Math.cos(sa) * 26));
    disc(cx, cy, 2); color = 0; px(cx, cy); color = 1;
    scrolling = true;
    setFont('helvB08'); const wd = WDAY[d.getDay()].slice(0, 3).toUpperCase(); drawStr(96 - (strWidth(wd) >> 1), 12, wd);
    setFont('helvB18'); drawStr(96 - (strWidth(String(d.getDate())) >> 1), 35, d.getDate());
    setFont('f5x7'); const my = `${MON[d.getMonth()]} ${d.getFullYear()}`; drawStr(96 - (strWidth(my) >> 1), 45, my);
    setFont('f6x10'); const t = ampm(d); drawStr(96 - (strWidth(t) >> 1), 60, t);
  }
  function drawClock() {
    const d = new Date(), h = d.getHours() % 12 || 12, colon = Date.now() % 1000 < 600;
    const b = `${h}${colon ? ':' : ' '}${String(d.getMinutes()).padStart(2, '0')}`;
    setFont('logi32'); const tw = strWidth(b);
    setFont('helvB08'); const ap = d.getHours() < 12 ? 'AM' : 'PM', aw = strWidth(ap), x = (128 - tw - aw - 3) >> 1;
    setFont('logi32'); drawStr(x, 38, b);
    setFont('helvB08'); drawStr(x + tw + 3, 38, ap); drawStr(x + tw + 3, 22, ':' + String(d.getSeconds()).padStart(2, '0'));
    const dt = `${WDAY[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`; drawStr((128 - strWidth(dt)) >> 1, 58, dt);
    scrolling = true;
  }
  const affirmation = () => { try { return plain(getTodaysAffirmation()); } catch (e) { return ''; } };
  const dayColor = () => { try { return getTodaysColor(); } catch (e) { return null; } };
  function drawAffirm(el) {
    header("TODAY'S AFFIRMATION");
    [6, 121].forEach(sx => { hline(sx - 2, 4, 5); vline(sx, 2, 5); });
    setFont('helvB12'); drawPass(38, affirmation(), el);
    const d = new Date(), t = `${WDAY[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
    setFont('f5x7'); drawStr((128 - strWidth(t)) >> 1, 62, t);
  }
  function drawColor(el) {
    header('COLOR OF THE DAY');
    const c = dayColor(); if (!c) return;
    const name = plain(c.name);
    setFont('helvB14'); if (strWidth(name) > 112) setFont('helvB10');
    const tw = strWidth(name), x = (128 - tw - 12) >> 1;
    disc(x + 4, 29, 4); drawStr(x + 12, 35, name);
    setFont('f6x10'); drawPass(61, plain(c.meaning), el);
  }

  // where this computer is, and the weather (the browser fetches it: this page may be https-free,
  // but Open-Meteo and the location services answer it directly)
  const wx = { lat: null, lon: null, hours: [], start: 0, at: 0, err: '' };
  const getJ = u => fetch(u, { cache: 'no-store' }).then(r => { if (!r.ok) throw r.status; return r.json(); });
  async function locate() {
    if (wx.lat != null) return true;
    try { const b = await getJ('/api/board/location'); if (b && b.lat != null) { wx.lat = b.lat; wx.lon = b.lon; return true; } } catch (e) {}
    const pos = await new Promise(res => {
      if (!navigator.geolocation || !window.isSecureContext) return res(null);
      navigator.geolocation.getCurrentPosition(p => res(p.coords), () => res(null), { timeout: 8000, maximumAge: 3600000 });
    });
    if (pos) { wx.lat = pos.latitude; wx.lon = pos.longitude; return true; }
    for (const [u, f] of [['https://ipwho.is/', x => x.success !== false && x.latitude != null && [x.latitude, x.longitude]],
      ['https://ipapi.co/json/', x => x.latitude != null && [x.latitude, x.longitude]]]) {
      try { const g = f(await getJ(u)); if (g) { [wx.lat, wx.lon] = g; return true; } } catch (e) {}
    }
    return false;
  }
  async function loadWx() {
    try {
      if (!(await locate())) { wx.err = "Can't find location"; return; }
      const j = await getJ(`https://api.open-meteo.com/v1/forecast?latitude=${wx.lat}&longitude=${wx.lon}&hourly=temperature_2m&past_days=4&forecast_days=1&temperature_unit=fahrenheit&timeformat=unixtime`);
      const now = Date.now() / 1000 + 60, t = [], v = [];
      j.hourly.time.forEach((ts, i) => { if (ts <= now && j.hourly.temperature_2m[i] != null) { t.push(ts); v.push(j.hourly.temperature_2m[i]); } });
      wx.hours = v.slice(-96); wx.start = t[t.length - wx.hours.length] || 0; wx.at = Date.now(); wx.err = '';
    } catch (e) { wx.err = "Couldn't get them yet"; }
  }
  function drawWx() {
    const v = wx.hours, n = v.length;
    if (n < 2) {
      header('OUTSIDE · LAST 4 DAYS');
      setFont('f6x10'); drawPass(34, 'Outside temperature', 0);
      setFont('f5x7'); const m = wx.err || 'Getting them...'; drawStr(Math.max(0, (128 - strWidth(m)) >> 1), 58, m);
      return;
    }
    const lo = Math.min(...v), hi = Math.max(...v);
    let dlo = lo, dhi = hi;
    if (lo < 45 && hi > 20) { dlo = Math.min(dlo, 32); dhi = Math.max(dhi, 32); }
    if (dhi - dlo < 10) { const m = (dhi + dlo) / 2; dlo = m - 5; dhi = m + 5; }
    const X0 = 16, X1 = 127, Y0 = 12, Y1 = 46;
    const Y = f => Y1 - Math.round((f - dlo) * (Y1 - Y0) / (dhi - dlo));
    const X = i => X0 + Math.round(i * (X1 - X0) / 95) + Math.floor((96 - n) * (X1 - X0) / 95);
    setFont('f5x7'); drawStr(0, 7, 'OUTSIDE · 4 DAYS');
    const nowT = `${Math.round(v[n - 1])}°F now`; drawStr(128 - strWidth(nowT), 7, nowT);
    setFont('f4x6'); drawStr(0, Y0 + 5, Math.round(dhi)); drawStr(0, Y1, Math.round(dlo));
    if (32 >= dlo && 32 <= dhi) {
      const fy = Y(32);
      for (let x = X0; x <= X1; x += 4) hline(x, fy, 2);
      if (fy - 3 > Y0 + 6 && fy + 3 < Y1 - 5) drawStr(0, fy + 3, '32');
    }
    const off = -new Date().getTimezoneOffset() * 60, firstLocal = wx.start + off;
    let mid = (Math.floor(firstLocal / 86400) + 1) * 86400, prevX = X(0);
    setFont('f5x7');
    for (;; mid += 86400) {
      const hi_ = Math.floor((mid - firstLocal) / 3600), mx = hi_ < n ? X(hi_) : X(n - 1);
      const day = WDAY[new Date((mid - 86400 - off) * 1000 + 43200000).getDay()].slice(0, 3);
      if (mx - prevX > 16) drawStr(((prevX + mx) >> 1) - (strWidth(day) >> 1), 56, day);
      if (hi_ >= n) break;
      for (let y = Y0; y <= Y1; y += 3) px(mx, y);
      prevX = mx;
    }
    for (let i = 1; i < n; i++) line(X(i - 1), Y(v[i - 1]), X(i), Y(v[i]));
    disc(X(n - 1), Y(v[n - 1]), 1);
    setFont('f4x6');
    const f = `lo ${Math.round(lo)}°  hi ${Math.round(hi)}°  - - freezing`; drawStr((128 - strWidth(f)) >> 1, 63, f);
  }

  // GPS: a Heltec V4 with the GPS kit switched on (its /api/gps), or, on a computer, this browser's
  // own location (when the browser shares it: the computer's own Shelf, or https)
  const gps = { src: '', fix: false, lat: 0, lon: 0, altM: null, kmh: null, sats: 0, view: 0, acc: null, talking: false, at: 0 };
  let gpsWatch = null;
  function loadGps() {
    if (board && board.gps) {
      fetch('/api/gps', { cache: 'no-store' }).then(r => r.json()).then(g => {
        if (!g.supported || !g.running) { gps.src = ''; return; }
        Object.assign(gps, { src: 'kit', fix: g.fix, lat: g.lat, lon: g.lon, altM: g.altM, kmh: g.kmh, sats: g.sats, view: g.view, talking: g.talking, at: Date.now() });
      }).catch(() => {});
    } else if (!board && !gpsWatch && navigator.geolocation && window.isSecureContext) {
      gpsWatch = navigator.geolocation.watchPosition(p => {
        const c = p.coords;
        Object.assign(gps, { src: 'browser', fix: true, lat: c.latitude, lon: c.longitude, altM: c.altitude, kmh: c.speed != null ? c.speed * 3.6 : null, acc: c.accuracy, at: Date.now() });
      }, () => {}, { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 });
    }
  }
  function gridSq(lat, lon) {
    const x = lon + 180, y = lat + 90, A = 65, a = 97;
    return String.fromCharCode(A + Math.floor(x / 20), A + Math.floor(y / 10)) + Math.floor(x / 2 % 10) + Math.floor(y % 10) +
      String.fromCharCode(a + Math.floor(x * 12 % 24), a + Math.floor(y * 24 % 24));
  }
  function drawGps() {
    if (!gps.fix) {
      header('GPS');
      setFont('f6x10');
      if (!gps.talking) { drawPass(30, 'No word from the GPS', 0); setFont('f5x7'); drawPass(44, 'Is the GPS kit plugged in?', 0); return; }
      drawPass(30, 'Looking for satellites', 0);
      setFont('f5x7'); const v = `${gps.view} in view`; drawStr((128 - strWidth(v)) >> 1, 44, v);
      const t = 'Best outdoors, sky in view'; drawStr((128 - strWidth(t)) >> 1, 62, t);
      const a = (Date.now() % 2000) / 2000 * 2 * Math.PI; circle(118, 22, 6); line(118, 22, 118 + Math.round(Math.sin(a) * 6), 22 - Math.round(Math.cos(a) * 6));
      scrolling = true; return;
    }
    header(gps.src === 'kit' ? `GPS · ${gps.sats} SATS` : `LOCATION · ±${Math.round(gps.acc || 0)} M`);
    setFont('f6x10');
    drawStr(0, 22, `${gps.lat >= 0 ? 'N' : 'S'} ${Math.abs(gps.lat).toFixed(5)}`);
    drawStr(0, 33, `${gps.lon >= 0 ? 'E' : 'W'} ${Math.abs(gps.lon).toFixed(5)}`);
    setFont('f5x7');
    const al = gps.altM != null ? `${Math.round(gps.altM * 3.28084)} ft` : 'alt --', sp = gps.kmh != null ? `${Math.round(gps.kmh * 0.621371)} mph` : '-- mph';
    drawStr(128 - strWidth(al), 22, al); drawStr(128 - strWidth(sp), 33, sp);
    setFont('helvB10'); const g = 'Grid ' + gridSq(gps.lat, gps.lon); drawStr((128 - strWidth(g)) >> 1, 58, g);
    for (let i = 0; i < Math.min(gps.sats, 24); i++) disc(4 + i * 5, 42, 1);
  }

  // the top 6 news headlines (NPR, or BBC News), fetched by the browser every 30 minutes
  const news = { titles: [], src: '', at: 0 };
  async function loadNews() {
    for (const [u, name] of [['https://feeds.npr.org/1001/rss.xml', 'NPR'], ['https://feeds.bbci.co.uk/news/rss.xml', 'BBC News']]) {
      try {
        const j = await getJ('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(u));
        if (j.status !== 'ok' || !j.items || !j.items.length) continue;
        news.titles = j.items.slice(0, 6).map(x => plain(x.title).replace(/&amp;/g, '&')).filter(Boolean); news.src = name; news.at = Date.now();
        return;
      } catch (e) {}
    }
    news.at = Date.now() - 25 * 60000;              // try again in 5 minutes
  }
  // one line, like a news ticker: all six headlines one after another, round and round
  const tickerText = () => news.titles.join('   \u00b7   ');
  const tickerMs = () => { setFont('helvB12'); return 1500 + (strWidth(tickerText()) + 40) * 1000 / SCROLL; };
  function drawNews(el) {
    if (!news.titles.length) return;
    header(`NEWS \u00b7 ${news.src.toUpperCase()}`);
    setFont('helvB12'); drawLoop(36, tickerText(), el);
    scrolling = true;
    setFont('f5x7'); const t = `Top ${news.titles.length} headlines`; drawStr((128 - strWidth(t)) >> 1, 62, t);
  }

  // the sunlit earth
  const WORLD = window.OLED_WORLD;
  function sunPos(d) {
    const start = Date.UTC(d.getUTCFullYear(), 0, 1), yday = Math.floor((d - start) / 86400000);
    const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    const y = 2 * Math.PI / 365 * (yday + (hours - 12) / 24);
    const decl = 0.006918 - 0.399912 * Math.cos(y) + 0.070257 * Math.sin(y) - 0.006758 * Math.cos(2 * y) + 0.000907 * Math.sin(2 * y) - 0.002697 * Math.cos(3 * y) + 0.00148 * Math.sin(3 * y);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(y) - 0.032077 * Math.sin(y) - 0.014615 * Math.cos(2 * y) - 0.040849 * Math.sin(2 * y));
    let lon = -15 * (hours - 12 + eqt / 60); while (lon < -180) lon += 360; while (lon > 180) lon -= 360;
    return [decl, lon];
  }
  function drawEarth() {
    if (!WORLD) return;
    const [decl, sub] = sunPos(new Date()), sd = Math.sin(decl), cd = Math.cos(decl), span = WORLD.top - WORLD.bottom;
    const cosCol = []; for (let x = 0; x < 128; x++) cosCol[x] = Math.cos(((-180 + (x + 0.5) * 360 / 128) - sub) * Math.PI / 180);
    for (let y = 0; y < 64; y++) {
      const lat = (WORLD.top - (y + 0.5) * span / 64) * Math.PI / 180, a = Math.sin(lat) * sd, b = Math.cos(lat) * cd, row = WORLD.rows[y];
      for (let x = 0; x < 128; x++) {
        const z = a + b * cosCol[x], land = (parseInt(row[x >> 2], 16) >> (3 - (x & 3))) & 1;
        const on = land ? (z > 0.05 ? true : z > -0.10 ? (x + y) & 1 : !(x & 1) && !(y & 1)) : Math.abs(z) < 0.025 && (x + y) % 3 === 0;
        if (on) px(x, y);
      }
    }
    const sx = Math.round((sub + 180) * 128 / 360), sy = Math.round((WORLD.top - decl * 180 / Math.PI) * 64 / span);
    color = 0; disc(sx, sy, 6); color = 1; disc(sx, sy, 2);
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; line(sx + Math.round(Math.cos(a) * 4), sy + Math.round(Math.sin(a) * 4), sx + Math.round(Math.cos(a) * 6), sy + Math.round(Math.sin(a) * 6)); }
    const hl = gps.fix ? gps.lat : wx.lat, ho = gps.fix ? gps.lon : wx.lon;
    if (hl != null) {
      const hx = Math.round((ho + 180) * 128 / 360), hy = Math.round((WORLD.top - hl) * 64 / span);
      color = 0; disc(hx, hy, 4); color = 1;
      if (Math.floor(Date.now() / 400) % 2) circle(hx, hy, 3); else disc(hx, hy, 2);
      px(hx, hy);
    }
    const t = ampm(new Date()); setFont('f5x7'); const w = strWidth(t);
    color = 0; box(0, 55, w + 3, 9); color = 1; drawStr(1, 63, t);
    scrolling = true;
  }

  // ---- the carousel
  const P = { STATUS: 0, WATCH: 1, NOW: 2, EARTH: 3, AFFIRM: 4, CLOCK: 5, WX: 6, COLOR: 7, TEMP: 8, NEWS: 9, GPS: 10 }, COUNT = 11;
  let page = P.STATUS, pageAt = 0, pageLen = 10000, held = false, noteAt = 0;
  const ready = p => p === P.NOW ? npRecent() && np.name : p === P.COLOR ? !!dayColor() : p === P.AFFIRM ? !!affirmation() : p === P.TEMP ? !!(board && board.temp != null) : p === P.NEWS ? news.titles.length > 0 : p === P.GPS ? !!gps.src && Date.now() - gps.at < 60000 : true;
  function duration(p) {
    switch (p) {
      case P.STATUS: return 10000; case P.WATCH: return 9000; case P.CLOCK: return 6000; case P.NOW: return 10000;
      case P.EARTH: case P.WX: return 9000;
      case P.TEMP: return 6000;
      case P.GPS: return 9000;
      case P.NEWS: return news.titles.length ? tickerMs() : 6000;
      case P.AFFIRM: setFont('helvB12'); return Math.max(7000, passMs(strWidth(affirmation())));
      case P.COLOR: { setFont('f6x10'); const c = dayColor(); return Math.max(7000, passMs(strWidth(plain(c && c.meaning)))); }
    }
    return 8000;
  }
  function draw(skip) {
    buf.fill(0); color = 1; scrolling = false;
    const now = Date.now();
    watchTrack();
    if (skip && npFresh()) { np.at = now - 30000; skip = false; }
    if (npFresh()) { drawNow(now - np.at); return; }
    if (skip || (!held && now - pageAt >= pageLen) || !ready(page)) {
      for (let i = 0; i < COUNT; i++) { page = (page + 1) % COUNT; if (ready(page)) break; }
      pageAt = now; pageLen = duration(page);
    }
    const el = now - pageAt;
    [drawStatus, drawWatch, () => drawNow(el), drawEarth, () => drawAffirm(el), drawClock, drawWx, () => drawColor(el), drawTemp, () => drawNews(el), drawGps][page]();
    if (noteAt && now - noteAt < 1500) {
      const t = held ? 'Holding this page' : 'Pages turning';
      setFont('f6x10'); const w = strWidth(t) + 8, x = (128 - w) >> 1;
      color = 0; box(x - 1, 21, w + 2, 16); color = 1; rframe(x, 22, w, 14, 3); drawStr(x + 4, 32, t);
    } else noteAt = 0;
  }

  // ---- on the page: blue with the bottom 16 rows yellow, like the boards' two-color screens
  const S = 4;
  let cv = null, ctx = null, timer = null, lastDraw = 0, nextNow = false, clickT = null;
  function paint() {
    ctx.fillStyle = '#05080f'; ctx.fillRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < H; y++) {
      ctx.fillStyle = y >= 48 ? '#ffd63c' : '#5ac8ff';
      for (let x = 0; x < W; x++) if (buf[y * W + x]) ctx.fillRect(x * S, y * S, S, S);
    }
  }
  function tick() {
    timer = null;
    if (!cv || !cv.isConnected) { cv = null; return; }
    const now = Date.now();
    if (now - lastDraw >= (scrolling ? 50 : 1000) || nextNow) { draw(nextNow); nextNow = false; paint(); lastDraw = now; }
    timer = setTimeout(tick, 50);
  }
  window.shelfOledMount = function (el) {
    if (!el || !window.OLED_FONTS) return;
    el.innerHTML = '';
    cv = document.createElement('canvas');
    cv.width = W * S; cv.height = H * S;
    cv.className = 'oled-sim-canvas';
    cv.title = 'The Shelf boards’ screen. Click: stay on this page (click again to turn). Double-click: next page.';
    el.appendChild(cv);
    const cap = document.createElement('div');
    cap.className = 'oled-sim-cap';
    cap.textContent = 'Click to stay on a page · double-click for the next one';
    el.appendChild(cap);
    ctx = cv.getContext('2d');
    cv.addEventListener('click', () => {                      // one click: hold; two: next page
      if (clickT) { clearTimeout(clickT); clickT = null; nextNow = true; return; }
      clickT = setTimeout(() => { clickT = null; held = !held; noteAt = Date.now(); nextNow = false; lastDraw = 0; }, 300);
    });
    loadInfo();
    if (!wx.at || Date.now() - wx.at > 30 * 60000) loadWx();
    if (!news.at || Date.now() - news.at > 30 * 60000) loadNews();
    setTimeout(loadGps, 1500);
    lastDraw = 0;
    if (!timer) tick();
  };
  setInterval(() => { if (cv && cv.isConnected) { loadInfo(); if (Date.now() - wx.at > 30 * 60000) loadWx(); if (Date.now() - news.at > 30 * 60000) loadNews(); } }, 60000);
  setInterval(() => { if (cv && cv.isConnected) loadGps(); }, 3000);
})();
