const CATEGORY_COLORS = {
  Pictures: 'var(--cat-Pictures)',
  Music: 'var(--cat-Music)',
  Videos: 'var(--cat-Videos)',
  Games: 'var(--cat-Games)',
  Programs: 'var(--cat-Programs)',
  Books: 'var(--cat-Books)'
};

// The internal category key stays "Books" everywhere (it's the actual
// folder name on disk and what the API expects), but it's displayed to
// the user as "Books / PDFs" — this map is just for that display text.
const CATEGORY_LABELS = {
  Books: 'Books / PDFs'
};
function categoryLabel(name) {
  return CATEGORY_LABELS[name] || name;
}

const ALL_CATEGORIES = Object.keys(CATEGORY_COLORS);
const PLAYABLE_EXT = new Set(['html', 'htm', 'zip']);

// Programs don't "play" in the browser, so their count tracks downloads —
// the closest equivalent trackable action for that shelf.
function formatPlayCount(category, n) {
  n = n || 0;
  let noun;
  if (category === 'Programs') noun = n === 1 ? 'download' : 'downloads';
  else if (category === 'Books') noun = n === 1 ? 'time read' : 'times read';
  else noun = n === 1 ? 'play' : 'plays';
  return `${n} ${noun}`;
}

// Records a play/download for a file and updates just its displayed count
// in place — not worth a full re-render (and re-rendering mid-playback
// would wipe out the "now playing" highlight on the row).
async function recordPlay(category, name) {
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(category)}/${encodeURIComponent(name)}/play`, { method: 'POST' });
    if (!res.ok) return;
    const data = await res.json();
    const item = state.files.find(f => f.name === name);
    if (item) item.plays = data.plays;
    const row = document.querySelector(`[data-name="${encodeURIComponent(name)}"]`);
    const metaEl = row && row.querySelector('.play-count');
    if (metaEl) metaEl.textContent = formatPlayCount(category, data.plays);
  } catch {
    // A missed count bump isn't worth surfacing an error to the user over.
  }
}

const TOOLS = [
  { key: 'portal', label: 'Home', color: 'var(--cat-Music)' },
  { key: 'notes', label: 'Notes', color: 'var(--cat-Pictures)' },
  { key: 'draw', label: 'Draw', color: 'var(--cat-Games)' },
  { key: 'docs', label: 'Docs', color: 'var(--cat-Programs)' },
  { key: 'sheets', label: 'Sheets', color: 'var(--cat-Games)' },
  { key: 'slides', label: 'Slides', color: 'var(--cat-Music)' },
  { key: 'messages', label: 'Messages', color: 'var(--cat-Pictures)' },
  { key: 'visitors', label: 'Visitors', color: 'var(--cat-Videos)' },
  { key: 'bigfiles', label: 'Big Transfer', color: 'var(--coral)' },
  { key: 'ai', label: 'AI', color: 'var(--cat-Books)' }
];
const TOOL_LABELS = Object.fromEntries(TOOLS.map(t => [t.key, t.label]));

const STICKY_COLORS = { amber: '#F2B441', mint: '#6FCF97', coral: '#E2725B', sky: '#7AA8F2' };

// Shows the full content of a truncated sticky note in a floating tooltip
// near the note, clamped to stay within the viewport. Purely visual — the
// note underneath keeps its small, uniform size regardless of hover state.
function showStickyTooltip(noteEl) {
  const tooltip = el('#stickyTooltip');
  const clone = noteEl.cloneNode(true);
  const btn = clone.querySelector('.remove-sticky');
  if (btn) btn.remove();
  tooltip.innerHTML = clone.innerHTML;
  tooltip.style.background = window.getComputedStyle(noteEl).backgroundColor;

  const rect = noteEl.getBoundingClientRect();
  tooltip.style.width = `${Math.max(rect.width, 220)}px`;
  tooltip.style.left = `${rect.left}px`;
  tooltip.style.top = `${rect.top}px`;
  tooltip.hidden = false;

  requestAnimationFrame(() => {
    const tRect = tooltip.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;
    if (left + tRect.width > window.innerWidth - 12) left = window.innerWidth - tRect.width - 12;
    if (left < 12) left = 12;
    if (top + tRect.height > window.innerHeight - 12) top = window.innerHeight - tRect.height - 12;
    if (top < 12) top = 12;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.classList.add('visible');
  });
}

function hideStickyTooltip() {
  const tooltip = el('#stickyTooltip');
  tooltip.classList.remove('visible');
  tooltip.hidden = true;
}

// Same viewport-clamped floating-preview approach as the sticky note
// tooltip above, just for a full-size album art image instead of text —
// shown to the side of whichever thumbnail is being hovered, flipping to
// the other side if it would run off the edge of the screen.
function showArtPreview(anchorEl, src) {
  const preview = el('#artPreview');
  el('#artPreviewImg').src = src;
  preview.hidden = false;

  const rect = anchorEl.getBoundingClientRect();
  requestAnimationFrame(() => {
    const pRect = preview.getBoundingClientRect();
    let left = rect.right + 12;
    let top = rect.top + rect.height / 2 - pRect.height / 2;
    if (left + pRect.width > window.innerWidth - 12) left = rect.left - pRect.width - 12;
    if (left < 12) left = 12;
    if (top + pRect.height > window.innerHeight - 12) top = window.innerHeight - pRect.height - 12;
    if (top < 12) top = 12;
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
    preview.classList.add('visible');
  });
}

function hideArtPreview() {
  const preview = el('#artPreview');
  preview.classList.remove('visible');
  preview.hidden = true;
}

// Hover works fine with a mouse, but touch devices have no real "hover" —
// tapping the thumbnail is how a phone opens the preview, so tapping the
// same one again (or tapping anywhere else) needs to close it. Keeping
// track of which thumbnail is currently showing is what makes "tap the
// same one to close it, tap a different one to switch to it" possible.
let activeArtPreviewEl = null;

function toggleArtPreview(anchorEl, src) {
  if (activeArtPreviewEl === anchorEl && !el('#artPreview').hidden) {
    hideArtPreview();
    activeArtPreviewEl = null;
  } else {
    showArtPreview(anchorEl, src);
    activeArtPreviewEl = anchorEl;
  }
}

document.addEventListener('click', (e) => {
  if (!activeArtPreviewEl) return;
  if (e.target.closest('.track-art') || e.target.closest('.mini-art')) return; // the thumbnail's own handler deals with this click
  hideArtPreview();
  activeArtPreviewEl = null;
});

const STATUS_LABELS = { online: 'Online', away: 'Away', busy: 'Busy', offline: 'Appear offline' };

const SHEET_DEFAULT_COLS = 10;
const SHEET_DEFAULT_ROWS = 20;
const SHEET_MAX_COLS = 26;
const SHEET_MAX_ROWS = 100;

const state = {
  view: 'shelf', // 'shelf' | 'portal' | 'notes' | 'draw' | 'docs' | 'sheets' | 'slides' | 'messages'
  category: 'Pictures',
  files: [],
  filtered: [],
  slideshow: { index: 0, playing: true, timer: null, seconds: 4, kenBurns: true, musicStartedByUs: false },
  currentTrackName: null,
  musicPlaylist: [],
  musicSourceList: [],
  musicPlaylistIndex: -1,
  videoPlaylist: [],
  videoPlaylistIndex: -1,

  notes: { items: [], activeId: null },
  documents: { items: [], activeId: null },
  presentations: { items: [], activeId: null, activeSlide: 0 },
  drawings: {
    items: [], activeId: null,
    color: '#000000', size: 6, erasing: false, textMode: false, shapeMode: null,
    undoStack: [], dirty: false
  },
  portal: { links: [], posts: [] },
  sheets: { items: [], activeId: null },

  messaging: {
    identity: { id: null, name: '', status: 'online' },
    peers: [],
    conversations: [],
    activePeerId: null,
    activePeerName: '',
    messages: [],
    unread: 0
  }
};

const el = (sel) => document.querySelector(sel);

// ---------- Sidebar / categories ----------

async function loadCategories() {
  const res = await fetch('/api/categories');
  const cats = await res.json();
  const nav = el('#shelfNav');
  nav.innerHTML = '';
  cats.forEach(cat => {
    const item = document.createElement('div');
    item.className = 'shelf-item' + (state.view === 'shelf' && cat.name === state.category ? ' active' : '');
    item.style.setProperty('--cat-color', CATEGORY_COLORS[cat.name]);
    item.innerHTML = `
      <span class="swatch"></span>
      <span class="label">${categoryLabel(cat.name)}</span>
      <span class="count">${cat.count}</span>
    `;
    item.addEventListener('click', () => selectCategory(cat.name));

    // Drop target: accepts either an in-app item being moved, or files dragged
    // straight from the desktop (uploads them directly into this category).
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        el('#categorySelect').value = cat.name;
        el('#uploadList').innerHTML = '';
        uploadBackdrop.hidden = false;
        uploadFiles(e.dataTransfer.files, cat.name);
        return;
      }
      const raw = e.dataTransfer.getData('application/x-shelf-item');
      if (raw) {
        const { category: fromCategory, name } = JSON.parse(raw);
        if (fromCategory !== cat.name) moveFile(fromCategory, cat.name, name);
      }
    });

    nav.appendChild(item);
  });
}

async function selectCategory(name) {
  await saveDrawingIfDirty();
  stopMessagingPolling();
  state.view = 'shelf';
  state.category = name;
  el('#searchBox').value = '';
  el('#searchClearBtn').hidden = true;
  el('#playCountFilter').value = '';
  loadCategories();
  renderToolNav();
  loadFiles();
}

function renderToolNav() {
  const nav = el('#toolNav');
  nav.innerHTML = '';
  TOOLS.forEach(tool => {
    const item = document.createElement('div');
    item.className = 'shelf-item' + (state.view === tool.key ? ' active' : '');
    item.style.setProperty('--cat-color', tool.color);
    const badge = tool.key === 'messages' && state.messaging.unread > 0
      ? `<span class="nav-badge">${state.messaging.unread}</span>` : '';
    item.innerHTML = `<span class="swatch"></span><span class="label">${tool.label}</span>${badge}`;
    item.addEventListener('click', () => selectTool(tool.key));
    nav.appendChild(item);
  });
}

async function selectTool(key) {
  await saveDrawingIfDirty();
  if (key !== 'messages') stopMessagingPolling();
  state.view = key;
  loadCategories(); // refreshes shelf nav so no category shows as active
  renderToolNav();

  if (key === 'portal') loadPortalView();
  else if (key === 'notes') loadNotesView();
  else if (key === 'draw') loadDrawView();
  else if (key === 'docs') loadDocsView();
  else if (key === 'sheets') loadSheetsView();
  else if (key === 'slides') loadSlidesView();
  else if (key === 'messages') loadMessagesView();
  else if (key === 'visitors') loadVisitorsView();
  else if (key === 'ai') loadAiView();
  else if (key === 'bigfiles') loadBigfilesView();
}

// ---------- Files ----------

async function loadFiles() {
  const res = await fetch(`/api/files?category=${encodeURIComponent(state.category)}`);
  state.files = await res.json();
  applyFilters();
}

// The "up next" list for auto-advance is deliberately a snapshot, not a
// live reference to state.filtered (see playTrack) — but that snapshot
// needs to be refreshed whenever the visible list changes while a track
// is already playing, or auto-advance stays stuck looking at whatever
// was visible at the moment playback started. The clearest case: search
// for a song, play it, clear the search — without this, "next" would
// still only know about that one narrow search result and stop instead
// of continuing into the full library.
function refreshMusicPlaylistIfPlaying() {
  if (state.category !== 'Music' || !state.currentTrackName) return;
  const idx = state.filtered.findIndex(f => f.name === state.currentTrackName);
  if (idx === -1) return; // the playing track isn't in the new view — leave the old snapshot as-is
  // Unchanged list (just a re-render) -- keep the current order, so a
  // shuffled run isn't reshuffled every time the screen redraws.
  const same = state.musicSourceList && state.musicSourceList.length === state.filtered.length
    && state.filtered.every((f, i) => f.name === state.musicSourceList[i].name);
  if (same) return;
  state.musicSourceList = state.filtered.slice();
  const order = buildPlayOrder(state.musicSourceList, idx);
  state.musicPlaylist = order.list;
  state.musicPlaylistIndex = order.index;
}

const PLAY_COUNT_CATEGORIES = ['Music', 'Videos', 'Games', 'Programs', 'Books'];

// Shelves that can show a thumbnail image at all. Videos get theirs from
// the "Get thumbnails" button (grabs a frame); Books make their own
// automatically in the background from each PDF's first page (see
// queueAutoPdfThumbnails); Games and Programs have nothing to grab, so
// they get a per-item picker / drop target on each card. Any of the card
// shelves can also have a custom image dropped on to replace the default.
const THUMBNAIL_CATEGORIES = ['Videos', 'Games', 'Programs', 'Books'];

// Rebuilds the dropdown's full option set for the current category, rather
// than just relabeling fixed positions — needed now that Music gets an
// extra "Artist" option the other categories don't. Runs on every
// renderHeader() (e.g. each search keystroke), not just on category
// switches, so the current selection is explicitly preserved across the
// rebuild — otherwise picking "Most played" and then typing in the search
// box would silently reset it back to "All plays".
function updatePlayCountFilterLabels() {
  const select = el('#playCountFilter');
  const previousValue = select.value;

  let allLabel, mostLabel, neverLabel, verb;
  if (state.category === 'Programs') {
    allLabel = 'All downloads'; mostLabel = 'Most downloaded'; neverLabel = 'Never downloaded'; verb = 'Downloaded';
  } else if (state.category === 'Books') {
    allLabel = 'All books'; mostLabel = 'Most read'; neverLabel = 'Never read'; verb = 'Read';
  } else {
    allLabel = 'All plays'; mostLabel = 'Most played'; neverLabel = 'Never played'; verb = 'Played';
  }

  const opts = [['', allLabel], ['mostplayed', mostLabel]];
  if (state.category === 'Music') opts.push(['artist', 'Artist (A\u2013Z)']);
  opts.push(
    ['0', neverLabel],
    ['1+', `${verb} 1+ times`],
    ['5+', `${verb} 5+ times`],
    ['10+', `${verb} 10+ times`],
    ['25+', `${verb} 25+ times`]
  );

  select.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  select.value = opts.some(([v]) => v === previousValue) ? previousValue : '';
}

function renderHeader() {
  if (state.view !== 'shelf') return; // tool views set their own header text
  el('#categoryTitle').textContent = categoryLabel(state.category);
  const n = state.filtered.length;
  el('#categorySub').textContent = `${n} item${n === 1 ? '' : 's'}`;
  el('#searchBox').hidden = false;
  el('#slideshowBtn').hidden = state.category !== 'Pictures' || n === 0;
  el('#shuffleAllBtn').hidden = state.category !== 'Music' || n === 0;
  el('#imagineBtn').hidden = state.category !== 'Pictures';
  el('#toolActionBtn').hidden = true;
  el('#aboutInfoBtn').hidden = state.category !== 'Games' && state.category !== 'Programs';
  el('#standardizeNamesBtn').hidden = (state.category !== 'Music' && state.category !== 'Videos') || n === 0;
  el('#fetchArtBtn').hidden = state.category !== 'Music' || n === 0;
  el('#clearArtBtn').hidden = state.category !== 'Music' || !state.files.some(f => f.artUrl);
  el('#exportListBtn').hidden = state.category !== 'Music' || n === 0;
  // Books don't need this button any more -- they make their own.
  el('#fetchThumbsBtn').hidden = state.category !== 'Videos' || n === 0;
  el('#fetchThumbsBtn').title = "Grab a thumbnail frame from videos that don't have one yet";
  el('#clearThumbsBtn').hidden = !THUMBNAIL_CATEGORIES.includes(state.category) || !state.files.some(f => f.thumbUrl);
  el('#removeDuplicatesBtn').hidden = n < 2; // need at least 2 items for a duplicate to be possible

  // Based on the total unfiltered count, not the filtered count above —
  // otherwise filtering down to zero results would hide the very control
  // needed to change the filter back.
  const supportsPlayCount = PLAY_COUNT_CATEGORIES.includes(state.category);
  el('#playCountFilter').hidden = !supportsPlayCount || state.files.length === 0;
  if (supportsPlayCount) updatePlayCountFilterLabels();
}

// Sets the header for a tool view: hides the shelf-only search/slideshow
// controls, and optionally shows a single contextual "+ New …" button.
function setToolHeader(title, sub, actionLabel, onAction) {
  el('#categoryTitle').textContent = title;
  el('#categorySub').textContent = sub;
  el('#searchBox').hidden = true;
  el('#playCountFilter').hidden = true;
  el('#slideshowBtn').hidden = true;
  el('#shuffleAllBtn').hidden = true;
  el('#imagineBtn').hidden = true;
  el('#aboutInfoBtn').hidden = true;
  el('#standardizeNamesBtn').hidden = true;
  el('#fetchArtBtn').hidden = true;
  el('#clearArtBtn').hidden = true;
  el('#exportListBtn').hidden = true;
  el('#fetchThumbsBtn').hidden = true;
  el('#clearThumbsBtn').hidden = true;
  el('#removeDuplicatesBtn').hidden = true;
  const btn = el('#toolActionBtn');
  if (actionLabel) {
    btn.hidden = false;
    btn.textContent = actionLabel;
    btn.onclick = onAction;
  } else {
    btn.hidden = true;
    btn.onclick = null;
  }
}

function renderContent() {
  const content = el('#content');
  const items = state.filtered;

  if (items.length === 0) {
    content.innerHTML = `<div class="empty-state">Nothing on this shelf yet. Add something to get started.</div>`;
    return;
  }

  if (state.category === 'Pictures') {
    content.innerHTML = `<div class="photo-grid">${
      items.map((f, i) => `
        <div class="photo-tile" data-index="${i}" draggable="true">
          <img src="${f.url}" alt="${escapeHtml(f.name)}" loading="lazy">
          <button class="photo-edit" data-name="${encodeURIComponent(f.name)}" title="Edit photo">&#9998;</button>
          <button class="photo-rename" data-name="${encodeURIComponent(f.name)}" title="Rename">&#127991;</button>
          <button class="photo-remove" data-name="${encodeURIComponent(f.name)}" title="Remove">&times;</button>
          <div class="tile-name">${escapeHtml(f.name)}</div>
        </div>
      `).join('')
    }</div>`;
    content.querySelectorAll('.photo-tile').forEach(tile => {
      tile.addEventListener('click', () => openSlideshow(Number(tile.dataset.index)));
      const name = items[Number(tile.dataset.index)].name;
      attachDragSource(tile, name);
      tile.appendChild(attachMoveControl(name));
    });
    content.querySelectorAll('.photo-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFile(decodeURIComponent(btn.dataset.name));
      });
    });
    content.querySelectorAll('.photo-rename').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        renameFile(decodeURIComponent(btn.dataset.name));
      });
    });
    content.querySelectorAll('.photo-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPhotoEditor(decodeURIComponent(btn.dataset.name));
      });
    });
    return;
  }

  if (state.category === 'Music') {
    content.innerHTML = `<div class="track-list">${
      items.map((f, i) => `
        <div class="track-row" data-index="${i}" data-name="${encodeURIComponent(f.name)}" draggable="true">
          <span class="track-art">${f.artUrl ? `<img src="${f.artUrl}" alt="" loading="lazy">` : '<span class="track-art-placeholder">&#9834;</span>'}</span>
          <span class="track-play-icon">&#9658;</span>
          <span class="track-name-wrap">
            <span class="track-name">${escapeHtml(f.name)}</span>
            ${f.artist ? `<span class="track-artist">${escapeHtml(f.artist)}</span>` : ''}
          </span>
          <span class="track-row-break"></span>
          <span class="track-meta">${f.sizeLabel}</span>
          <span class="play-count">${formatPlayCount('Music', f.plays)}</span>
          <a class="track-download" href="${f.url}" download title="Download">&#8681;</a>
          <button class="track-edit-tags" data-name="${encodeURIComponent(f.name)}" title="Edit tags (Artist, Title, Album)">&#127925;</button>
          <button class="track-rename" data-name="${encodeURIComponent(f.name)}" title="Rename">&#127991;</button>
          <button class="track-remove" data-name="${encodeURIComponent(f.name)}" title="Remove">&times;</button>
        </div>
      `).join('')
    }</div>`;
    content.querySelectorAll('.track-row').forEach(row => {
      row.addEventListener('click', () => { if (!rowHasTextSelected(row)) playTrack(Number(row.dataset.index)); });
      const name = items[Number(row.dataset.index)].name;
      attachDragSource(row, name);
      allowTextSelection(row, row.querySelector('.track-name'));
      row.appendChild(attachMoveControl(name));
    });
    content.querySelectorAll('.track-edit-tags').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTagEditor(decodeURIComponent(btn.dataset.name));
      });
    });
    content.querySelectorAll('.track-art').forEach(art => {
      const img = art.querySelector('img');
      if (!img) return; // nothing to preview for the placeholder note icon
      art.addEventListener('mouseenter', () => showArtPreview(art, img.src));
      art.addEventListener('mouseleave', hideArtPreview);
      art.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleArtPreview(art, img.src);
      });
    });
    content.querySelectorAll('.track-download').forEach(a => {
      a.addEventListener('click', (e) => e.stopPropagation());
    });
    content.querySelectorAll('.track-rename').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        renameFile(decodeURIComponent(btn.dataset.name));
      });
    });
    content.querySelectorAll('.track-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFile(decodeURIComponent(btn.dataset.name));
      });
    });
    return;
  }

  if (state.category === 'Videos') {
    content.innerHTML = `<div class="track-list">${
      items.map((f, i) => `
        <div class="track-row" data-index="${i}" data-name="${encodeURIComponent(f.name)}" draggable="true">
          <span class="track-art">${f.thumbUrl ? `<img src="${f.thumbUrl}" alt="" loading="lazy">` : '<span class="track-art-placeholder">&#127909;</span>'}</span>
          <span class="track-play-icon video-play-icon">&#9654;</span>
          <span class="track-name">${escapeHtml(f.name)}</span>
          <span class="track-row-break"></span>
          <span class="track-meta">${f.sizeLabel}</span>
          <span class="play-count">${formatPlayCount('Videos', f.plays)}</span>
          <a class="track-download" href="${f.url}" download title="Download">&#8681;</a>
          <button class="track-rename" data-name="${encodeURIComponent(f.name)}" title="Rename">&#127991;</button>
          <button class="track-remove" data-name="${encodeURIComponent(f.name)}" title="Remove">&times;</button>
        </div>
      `).join('')
    }</div>`;
    content.querySelectorAll('.track-row').forEach(row => {
      row.addEventListener('click', () => { if (!rowHasTextSelected(row)) playVideo(Number(row.dataset.index)); });
      const name = items[Number(row.dataset.index)].name;
      attachDragSource(row, name);
      allowTextSelection(row, row.querySelector('.track-name'));
      row.appendChild(attachMoveControl(name));
    });
    content.querySelectorAll('.track-art').forEach(art => {
      const img = art.querySelector('img');
      if (!img) return; // nothing to preview for the placeholder icon
      art.addEventListener('mouseenter', () => showArtPreview(art, img.src));
      art.addEventListener('mouseleave', hideArtPreview);
      art.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleArtPreview(art, img.src);
      });
    });
    content.querySelectorAll('.track-download').forEach(a => {
      a.addEventListener('click', (e) => e.stopPropagation());
    });
    content.querySelectorAll('.track-rename').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        renameFile(decodeURIComponent(btn.dataset.name));
      });
    });
    content.querySelectorAll('.track-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFile(decodeURIComponent(btn.dataset.name));
      });
    });
    return;
  }
  content.innerHTML = `<div class="file-cards" data-category="${state.category}">${
    items.map(f => `
      <div class="file-card" draggable="true" data-name="${encodeURIComponent(f.name)}">
        <div class="file-icon" style="--cat-color:${CATEGORY_COLORS[state.category]}">${
          f.thumbUrl ? `<img src="${f.thumbUrl}" alt="" loading="lazy">` : (f.ext || '?').slice(0,3).toUpperCase()
        }
          <button class="thumb-set-btn" data-name="${encodeURIComponent(f.name)}" title="${f.thumbUrl ? 'Replace thumbnail (or drop an image onto this card)' : 'Set a thumbnail image (or drop an image onto this card)'}">&#128247;</button>
          <span class="thumb-drop-hint">Drop image for thumbnail</span>
        </div>
        <div class="file-name">${escapeHtml(f.name)}</div>
        <div class="file-meta">${f.sizeLabel} &middot; added ${new Date(f.modified).toLocaleDateString()}</div>
        <div class="play-count">${formatPlayCount(state.category, f.plays)}</div>
        <div class="card-actions">
          ${PLAYABLE_EXT.has(f.ext) ? `<button class="play-btn" data-name="${encodeURIComponent(f.name)}">Play</button>` : ''}
          ${f.ext === 'pdf' ? `<button class="read-btn" data-name="${encodeURIComponent(f.name)}">Read</button>` : ''}
          <a class="download-btn" href="${f.url}" download data-name="${encodeURIComponent(f.name)}">Download</a>
          <button class="rename-btn" data-name="${encodeURIComponent(f.name)}">Rename</button>
          <button class="delete-btn" data-name="${encodeURIComponent(f.name)}">Remove</button>
        </div>
        <div class="move-row"></div>
      </div>
    `).join('')
  }</div>`;

  content.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => removeFile(decodeURIComponent(btn.dataset.name)));
  });
  content.querySelectorAll('.rename-btn').forEach(btn => {
    btn.addEventListener('click', () => renameFile(decodeURIComponent(btn.dataset.name)));
  });
  content.querySelectorAll('.play-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      playGame(state.category, decodeURIComponent(btn.dataset.name));
    });
  });
  content.querySelectorAll('.read-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      readPdf(state.category, decodeURIComponent(btn.dataset.name));
    });
  });
  content.querySelectorAll('.thumb-set-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      pickThumbnailImage(state.category, decodeURIComponent(btn.dataset.name));
    });
  });
  if (state.category === 'Programs') {
    content.querySelectorAll('.download-btn').forEach(a => {
      a.addEventListener('click', () => recordPlay('Programs', decodeURIComponent(a.dataset.name)));
    });
  }
  content.querySelectorAll('.file-card').forEach(card => {
    const name = decodeURIComponent(card.dataset.name);
    attachDragSource(card, name);
    allowTextSelection(card, card.querySelector('.file-name'));
    attachThumbnailDropTarget(card, state.category, name);
    card.querySelector('.move-row').appendChild(attachMoveControl(name));
  });
  if (state.category === 'Books') queueAutoPdfThumbnails(items);
}

// Rows and cards are draggable (to move them to another shelf), and a
// browser treats a mouse-drag that starts anywhere inside a draggable
// element as "drag the whole thing" -- so the song/file name text inside
// could never be highlighted to copy. Pressing on the name itself now
// switches dragging off just for that press, so dragging across the name
// selects its text; pressing anywhere else on the row still drags it.
function allowTextSelection(draggableEl, textEl) {
  if (!textEl) return;
  textEl.classList.add('selectable-text');
  textEl.addEventListener('mousedown', () => {
    draggableEl.draggable = false;
    document.addEventListener('mouseup', () => { draggableEl.draggable = true; }, { once: true });
  });
}

// True if the user just highlighted text inside this row -- in which case
// letting go of the mouse shouldn't also count as a click that starts the
// song playing.
function rowHasTextSelected(row) {
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && String(sel).trim() !== '' && row.contains(sel.anchorNode);
}

// Shared drag-source wiring: lets a rendered item be dropped onto a sidebar
// category to move it there. `dragstart` on a nested <a>/<button> is ignored
// so the Download/Remove controls keep working normally.
function attachDragSource(element, name) {
  element.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-shelf-item', JSON.stringify({ category: state.category, name }));
    e.dataTransfer.effectAllowed = 'move';
    element.classList.add('dragging');
  });
  element.addEventListener('dragend', () => element.classList.remove('dragging'));
}

// A small "Move to…" dropdown as a touch-friendly alternative to drag-and-drop
// (drag-and-drop between elements doesn't work on phones/tablets).
function attachMoveControl(name) {
  const select = document.createElement('select');
  select.className = 'move-select';
  select.setAttribute('draggable', 'false');
  select.innerHTML = `<option value="" disabled selected>Move to&hellip;</option>` +
    ALL_CATEGORIES.filter(c => c !== state.category)
      .map(c => `<option value="${c}">${categoryLabel(c)}</option>`).join('');

  // Prevent clicks/drags on the dropdown from triggering the card's own
  // click (open slideshow / play track) or drag handlers.
  select.addEventListener('mousedown', e => e.stopPropagation());
  select.addEventListener('click', e => e.stopPropagation());
  select.addEventListener('dragstart', e => e.stopPropagation());

  select.addEventListener('change', (e) => {
    e.stopPropagation();
    const target = e.target.value;
    if (target) moveFile(state.category, target, name);
  });

  return select;
}

async function removeFile(name) {
  if (!confirm(`Remove "${name}" from the shelf? This deletes the file from the host machine.`)) return;
  await fetch(`/api/files/${state.category}/${encodeURIComponent(name)}`, { method: 'DELETE' });
  loadFiles();
  loadCategories();
}

async function renameFile(name) {
  const newName = prompt('Rename to:', name);
  if (!newName || !newName.trim() || newName.trim() === name) return; // cancelled or unchanged
  try {
    const res = await fetch(`/api/files/${state.category}/${encodeURIComponent(name)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName: newName.trim() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not rename that file.');
    loadFiles();
  } catch (err) {
    alert(err.message);
  }
}

// Cleans up messy auto-downloader filenames (the "YTDown.com_YouTube_..."
// style names) across an entire shelf in one go. Renames happen on the
// host machine's actual files, so this confirms first, shows a live
// status bar (a big library takes real time to get through file by
// file), and reports back how many were actually changed — files that
// are already clean are left alone rather than touched needlessly. For
// Music specifically this does more than a plain filename cleanup: it
// actually parses out an Artist / Title / Track guess (protecting known
// artist names like "AC/DC" from being split apart), prefers whatever's
// already in the file's own tags over a filename guess, and writes the
// result back into the file's own tags.
async function standardizeNames() {
  const label = state.category.toLowerCase();
  const isMusic = state.category === 'Music';
  const confirmMsg = isMusic
    ? `Clean up messy music filenames and tags? This parses each filename into an Artist / Title / Track guess (existing tags win if a file is already tagged), writes that back into the file's own tags, and renames it to "Artist - Title.ext" — e.g. turning "YTDown.com_YouTube_AC-DC-Moneytalks-Official-HD-Video_Media_2lqdErI9uss_009_128k.mp3" into "AC/DC - Moneytalks.mp3". Names that already look clean are left alone, and so is any file you've manually renamed yourself. This changes files on the host machine.`
    : `Clean up messy ${label} filenames? This strips out downloader junk (site names, video IDs, sequence numbers, quality tags like "1080p") wherever it shows up in the name and tidies the rest into Title Case — e.g. turning "Media_xo1VInw-SKc_Rachel-Platten-Fight-Song_001_1080p.mp4" into "Rachel Platten Fight Song.mp4". Names that already look clean are left alone, and so is any file you've manually renamed yourself. This renames files on the host machine.`;
  if (!confirm(confirmMsg)) return;
  // The filename guess alone can't always tell "Artist Name" (two words)
  // apart from "Artist - Title" when a downloader's own hyphen placement is
  // odd (e.g. "Taylor - Swift Wildest Dreams" instead of "Taylor Swift -
  // Wildest Dreams") -- there's no local way to know "Taylor Swift" is one
  // name without either an existing tag or a real lookup. Offering an
  // online pass here is what actually fixes those, at the cost of speed
  // (rate-limited to iTunes' informal ~18 lookups/minute).
  let onlineLookup = false;
  if (isMusic) {
    onlineLookup = confirm(
      'Also look up unclear tracks online for a more accurate Artist / Title match? ' +
      'This catches cases the filename alone can\'t settle (e.g. "Taylor - Swift Wildest Dreams" ' +
      'becoming "Taylor Swift - Wildest Dreams" instead of staying split wrong). ' +
      'It\'s slower — roughly 3-4 seconds per unclear track — but you\'ll see live progress. ' +
      'Choose Cancel to skip this and just clean up what the filename alone can tell.'
    );
  }
  const btn = el('#standardizeNamesBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Working…';
  showBulkProgress('Starting…', 0);
  try {
    const url = `/api/files/${state.category}/standardize-names` + (onlineLookup ? '?onlineLookup=true' : '');
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Could not standardize names.');
    }
    let finalData = null;
    await readNdjson(res, (evt) => {
      if (evt.type === 'progress') {
        const pct = evt.total ? Math.round(((evt.index + 1) / evt.total) * 100) : 100;
        showBulkProgress(`(${evt.index + 1}/${evt.total}) ${evt.name} — ${evt.status}`, pct);
      } else if (evt.type === 'done') {
        finalData = evt;
      }
    });
    const data = finalData || {};
    if (data.renamedCount === 0) {
      alert('Nothing to clean up — all names already look tidy.');
    } else {
      let msg = `Renamed ${data.renamedCount} file${data.renamedCount === 1 ? '' : 's'}.`;
      if (isMusic && data.correctedCount) {
        msg += ` ${data.correctedCount} unclear guess${data.correctedCount === 1 ? '' : 'es'} corrected via online lookup.`;
      }
      alert(msg);
    }
    loadFiles();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
    hideBulkProgress();
  }
}

// Finds files whose actual content is byte-identical (not just files with
// similar-looking names) and removes the extra copies, keeping one of
// each — comparing real content means a genuinely different file is
// never at risk just because its name happens to look similar to
// another's.
async function removeDuplicates() {
  const label = categoryLabel(state.category).toLowerCase();
  if (!confirm(`Find and remove duplicate ${label}? This compares each file's actual content (not just its name), keeps one copy of anything that matches, and permanently deletes the rest from the host machine. This can't be undone.`)) return;
  const btn = el('#removeDuplicatesBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Checking for duplicates\u2026';
  try {
    const res = await fetch(`/api/files/${state.category}/remove-duplicates`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not check for duplicates.');
    alert(data.removedCount === 0
      ? 'No duplicates found — everything here is unique.'
      : `Removed ${data.removedCount} duplicate file${data.removedCount === 1 ? '' : 's'} across ${data.groupsFound} group${data.groupsFound === 1 ? '' : 's'}.`);
    loadFiles();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// Reads a newline-delimited-JSON response body incrementally, calling
// onEvent(obj) for each complete JSON object as it arrives — used so a
// long-running bulk operation can drive a live status bar instead of the
// browser just sitting on the request until it's entirely done.
async function readNdjson(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
  const rest = buffer.trim();
  if (rest) onEvent(JSON.parse(rest));
}

function showBulkProgress(label, pct) {
  const bar = el('#bulkProgressBar');
  bar.hidden = false;
  el('#bulkProgressFill').style.width = `${pct}%`;
  el('#bulkProgressLabel').textContent = label;
}

function hideBulkProgress() {
  el('#bulkProgressBar').hidden = true;
}

// Looks up and downloads cover art for every Music track that doesn't
// have it yet, via the iTunes Search API. Can genuinely take a while for
// a big library (one search + one image download per track, with a
// small pause between each), so this shows a live status bar with a
// running count and the track currently being looked up, rather than
// leaving the person wondering if the click even registered.
async function fetchAlbumArt() {
  if (!confirm("Look up cover art for tracks that don't have it yet, and save it into each file's own tag (not just The Shelf's cache)? This searches by filename. The lookup service only allows a limited number of searches per minute, so this deliberately paces itself and a large library can take several minutes — that's normal, not stuck. Running this again only looks up tracks that don't have art from this yet — it won't re-search ones it already found art for.")) return;
  const btn = el('#fetchArtBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Fetching art\u2026';
  showBulkProgress('Starting\u2026', 0);
  try {
    const res = await fetch('/api/files/Music/fetch-album-art', { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Could not fetch album art.');
    }
    let finalData = null;
    await readNdjson(res, (evt) => {
      if (evt.type === 'progress') {
        const pct = evt.total ? Math.round(((evt.index + 1) / evt.total) * 100) : 100;
        showBulkProgress(`(${evt.index + 1}/${evt.total}) ${evt.name} — ${evt.status}`, pct);
      } else if (evt.type === 'done') {
        finalData = evt;
      }
    });
    const data = finalData || {};
    const parts = [];
    if (data.found) parts.push(`found art for ${data.found}`);
    if (data.embedded) parts.push(`saved into ${data.embedded} file${data.embedded === 1 ? '' : 's'}`);
    if (data.alreadyHad) parts.push(`${data.alreadyHad} already had it`);
    if (data.notFound) parts.push(`no match for ${data.notFound}`);
    if (data.errored) {
      if (data.rateLimited) {
        parts.push(`${data.errored} failed \u2014 ${data.rateLimited} of those were the art lookup service rate-limiting requests (running this again picks up right where it left off, since tracks that already have art are skipped)`);
      } else {
        parts.push(`${data.errored} failed \u2014 the art lookup service didn't respond for those (try again later)`);
      }
    }
    alert(parts.length ? `Done \u2014 ${parts.join(', ')}.` : 'No tracks to look up.');
    loadFiles();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
    hideBulkProgress();
  }
}

// Deletes every cached cover image and its mapping, so a future "Get
// album art" run starts completely fresh — useful to reclaim disk space,
// or as a blunt "start over" option. To fix a single wrong track instead,
// use that track's own "Edit tags" button (below) — correcting its artist
// there and refetching just that one track's art is quicker than clearing
// everything.
async function clearAlbumArt() {
  if (!confirm('Delete all cached album art? This removes the downloaded cover images from the host machine. You can fetch them again any time with "Get album art".')) return;
  try {
    const res = await fetch('/api/files/Music/album-art', { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not clear album art.');
    alert(data.cleared === 0 ? 'Nothing to clear.' : `Cleared art for ${data.cleared} track${data.cleared === 1 ? '' : 's'}.`);
    loadFiles();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Music tag editor ----------
// Lets someone manually fix a track's own Artist/Title/Album/Track tags —
// separate from renaming the file itself. The main reason this exists:
// a track with a wrong artist tag (misread by a downloader, or guessed
// wrong by "Standardize names") keeps getting the wrong cover art matched
// to it, since art lookups search by artist/title. Fixing the tag here and
// then re-fetching art for just this one track is the direct fix.
let tagEditorName = null;

async function openTagEditor(name) {
  tagEditorName = name;
  el('#tagEditorTitle').textContent = 'Edit tags';
  el('#teFileName').textContent = name;
  el('#teCopyName').textContent = 'Copy';
  const statusEl = el('#tagEditorStatus');
  statusEl.textContent = 'Loading…';
  statusEl.classList.remove('error');
  el('#teArtist').value = '';
  el('#teTitle').value = '';
  el('#teAlbum').value = '';
  el('#teTrack').value = '';
  el('#tagEditorOverlay').hidden = false;
  try {
    const tags = await fetch(`/api/files/Music/${encodeURIComponent(name)}/tags`).then(r => r.json());
    el('#teArtist').value = tags.artist || '';
    el('#teTitle').value = tags.title || '';
    el('#teAlbum').value = tags.album || '';
    el('#teTrack').value = tags.track || '';
    statusEl.textContent = '';
  } catch {
    statusEl.textContent = "Couldn't load this track's current tags.";
    statusEl.classList.add('error');
  }
}

function closeTagEditor() {
  el('#tagEditorOverlay').hidden = true;
  tagEditorName = null;
}

function readTagEditorFields() {
  return {
    artist: el('#teArtist').value.trim(),
    title: el('#teTitle').value.trim(),
    album: el('#teAlbum').value.trim(),
    track: el('#teTrack').value.trim()
  };
}

async function saveTagEditor({ thenFetchArt = false } = {}) {
  if (!tagEditorName) return;
  const statusEl = el('#tagEditorStatus');
  statusEl.classList.remove('error');
  statusEl.textContent = thenFetchArt ? 'Saving tags…' : 'Saving…';
  try {
    const res = await fetch(`/api/files/Music/${encodeURIComponent(tagEditorName)}/tags`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readTagEditorFields())
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save tags.');

    if (thenFetchArt) {
      statusEl.textContent = 'Looking up cover art…';
      const artRes = await fetch(`/api/files/Music/${encodeURIComponent(tagEditorName)}/fetch-art`, { method: 'POST' });
      const artData = await artRes.json();
      if (!artRes.ok) throw new Error(artData.error || 'Tags saved, but could not fetch new album art.');
      statusEl.textContent = `Saved — matched "${artData.matchedAs}".`;
    } else {
      statusEl.textContent = 'Saved.';
    }
    loadFiles();
    setTimeout(closeTagEditor, thenFetchArt ? 900 : 500);
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add('error');
  }
}

// Grabs a single frame from a video, entirely client-side: load it in a
// hidden <video> element, seek a little way in (skipping black frames or
// intro fades right at the very start), then draw whatever's showing onto
// a canvas and export it as a JPEG. There's no server-side video
// processing at all — this is the same reason the photo editor does its
// editing in the browser rather than needing something like ffmpeg
// installed on the host.
function captureVideoFrame(videoUrl) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = videoUrl;

    const cleanup = () => { video.removeAttribute('src'); video.load(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out loading video')); }, 15000);

    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.min(3, (video.duration || 1) * 0.15);
    }, { once: true });

    video.addEventListener('seeked', () => {
      clearTimeout(timer);
      try {
        const maxWidth = 480;
        const scale = video.videoWidth > maxWidth ? maxWidth / video.videoWidth : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(video.videoWidth * scale) || 480;
        canvas.height = Math.round(video.videoHeight * scale) || 270;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        cleanup();
        resolve(dataUrl);
      } catch (err) {
        cleanup();
        reject(err);
      }
    }, { once: true });

    video.addEventListener('error', () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('Could not load video'));
    }, { once: true });
  });
}

// Renders page 1 of a PDF to a canvas and exports it as a JPEG, the same
// "capture it in the browser, just upload the finished image" approach as
// the video frame grab above. Uses pdf.js, vendored locally in
// vendor/pdfjs/ so this still works with no internet connection.
function capturePdfThumbnail(pdfUrl) {
  return new Promise((resolve, reject) => {
    if (!window.pdfjsLib) { reject(new Error('PDF renderer failed to load')); return; }
    pdfjsLib.getDocument(pdfUrl).promise
      .then(pdf => pdf.getPage(1))
      .then(page => {
        const maxWidth = 480;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(maxWidth / baseViewport.width, 2);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // PDFs can have transparent backgrounds; a white page reads better than black
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        page.render({ canvasContext: ctx, viewport }).promise
          .then(() => resolve(canvas.toDataURL('image/jpeg', 0.85)))
          .catch(reject);
      })
      .catch(reject);
  });
}

// ---------- Automatic PDF thumbnails (Books shelf) ----------
// Whenever the Books shelf is shown, any PDF without a thumbnail gets one
// made in the background from its first page -- no button, no prompt.
// One at a time, so a big library doesn't spin up dozens of PDF renders at
// once, and each card's picture swaps in the moment it's ready rather than
// reloading the whole shelf. pdf.js only fetches the parts of the file it
// needs for page 1, so even a huge PDF doesn't get downloaded in full.
//
// Each PDF is tried at most once per page load (a broken PDF won't be
// retried on every re-render), and if the server says this visitor isn't
// allowed to save thumbnails (a read-only guest), it stops quietly -- the
// next time the host opens the shelf, it'll fill them in.
const autoPdfThumbs = { queue: [], running: false, tried: new Set(), notAllowed: false };

function queueAutoPdfThumbnails(files) {
  if (autoPdfThumbs.notAllowed || !window.pdfjsLib) return;
  for (const f of files) {
    if (f.ext !== 'pdf' || f.thumbUrl || autoPdfThumbs.tried.has(f.name)) continue;
    autoPdfThumbs.tried.add(f.name);
    autoPdfThumbs.queue.push({ name: f.name, url: f.url });
  }
  runAutoPdfThumbQueue();
}

async function runAutoPdfThumbQueue() {
  if (autoPdfThumbs.running) return;
  autoPdfThumbs.running = true;
  try {
    while (autoPdfThumbs.queue.length && !autoPdfThumbs.notAllowed) {
      const { name, url } = autoPdfThumbs.queue.shift();
      try {
        const dataUrl = await capturePdfThumbnail(url);
        const res = await fetch(thumbnailUploadUrl('Books', name), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageData: dataUrl })
        });
        if (res.status === 401 || res.status === 403) { autoPdfThumbs.notAllowed = true; break; }
        if (!res.ok) continue;
        const { thumbUrl } = await res.json();
        showThumbOnCard('Books', name, thumbUrl);
      } catch { /* unreadable PDF -- leave the plain PDF badge */ }
    }
  } finally {
    autoPdfThumbs.running = false;
  }
}

// Puts a newly-made thumbnail onto its card in place, if that card is on
// screen, and remembers it in the shelf's data so the next re-render
// (searching, sorting) keeps showing it.
function showThumbOnCard(category, name, thumbUrl) {
  if (state.category !== category) return;
  const f = state.files.find(x => x.name === name);
  if (f) f.thumbUrl = thumbUrl;
  if (state.view !== 'shelf') return;
  const card = [...document.querySelectorAll('.file-card')].find(c => decodeURIComponent(c.dataset.name) === name);
  const icon = card && card.querySelector('.file-icon');
  if (!icon) return;
  [...icon.childNodes].forEach(n => { if (n.nodeType === Node.TEXT_NODE) n.remove(); }); // the "PDF" text badge
  const old = icon.querySelector('img');
  if (old) old.remove();
  const img = document.createElement('img');
  img.src = thumbUrl; img.alt = ''; img.className = 'thumb-fade-in';
  icon.prepend(img);
  const btn = icon.querySelector('.thumb-set-btn');
  if (btn) btn.title = 'Replace thumbnail (or drop an image onto this card)';
  el('#clearThumbsBtn').hidden = false;
}

function thumbnailUploadUrl(category, name) {
  return `/api/files/${category}/${encodeURIComponent(name)}/thumbnail`;
}

function clearThumbnailsUrl(category) {
  return category === 'Videos' ? '/api/files/Videos/video-thumbs' : `/api/files/${category}/file-thumbs`;
}

// Bulk-generates thumbnails for every item in an auto-capturable category
// (Videos, Books) that doesn't have one yet. This has to happen one item
// at a time in the browser, so the button's own text tracks progress
// through the list.
async function fetchCategoryThumbnails(category) {
  const targets = state.files.filter(f => !f.thumbUrl);
  const prompt = category === 'Books'
    ? "Render a thumbnail from the first page of books that don't have one yet? This briefly opens each PDF in your browser, so it can take a while for a large library."
    : "Grab a thumbnail frame from videos that don't have one yet? This briefly loads each video in your browser to capture a frame, so it can take a while for a large library.";
  if (!confirm(prompt)) return;
  const btn = el('#fetchThumbsBtn');
  const originalText = btn.textContent;
  btn.disabled = true;

  let done = 0, failed = 0;
  for (const f of targets) {
    btn.textContent = `Generating ${done + failed + 1}/${targets.length}\u2026`;
    try {
      const dataUrl = category === 'Books' ? await capturePdfThumbnail(f.url) : await captureVideoFrame(f.url);
      const res = await fetch(category === 'Videos' ? `/api/files/Videos/${encodeURIComponent(f.name)}/thumbnail` : thumbnailUploadUrl(category, f.name), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: dataUrl })
      });
      if (!res.ok) throw new Error('save failed');
      done++;
    } catch {
      failed++;
    }
  }

  btn.disabled = false;
  btn.textContent = originalText;
  const noun = category === 'Books' ? 'book' : 'video';
  alert(targets.length === 0
    ? `Every ${noun} already has a thumbnail.`
    : `Done \u2014 generated ${done}${failed ? `, ${failed} failed` : ''}.`);
  loadFiles();
}

async function clearCategoryThumbnails(category) {
  const msg = category === 'Books'
    ? 'Delete all thumbnails on this shelf? Each PDF will automatically get a fresh one from its first page again (any custom images you dropped on will be replaced).'
    : 'Delete all generated thumbnails on this shelf? This removes the cached thumbnail images from the host machine. You can generate or set them again any time.';
  if (!confirm(msg)) return;
  if (category === 'Books') autoPdfThumbs.tried.clear(); // let every PDF be regenerated
  try {
    const res = await fetch(clearThumbnailsUrl(category), { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not clear thumbnails.');
    alert(data.cleared === 0 ? 'Nothing to clear.' : `Cleared ${data.cleared} thumbnail${data.cleared === 1 ? '' : 's'}.`);
    loadFiles();
  } catch (err) {
    alert(err.message);
  }
}

// Games and Programs have nothing inside the file for the browser to grab
// a thumbnail from automatically, so the host picks a cover image by hand
// instead -- one shared hidden <input type=file> reused for whichever
// card's camera button was clicked, resized client-side the same way the
// video/PDF captures are, then uploaded through the same endpoint.
let thumbPickerTarget = null;

function pickThumbnailImage(category, name) {
  thumbPickerTarget = { category, name };
  el('#thumbPickerInput').click();
}

function resizeImageToThumbnail(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const maxWidth = 480;
      const scale = img.width > maxWidth ? maxWidth / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale) || 480;
      canvas.height = Math.round(img.height * scale) || 270;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

// Shared by the camera-button picker and drag-and-drop below: resizes the
// chosen image in the browser and saves it as that item's thumbnail.
async function saveThumbnailFromFile(category, name, file) {
  try {
    if (!file.type.startsWith('image/')) throw new Error('That isn’t an image file. Drop a JPG, PNG, or similar.');
    const dataUrl = await resizeImageToThumbnail(file);
    const res = await fetch(thumbnailUploadUrl(category, name), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageData: dataUrl })
    });
    if (!res.ok) throw new Error('Could not save that thumbnail.');
    loadFiles();
  } catch (err) {
    alert(err.message);
  }
}

async function handleThumbPickerChange(e) {
  const file = e.target.files[0];
  e.target.value = ''; // reset, so picking the same file again still fires 'change'
  if (!file || !thumbPickerTarget) return;
  const { category, name } = thumbPickerTarget;
  thumbPickerTarget = null;
  await saveThumbnailFromFile(category, name, file);
}

// Lets an image file be dragged from the desktop straight onto a Games,
// Programs, or Books card to make it that item's thumbnail. Only reacts to
// drags that carry actual files -- dragging a card itself (to move it to
// another shelf in the sidebar) carries no files, so it passes straight
// through untouched. The whole card is the drop target, so a slightly-off
// drop still lands instead of the browser opening the image in the tab.
function attachThumbnailDropTarget(card, category, name) {
  const isFileDrag = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  let depth = 0; // dragenter/leave fire for every child element; count them so the highlight doesn't flicker

  card.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth++;
    card.classList.add('thumb-drop-over');
  });
  card.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  card.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) card.classList.remove('thumb-drop-over');
  });
  card.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    card.classList.remove('thumb-drop-over');
    const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/')) || e.dataTransfer.files[0];
    if (file) saveThumbnailFromFile(category, name, file);
  });
}

async function moveFile(fromCategory, toCategory, name) {
  try {
    const res = await fetch('/api/files/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromCategory, toCategory, name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not move file');
    loadCategories();
    if (state.category === fromCategory || state.category === toCategory) loadFiles();
  } catch (err) {
    alert(err.message);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ABOUT_SHELF_TEXT = "The Shelf is a self-hosted hub that turns any spare computer into a private, ad-free space for everyone on your home or office network \u2014 no internet connection, no cloud account, and no subscription required, since everything lives entirely on your own machine and never leaves your network. At its core it's a media library with real polish: pictures get a slideshow with a Ken Burns pan/zoom and automatic background music pulled straight from your own library, plus a basic in-browser editor for rotating, flipping, and adjusting brightness, contrast, and saturation; music and video auto-advance through your collection and keep play counts; and games and downloadable programs are a click away for anyone on the network from their own phone or laptop, no app to install. It's also a genuinely useful little productivity suite on top of that: notes, a rich-text word processor, a spreadsheet that reads CSV and Excel files, a slide deck builder with a real presentation mode, and a drawing pad with shapes, text, and editing tools \u2014 and you can copy an image straight out of the drawing pad and paste it into any of them, or into a chat message, in one step. There's a private messaging system that finds other people running The Shelf on your network automatically, images included, with nothing routed through the internet. And it's full of small, considerate touches that make it feel like a finished product rather than a bare file server \u2014 a home dashboard with a daily affirmation and color-of-the-day, an About button that explains what you're looking at, and a one-click installer for Windows, Mac, and Linux. In short: it's for anyone who wants an easy, genuinely well-made way to share files and get things done with the people around them, without handing any of it over to a company first.";

function openAboutOverlay() {
  el('#aboutText').textContent = ABOUT_SHELF_TEXT;
  el('#aboutOverlay').hidden = false;
}

function closeAboutOverlay() {
  el('#aboutOverlay').hidden = true;
}

el('#aboutInfoBtn').addEventListener('click', openAboutOverlay);
el('#aboutClose').addEventListener('click', closeAboutOverlay);
el('#aboutOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'aboutOverlay') closeAboutOverlay(); // click on the dimmed backdrop, not the panel itself
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el('#aboutOverlay').hidden) closeAboutOverlay();
});

// ---- Auth: login/logout and the sidebar indicator ----
// Read-only browsing always stays open to everyone. This only ever
// affects whether write actions succeed — see the matching middleware in
// server.js for the actual enforcement; this is just the UI around it.

state.auth = { isLocal: true, protectionEnabled: false, secureMode: false, loggedIn: false, username: null, role: 'write' };

async function loadAuthStatus() {
  try {
    state.auth = await fetch('/api/auth/status').then(r => r.json());
  } catch {
    // Best-effort — if this fails, the optimistic default above just stays,
    // and any actual write attempt will still be correctly rejected
    // server-side if protection is really on.
  }
  renderAuthIndicator();
  renderSecureModeToggle();
}

function renderAuthIndicator() {
  const el2 = el('#authIndicator');
  const a = state.auth;
  if (a.isLocal) {
    el2.hidden = true;
    return;
  }
  el2.hidden = false;
  if (a.loggedIn) {
    el2.innerHTML = `
      <span class="auth-status">&#128100; ${escapeHtml(a.username)} <span class="auth-role">(${a.role})</span></span>
      <button class="auth-link-btn" id="authLogoutBtn">Log out</button>
    `;
    el('#authLogoutBtn').addEventListener('click', doLogout);
  } else if (a.protectionEnabled) {
    el2.innerHTML = `
      <button class="auth-link-btn auth-locked-btn" id="authLoginBtn">&#128274; Log in to make changes</button>
    `;
    el('#authLoginBtn').addEventListener('click', openLoginOverlay);
  } else {
    // Nobody's set up an account yet, so there's nothing to log into —
    // just let the person know they're viewing read-only rather than
    // showing a login button that can't actually go anywhere.
    el2.innerHTML = `<span class="auth-status">&#128274; Read-only — no accounts set up yet</span>`;
  }
}

function renderSecureModeToggle() {
  const row = el('#secureModeToggleRow');
  if (!state.auth.isLocal) {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  el('#secureModeToggle').checked = !!state.auth.secureMode;
  el('#secureModeLabel').textContent = state.auth.secureMode ? 'Secured visitors' : 'Anonymous read only';
}

el('#secureModeToggle').addEventListener('change', async (e) => {
  const wantsSecure = e.target.checked;
  try {
    const res = await fetch('/api/auth/mode', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secureMode: wantsSecure })
    });
    const data = await res.json();
    state.auth.secureMode = data.secureMode;
  } catch {
    e.target.checked = !wantsSecure; // revert on failure
  }
  renderSecureModeToggle();
});

// mandatory=true is used when "Secured visitors" mode is on and someone
// who isn't logged in (and isn't the host) loads the page at all — there's
// no dismissing it in that case, since there's nothing else to show them.
function openLoginOverlay(mandatory) {
  el('#loginStatus').textContent = '';
  el('#loginStatus').className = 'status';
  el('#loginUsername').value = '';
  el('#loginPassword').value = '';
  el('#loginIntro').textContent = mandatory
    ? 'This Shelf requires an account to view or use anything on it.'
    : 'This Shelf requires an account to make changes. You can keep browsing without one.';
  el('#loginClose').hidden = !!mandatory;
  el('#loginOverlay').classList.toggle('mandatory', !!mandatory);
  el('#loginOverlay').hidden = false;
  el('#loginUsername').focus();
}

function closeLoginOverlay() {
  el('#loginOverlay').hidden = true;
}

async function doLogin(e) {
  e.preventDefault();
  const username = el('#loginUsername').value.trim();
  const password = el('#loginPassword').value;
  const wasMandatory = el('#loginOverlay').classList.contains('mandatory');
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not log in.');
    if (wasMandatory) {
      location.reload(); // simplest way to a fully-initialized, now-authenticated app
      return;
    }
    closeLoginOverlay();
    await loadAuthStatus();
  } catch (err) {
    el('#loginStatus').textContent = err.message;
    el('#loginStatus').className = 'status err';
  }
}

async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  loadAuthStatus();
}

el('#loginClose').addEventListener('click', closeLoginOverlay);
el('#loginOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'loginOverlay' && !el('#loginOverlay').classList.contains('mandatory')) closeLoginOverlay();
});
el('#loginForm').addEventListener('submit', doLogin);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el('#loginOverlay').hidden && !el('#loginOverlay').classList.contains('mandatory')) closeLoginOverlay();
});

// ---- Manage accounts modal (opened via the gear next to "Secured visitors") ----

function openAccountsOverlay() {
  el('#accountsOverlay').hidden = false;
  loadUserList();
}

function closeAccountsOverlay() {
  el('#accountsOverlay').hidden = true;
}

el('#accountsGearBtn').addEventListener('click', openAccountsOverlay);
el('#accountsClose').addEventListener('click', closeAccountsOverlay);
el('#accountsOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'accountsOverlay') closeAccountsOverlay();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el('#accountsOverlay').hidden) closeAccountsOverlay();
});

el('#addUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = el('#newUserUsername').value.trim();
  const password = el('#newUserPassword').value;
  const role = el('#newUserRole').value;
  const status = el('#userStatus');
  try {
    const res = await fetch('/api/auth/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not add that account.');
    e.target.reset();
    status.className = 'status ok';
    status.textContent = `Added "${data.username}".`;
    loadUserList();
  } catch (err) {
    status.className = 'status err';
    status.textContent = err.message;
  }
});

// ---------- Shared clipboard-image helpers ----------
// Used by Draw's Copy button (writes to the OS clipboard) and by the paste
// handlers in Docs/Notes/Slides/Messages (reads from it) — this is what
// lets a drawing get copied out of Draw and pasted into any of those tools.

// Pulls an image out of a paste event, if there is one. Returns null for a
// plain-text paste so normal typing/pasting elsewhere is never intercepted.
function extractImageFromClipboardEvent(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return null;
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      return item.getAsFile();
    }
  }
  return null;
}

// Downscales an image file to a reasonable max dimension before it gets
// embedded in a document/note/slide or sent as a message — keeps stored
// JSON and P2P message payloads from ballooning on a large screenshot.
function resizeImageFile(file, maxDimension) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- Search ----------

function applyFilters() {
  if (state.view !== 'shelf') return;
  const q = el('#searchBox').value.toLowerCase();
  const playFilter = el('#playCountFilter').value;
  el('#searchClearBtn').hidden = el('#searchBox').value === '';

  let filtered = state.files.filter(f => {
    if (q && !f.name.toLowerCase().includes(q)) return false;
    // "mostplayed" and "artist" are sort modes, not thresholds — handled
    // by sorting below instead of filtering here.
    if (playFilter && playFilter !== 'mostplayed' && playFilter !== 'artist') {
      const plays = f.plays || 0;
      if (playFilter === '0') return plays === 0;
      return plays >= parseInt(playFilter, 10); // "1+" -> 1, "5+" -> 5, etc.
    }
    return true;
  });

  if (playFilter === 'mostplayed') {
    filtered = filtered.slice().sort((a, b) => (b.plays || 0) - (a.plays || 0) || a.name.localeCompare(b.name));
  } else if (playFilter === 'artist') {
    // Untagged tracks sort to the end rather than clumping at the top
    // under an empty/blank artist.
    filtered = filtered.slice().sort((a, b) => {
      if (!a.artist && !b.artist) return a.name.localeCompare(b.name);
      if (!a.artist) return 1;
      if (!b.artist) return -1;
      return a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name);
    });
  }

  state.filtered = filtered;
  refreshMusicPlaylistIfPlaying();
  renderHeader();
  renderContent();
}

el('#searchBox').addEventListener('input', applyFilters);
el('#playCountFilter').addEventListener('change', applyFilters);
el('#searchClearBtn').addEventListener('click', () => {
  el('#searchBox').value = '';
  el('#searchBox').focus();
  applyFilters();
});

// ---------- Music playback ----------

const audio = el('#audioPlayer');
const miniPlayer = el('#miniPlayer');

// Audio visualizer: lazily set up on first play, since creating an
// AudioContext before a user gesture gets blocked by autoplay policies.
//
// Computers and Android: the analyser taps the real `audio` element
// directly, so the bars read the exact samples you're hearing.
//
// iPhone/iPad: the real element must NEVER be tapped. Calling
// createMediaElementSource(audio) reroutes that element's sound through an
// AudioContext for the rest of its life, and iOS suspends AudioContexts in
// the background -- which used to silence the music on the lock screen with
// no way back. So on iOS the bars are computed from the decoded song
// instead (see pcmViz below), and the real player stays a plain <audio> tag.
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports itself as a Mac

let visualizerCtx = null;
let visualizerAnalyser = null;
let visualizerData = null;
let visualizerScopeAnalyser = null;
let visualizerTimeData = null;
let visualizerRunning = false;
let vizAudio = null; // iOS fallback for very long tracks only

function ensureVisualizer() {
  if (IS_IOS) {
    // iPhone/iPad: the bars are computed straight from the decoded song
    // (see pcmViz below) -- no AudioContext, no second copy playing. These
    // are just the arrays the drawing code reads from.
    if (!visualizerData) {
      visualizerData = new Uint8Array(32);
      visualizerTimeData = new Uint8Array(2048).fill(128);
    }
    return;
  }
  if (visualizerCtx) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    visualizerCtx = new AudioCtx();
    const source = visualizerCtx.createMediaElementSource(audio);

    visualizerAnalyser = visualizerCtx.createAnalyser();
    visualizerAnalyser.fftSize = 64;
    visualizerData = new Uint8Array(visualizerAnalyser.frequencyBinCount);

    // A separate, higher-resolution analyser just for the oscilloscope
    // style — the bar styles want a small fftSize for a few chunky bars,
    // but a scope trace needs many more sample points to look smooth. Both
    // just tap the same source.
    visualizerScopeAnalyser = visualizerCtx.createAnalyser();
    visualizerScopeAnalyser.fftSize = 2048;
    visualizerTimeData = new Uint8Array(visualizerScopeAnalyser.fftSize);

    source.connect(visualizerAnalyser);
    source.connect(visualizerScopeAnalyser);
    // Direct tap: the real music flows through the analyser on its way to
    // the speakers, so only one path continues on -- nothing doubled up.
    visualizerAnalyser.connect(visualizerCtx.destination);
  } catch {
    visualizerCtx = null; // visualizer just won't show — playback itself is unaffected
  }
}

// ---------- iPhone/iPad visualizer: computed from the song itself ----------
// When a track starts, the file is fetched once and decoded to plain sound
// samples (mono, 22,050 per second -- about 21 MB for a 4-minute song).
// Every animation frame then reads the slice of samples at the real
// player's current position and runs the same maths the browser's own
// analyser would (a 64-point FFT with a Blackman window, the same smoothing
// and the same -100..-30 dB scale), so the bars look the same as on a
// computer. Nothing plays in parallel and nothing can drift: the bars are
// tied directly to the position you're hearing, through seeks and pauses.
//
// Very long tracks (an hour-long mix) would take too much memory to decode
// on a phone, so those fall back to the older "silent second copy"
// approach (ensureShadowVisualizer / syncVizAudio below).
const PCM_VIZ_RATE = 22050;
const PCM_VIZ_MAX_SECONDS = 12 * 60;
const PCM_FFT = 64;
let pcmViz = { src: null, data: null, rate: PCM_VIZ_RATE, ready: false, fallback: false };
const pcmVizSmoothed = new Float32Array(PCM_FFT / 2);
const pcmVizWindow = new Float32Array(PCM_FFT);
const pcmVizCos = [], pcmVizSin = [];
for (let n = 0; n < PCM_FFT; n++) {
  pcmVizWindow[n] = 0.42 - 0.5 * Math.cos(2 * Math.PI * n / PCM_FFT) + 0.08 * Math.cos(4 * Math.PI * n / PCM_FFT);
}
for (let k = 0; k < PCM_FFT / 2; k++) {
  pcmVizCos.push(Float32Array.from({ length: PCM_FFT }, (_, n) => Math.cos(2 * Math.PI * k * n / PCM_FFT)));
  pcmVizSin.push(Float32Array.from({ length: PCM_FFT }, (_, n) => Math.sin(2 * Math.PI * k * n / PCM_FFT)));
}

function waitForDuration(timeoutMs) {
  if (audio.duration && isFinite(audio.duration)) return Promise.resolve(audio.duration);
  return new Promise(resolve => {
    const done = () => { clearTimeout(t); audio.removeEventListener('loadedmetadata', done); resolve(audio.duration || 0); };
    const t = setTimeout(done, timeoutMs);
    audio.addEventListener('loadedmetadata', done);
  });
}

function decodeToBuffer(ctx, arrayBuffer) {
  // Older Safari only has the callback form of decodeAudioData.
  return new Promise((resolve, reject) => {
    const r = ctx.decodeAudioData(arrayBuffer, resolve, reject);
    if (r && typeof r.then === 'function') r.then(resolve, reject);
  });
}

async function preparePcmViz() {
  const src = audio.src;
  if (!src || pcmViz.src === src) return; // already ready or on its way for this track
  pcmViz = { src, data: null, rate: PCM_VIZ_RATE, ready: false, fallback: false };
  pcmVizSmoothed.fill(0);
  const useFallback = () => {
    if (pcmViz.src !== src) return;
    pcmViz.fallback = true;
    ensureShadowVisualizer();
    syncVizAudio(true);
  };
  try {
    const duration = await waitForDuration(6000);
    if (pcmViz.src !== src) return; // a different track started meanwhile
    if (!duration || duration > PCM_VIZ_MAX_SECONDS) return useFallback();

    const res = await fetch(src);
    if (!res.ok) throw new Error('fetch failed');
    const bytes = await res.arrayBuffer();
    if (pcmViz.src !== src) return;

    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const decoded = await decodeToBuffer(new Offline(1, 1, PCM_VIZ_RATE), bytes);
    if (pcmViz.src !== src) return;

    const mono = new Float32Array(decoded.length);
    const channels = decoded.numberOfChannels;
    for (let c = 0; c < channels; c++) {
      const ch = decoded.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / channels;
    }
    pcmViz = { src, data: mono, rate: decoded.sampleRate, ready: true, fallback: false };
    if (vizAudio) vizAudio.pause(); // a previous long track's fallback copy isn't needed now
  } catch {
    useFallback();
  }
}

// audio.currentTime can update in coarse steps on some browsers; between
// steps, advance it with the wall clock so the bars move every frame
// instead of jumping a few times a second.
let pcmVizClock = { media: 0, wall: 0 };
function pcmVizTime() {
  const ct = audio.currentTime, now = performance.now();
  if (audio.paused || ct !== pcmVizClock.media) { pcmVizClock = { media: ct, wall: now }; return ct; }
  return ct + Math.min(0.5, (now - pcmVizClock.wall) / 1000) * (audio.playbackRate || 1);
}

function fillVizFromPcm() {
  const { data, rate } = pcmViz;
  const end = Math.floor(pcmVizTime() * rate);

  // Bars: same as AnalyserNode.getByteFrequencyData with fftSize 64.
  const start = end - PCM_FFT;
  for (let k = 0; k < PCM_FFT / 2; k++) {
    let re = 0, im = 0;
    const cosK = pcmVizCos[k], sinK = pcmVizSin[k];
    for (let n = 0; n < PCM_FFT; n++) {
      const idx = start + n;
      const x = (idx >= 0 && idx < data.length ? data[idx] : 0) * pcmVizWindow[n];
      re += x * cosK[n];
      im -= x * sinK[n];
    }
    const mag = Math.sqrt(re * re + im * im) / PCM_FFT;
    pcmVizSmoothed[k] = 0.8 * pcmVizSmoothed[k] + 0.2 * mag;
    const db = pcmVizSmoothed[k] > 0 ? 20 * Math.log10(pcmVizSmoothed[k]) : -Infinity;
    visualizerData[k] = Math.max(0, Math.min(255, Math.floor((255 / 70) * (db + 100))));
  }

  // Oscilloscope: the same ~46 ms window the desktop scope shows.
  const span = (2048 / 44100) * rate;
  const len = visualizerTimeData.length;
  for (let i = 0; i < len; i++) {
    const pos = end - span + (i * span) / len;
    const i0 = Math.floor(pos), frac = pos - i0;
    const a = i0 >= 0 && i0 < data.length ? data[i0] : 0;
    const b = i0 + 1 >= 0 && i0 + 1 < data.length ? data[i0 + 1] : 0;
    visualizerTimeData[i] = Math.max(0, Math.min(255, Math.round(128 * (1 + a + (b - a) * frac))));
  }
}

// iOS fallback for very long tracks only: a second, silent <audio> element
// mirroring the real one, tapped by an AudioContext. (The real `audio`
// element is never tapped on iOS -- doing that is what used to break
// lock-screen playback.)
function ensureShadowVisualizer() {
  if (visualizerAnalyser) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    visualizerCtx = new AudioCtx();
    vizAudio = new Audio();
    vizAudio.preload = 'auto';
    const source = visualizerCtx.createMediaElementSource(vizAudio);
    visualizerAnalyser = visualizerCtx.createAnalyser();
    visualizerAnalyser.fftSize = 64;
    visualizerScopeAnalyser = visualizerCtx.createAnalyser();
    visualizerScopeAnalyser.fftSize = 2048;
    source.connect(visualizerAnalyser);
    source.connect(visualizerScopeAnalyser);
    // Routed to the speakers through a zeroed gain node rather than muting
    // the element (muting tends to zero the analyser's data too), so the
    // copy is silent but the analyser still sees full-strength sound.
    const silentOutput = visualizerCtx.createGain();
    silentOutput.gain.value = 0;
    visualizerAnalyser.connect(silentOutput);
    silentOutput.connect(visualizerCtx.destination);
  } catch {
    visualizerAnalyser = null;
    vizAudio = null;
  }
}

// Keeps the fallback copy in step with the real player -- only for a long
// track that couldn't be decoded. Small drift is corrected smoothly by
// running the copy a few percent fast or slow; a hard jump only happens on
// a new track, play, or seek, or as a rare last resort if it's way off.
let lastVizHardSync = 0;
function syncVizAudio(force = false) {
  if (!vizAudio) return;
  try {
    if (!(pcmViz.fallback && pcmViz.src === audio.src)) { vizAudio.pause(); return; }
    if (vizAudio.src !== audio.src) { vizAudio.src = audio.src; force = true; }
    if (audio.paused) { vizAudio.pause(); return; }

    const drift = (vizAudio.currentTime || 0) - (audio.currentTime || 0); // positive = copy is ahead
    const now = performance.now();
    if (force || (Math.abs(drift) > 1 && now - lastVizHardSync > 4000)) {
      lastVizHardSync = now;
      vizAudio.playbackRate = 1;
      vizAudio.currentTime = audio.currentTime || 0;
    } else if (Math.abs(drift) > 0.04) {
      vizAudio.playbackRate = Math.min(1.08, Math.max(0.92, 1 - drift * 0.5));
    } else if (vizAudio.playbackRate !== 1) {
      vizAudio.playbackRate = 1;
    }
    if (vizAudio.paused) vizAudio.play().catch(() => {}); // blocked/suspended -- the visualizer just won't animate
  } catch { /* cosmetic only */ }
}

// Lets the "solid gradient" styles (bars, mirror, radial, scope) be dialed
// anywhere between the classic warm orange look and a phosphor-green
// oscilloscope look, via the slider in the fullscreen controls. Defaults
// to orange (0) so the existing bar styles look exactly as they did
// before this existed — sliding toward 1 shifts everything toward green.
const savedVizMixRaw = localStorage.getItem('shelf-viz-color-mix');
let vizColorMix = savedVizMixRaw === null ? 0 : Math.min(1, Math.max(0, Number(savedVizMixRaw) || 0));

function vizGradientColors(mix) {
  const orangeDeep = [255, 61, 0];    // #FF3D00
  const orangeBright = [255, 200, 0]; // #FFC800
  const greenDeep = [0, 90, 40];
  const greenBright = [90, 255, 130];
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const deep = `rgb(${lerp(orangeDeep[0], greenDeep[0], mix)}, ${lerp(orangeDeep[1], greenDeep[1], mix)}, ${lerp(orangeDeep[2], greenDeep[2], mix)})`;
  const bright = `rgb(${lerp(orangeBright[0], greenBright[0], mix)}, ${lerp(orangeBright[1], greenBright[1], mix)}, ${lerp(orangeBright[2], greenBright[2], mix)})`;
  return [deep, bright];
}

// A warm-to-green gradient — deep/orange for quiet/short bars, brightening
// toward gold or green (depending on the color slider) the taller/louder
// they get. One shared gradient object per frame (reused across every
// bar/line, not recreated per-bar) is what gives short and tall bars
// naturally different colors without any manual per-bar color logic — a
// bar's own height determines how much of the gradient's range it shows.
function warmVizGradient(ctx, canvas) {
  const [deep, bright] = vizGradientColors(vizColorMix);
  const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
  gradient.addColorStop(0, deep);
  gradient.addColorStop(1, bright);
  return gradient;
}

function drawVisualizerToCanvas(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const barCount = visualizerData.length;
  const barWidth = canvas.width / barCount;
  ctx.fillStyle = warmVizGradient(ctx, canvas);
  for (let i = 0; i < barCount; i++) {
    const barHeight = (visualizerData[i] / 255) * canvas.height;
    ctx.fillRect(i * barWidth, canvas.height - barHeight, barWidth - 1, barHeight);
  }
}

// A few different fullscreen visualization looks, cycled with a single
// click on the fullscreen view. The mini player's tiny canvas always
// stays the plain bar style above — these fancier ones need real screen
// space to actually read well.
const VIZ_STYLE_COUNT = 6;
let currentVizStyle = 0;

// State for the two animated styles below — these aren't a pure function
// of the current instant's audio data like the bar styles are, they
// accumulate over time (a running rotation angle, a live particle field),
// so that state has to persist across frames at module level.
let vizKaleidoscopeRotation = 0;
let vizHueTime = 0;
let vizParticles = [];

function drawFullscreenVisualizer(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (currentVizStyle === 0) drawVizBars(ctx, canvas);
  else if (currentVizStyle === 1) drawVizMirrorBars(ctx, canvas);
  else if (currentVizStyle === 2) drawVizRadial(ctx, canvas);
  else if (currentVizStyle === 3) drawVizKaleidoscope(ctx, canvas);
  else if (currentVizStyle === 4) drawVizStarfield(ctx, canvas);
  else drawVizScope(ctx, canvas);
}

function drawVizBars(ctx, canvas) {
  const barCount = visualizerData.length;
  const barWidth = canvas.width / barCount;
  ctx.fillStyle = warmVizGradient(ctx, canvas);
  for (let i = 0; i < barCount; i++) {
    const barHeight = (visualizerData[i] / 255) * canvas.height;
    ctx.fillRect(i * barWidth, canvas.height - barHeight, barWidth - 1, barHeight);
  }
}

function drawVizMirrorBars(ctx, canvas) {
  const barCount = visualizerData.length;
  const barWidth = canvas.width / barCount;
  const midY = canvas.height / 2;
  // Brightest at the center, deepening toward the top and bottom edges —
  // the mirrored equivalent of "louder = brighter."
  const [deep, bright] = vizGradientColors(vizColorMix);
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, deep);
  gradient.addColorStop(0.5, bright);
  gradient.addColorStop(1, deep);
  ctx.fillStyle = gradient;
  for (let i = 0; i < barCount; i++) {
    const halfHeight = (visualizerData[i] / 255) * midY;
    ctx.fillRect(i * barWidth, midY - halfHeight, barWidth - 1, halfHeight * 2);
  }
}

function drawVizRadial(ctx, canvas) {
  const barCount = visualizerData.length;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const baseRadius = Math.min(canvas.width, canvas.height) * 0.16;
  const maxExtra = Math.min(canvas.width, canvas.height) * 0.30;
  // Brightest near the center, deepening toward the outer edge — the
  // radial equivalent of the same "louder = brighter" gradient.
  const [deep, bright] = vizGradientColors(vizColorMix);
  const gradient = ctx.createRadialGradient(cx, cy, baseRadius, cx, cy, baseRadius + maxExtra);
  gradient.addColorStop(0, bright);
  gradient.addColorStop(1, deep);
  ctx.lineWidth = Math.max(2, (Math.min(canvas.width, canvas.height) / barCount) * 1.8);
  ctx.lineCap = 'round';
  ctx.strokeStyle = gradient;
  for (let i = 0; i < barCount; i++) {
    const angle = (i / barCount) * Math.PI * 2;
    const len = baseRadius + (visualizerData[i] / 255) * maxExtra;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * baseRadius, cy + Math.sin(angle) * baseRadius);
    ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    ctx.stroke();
  }
}

// A ring of shapes, one per frequency bin, continuously rotating — the
// rotation is time-based (always spinning, whether the music is loud or
// quiet), while each shape's size and color respond to that bin's current
// amplitude. Mirrored across the center for a fuller kaleidoscope feel.
function drawVizKaleidoscope(ctx, canvas) {
  const barCount = visualizerData.length;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const baseRadius = Math.min(canvas.width, canvas.height) * 0.12;
  const maxExtra = Math.min(canvas.width, canvas.height) * 0.32;

  vizKaleidoscopeRotation += 0.006;
  vizHueTime = (vizHueTime + 0.6) % 360;

  for (let i = 0; i < barCount; i++) {
    const amp = visualizerData[i] / 255;
    const angle = (i / barCount) * Math.PI * 2 + vizKaleidoscopeRotation;
    const dist = baseRadius + amp * maxExtra;
    const size = 5 + amp * 24;
    const hue = (vizHueTime + i * (360 / barCount)) % 360;
    ctx.fillStyle = `hsl(${hue}, 85%, 60%)`;

    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();

    // The mirrored point on the opposite side of center, a touch smaller —
    // this is what actually makes it read as a symmetric kaleidoscope
    // rather than just a spinning ring.
    const x2 = cx - Math.cos(angle) * dist;
    const y2 = cy - Math.sin(angle) * dist;
    ctx.beginPath();
    ctx.arc(x2, y2, size * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

// A field of small colored shapes launched from the center and flying
// outward past the viewer, spawn rate and speed both tied to how loud the
// music is right now. Particles persist across frames (module-level state,
// not just a function of this instant's audio data), aging and fading as
// they travel until they're removed once they're off-screen.
function drawVizStarfield(ctx, canvas) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  let energy = 0;
  for (let i = 0; i < visualizerData.length; i++) energy += visualizerData[i];
  energy = energy / visualizerData.length / 255; // 0..1

  vizHueTime = (vizHueTime + 1.2) % 360;

  const spawnCount = Math.round(1 + energy * 6);
  for (let s = 0; s < spawnCount && vizParticles.length < 220; s++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + energy * 7 + Math.random() * 2;
    vizParticles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 3 + Math.random() * 5 + energy * 8,
      hue: (vizHueTime + Math.random() * 60) % 360,
      shape: Math.floor(Math.random() * 3) // 0 circle, 1 square, 2 triangle
    });
  }

  const maxDist = Math.hypot(canvas.width, canvas.height) / 2;
  vizParticles = vizParticles.filter(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.life = 1 - Math.hypot(p.x - cx, p.y - cy) / maxDist;
    return p.life > 0;
  });

  for (const p of vizParticles) {
    ctx.fillStyle = `hsla(${p.hue}, 85%, 62%, ${Math.max(0, p.life)})`;
    const sz = p.size * (0.6 + p.life * 0.6);
    if (p.shape === 0) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, sz, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.shape === 1) {
      ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    } else {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - sz);
      ctx.lineTo(p.x - sz, p.y + sz);
      ctx.lineTo(p.x + sz, p.y + sz);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// A classic oscilloscope trace — the actual waveform shape, not frequency
// bars — drawn from the higher-resolution time-domain analyser. Color
// follows the same orange-to-green slider as the other "solid" styles.
function drawVizScope(ctx, canvas) {
  if (!visualizerTimeData) return;
  const [, bright] = vizGradientColors(vizColorMix);
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = bright;
  ctx.shadowBlur = 14;
  ctx.shadowColor = bright;
  ctx.beginPath();
  const sliceWidth = canvas.width / visualizerTimeData.length;
  let x = 0;
  for (let i = 0; i < visualizerTimeData.length; i++) {
    const v = visualizerTimeData[i] / 128.0; // centered at 1.0, ranges roughly 0..2
    const y = (v * canvas.height) / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += sliceWidth;
  }
  ctx.stroke();
  ctx.shadowBlur = 0; // reset so the glow doesn't bleed into whatever draws next frame
}

function drawVisualizerFrame() {
  if (!visualizerData) return;
  if (IS_IOS && pcmViz.ready && pcmViz.src === audio.src) {
    fillVizFromPcm();
  } else if (visualizerAnalyser) {
    visualizerAnalyser.getByteFrequencyData(visualizerData);
    if (visualizerScopeAnalyser) visualizerScopeAnalyser.getByteTimeDomainData(visualizerTimeData);
  } else {
    // iOS, track still decoding (a moment at the start of a song): let the
    // bars settle down gently rather than freezing mid-jump.
    for (let i = 0; i < visualizerData.length; i++) visualizerData[i] = Math.floor(visualizerData[i] * 0.9);
    visualizerTimeData.fill(128);
  }
  drawVisualizerToCanvas(el('#miniVisualizer'));
  if (!el('#fullscreenVizOverlay').hidden) drawFullscreenVisualizer(el('#fullscreenVisualizer'));
  if (visualizerRunning) requestAnimationFrame(drawVisualizerFrame);
}

function startVisualizer() {
  ensureVisualizer();
  if (IS_IOS) preparePcmViz();
  if (visualizerCtx && visualizerCtx.state === 'suspended') visualizerCtx.resume();
  syncVizAudio(true);
  if (!visualizerRunning) {
    visualizerRunning = true;
    drawVisualizerFrame();
  }
}

function stopVisualizer() {
  visualizerRunning = false;
  if (vizAudio) vizAudio.pause();
  const canvas = el('#miniVisualizer');
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

// ---------- Fullscreen visualizer ----------
// Double-click the little mini-player visualizer to blow it up to a real
// fullscreen view — same audio data, just drawn onto a much bigger canvas.

function resizeFullscreenVisualizerCanvas() {
  const canvas = el('#fullscreenVisualizer');
  if (!canvas) return;
  // Canvas internal resolution has to match its actual displayed size, or
  // the bars render squashed/stretched — the same lesson learned earlier
  // with the Draw canvas.
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

// Shows the current track's album art in the corner of the fullscreen
// view, if it has any — hidden entirely for tracks with no art cached,
// rather than showing an empty box or a placeholder.
function updateFullscreenVizArt() {
  const img = el('#fullscreenVizArt');
  if (state.currentTrackArtUrl) {
    img.src = state.currentTrackArtUrl;
    img.hidden = false;
  } else {
    img.hidden = true;
  }
}

// Same idea for the small thumbnail in the mini player — an actual image
// when the current track has art, the same music-note placeholder used in
// the track list otherwise (rather than just leaving an empty box).
function updateMiniArt() {
  const img = el('#miniArtImg');
  const placeholder = el('#miniArtPlaceholder');
  if (state.currentTrackArtUrl) {
    img.src = state.currentTrackArtUrl;
    img.hidden = false;
    placeholder.hidden = true;
  } else {
    img.hidden = true;
    placeholder.hidden = false;
  }
}

function openFullscreenVisualizer() {
  const overlay = el('#fullscreenVizOverlay');
  overlay.hidden = false;
  resizeFullscreenVisualizerCanvas();
  el('#fullscreenVizTitle').textContent = state.currentTrackName || '\u2014';
  updateFullscreenVizArt();
  if (overlay.requestFullscreen) {
    overlay.requestFullscreen().catch(() => {
      // Fullscreen not available in this browser/context — the overlay
      // itself still works fine as a large in-page view.
    });
  }
  // Briefly hint that clicking cycles the style, then fade it out — no
  // need to keep it up once someone's seen it once this session.
  overlay.classList.add('show-hint');
  setTimeout(() => overlay.classList.remove('show-hint'), 2600);
}

function closeFullscreenVisualizer() {
  el('#fullscreenVizOverlay').hidden = true;
  if (document.fullscreenElement === el('#fullscreenVizOverlay')) {
    document.exitFullscreen().catch(() => {});
  }
  vizParticles = [];
}

el('#miniVisualizer').addEventListener('dblclick', openFullscreenVisualizer);
el('#miniArt').addEventListener('mouseenter', () => {
  const img = el('#miniArtImg');
  if (!img.hidden) showArtPreview(el('#miniArt'), img.src);
});
el('#miniArt').addEventListener('mouseleave', hideArtPreview);
el('#miniArt').addEventListener('click', (e) => {
  const img = el('#miniArtImg');
  if (img.hidden) return; // nothing to show for the placeholder note icon
  e.stopPropagation();
  toggleArtPreview(el('#miniArt'), img.src);
});
el('#fullscreenVizOverlay').addEventListener('dblclick', closeFullscreenVisualizer);
el('#fullscreenVizClose').addEventListener('click', (e) => {
  e.stopPropagation(); // don't also trigger the overlay's own click-to-close
  closeFullscreenVisualizer();
});
// Crude playback controls shown at the bottom while fullscreen — same
// shared audio state as the mini player, kept in sync with it. The whole
// controls bar stops clicks (single or double) from bubbling up, so
// fumbling a control doesn't cycle the style or close the fullscreen view.
el('.fullscreen-viz-controls').addEventListener('click', (e) => e.stopPropagation());
el('.fullscreen-viz-controls').addEventListener('dblclick', (e) => e.stopPropagation());
el('#vizPlayPause').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMusicPlayPause();
});
el('#vizNextTrack').addEventListener('click', (e) => {
  e.stopPropagation();
  playNextTrack();
});
el('#vizColorSlider').value = Math.round(vizColorMix * 100);
el('#vizColorSlider').addEventListener('click', (e) => e.stopPropagation());
el('#vizColorSlider').addEventListener('input', (e) => {
  vizColorMix = Number(e.target.value) / 100;
  localStorage.setItem('shelf-viz-color-mix', String(vizColorMix));
});

// A single click cycles the visualization style; a double-click closes
// the view (wired above) — the two need to be told apart, since a
// double-click always fires a "click" as its first half too. Waiting a
// beat before acting on a single click is the standard way to do that.
let vizStyleClickTimer = null;
el('#fullscreenVizOverlay').addEventListener('click', () => {
  if (vizStyleClickTimer) {
    // Second click of a double-click arrived — that's a close, not a
    // style change, so cancel the pending single-click action.
    clearTimeout(vizStyleClickTimer);
    vizStyleClickTimer = null;
    return;
  }
  vizStyleClickTimer = setTimeout(() => {
    vizStyleClickTimer = null;
    currentVizStyle = (currentVizStyle + 1) % VIZ_STYLE_COUNT;
  }, 250);
});

window.addEventListener('resize', () => {
  if (!el('#fullscreenVizOverlay').hidden) resizeFullscreenVisualizerCanvas();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el('#fullscreenVizOverlay').hidden) closeFullscreenVisualizer();
});

// ---------- Lock-screen / Control Center controls ----------
// On iOS the visualizer taps a separate silent element (see
// ensureVisualizer() above) rather than the real `audio` element, so the
// real player is a plain, un-tainted <audio> tag with nothing routing its
// sound through an AudioContext -- which is what makes iOS treat it as a
// normal background-audio session with working lock-screen controls in
// the first place. These handlers just make sure the Control Center widget's buttons
// actually call into the same logic as the in-app controls, rather than
// whatever the browser's default (and sometimes unreliable) handling of a
// playing <audio> element would otherwise do.
//
// musicIntentPlaying tracks whether the *user* (or the lock screen, which
// counts the same) last asked for playback, as opposed to something else
// pausing it -- that's what visibilitychange below uses to decide whether
// coming back to the tab should resume automatically.
let musicIntentPlaying = false;

function updateMediaSessionMetadata(f) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: f.name,
    artist: f.artist || 'The Shelf',
    album: 'The Shelf',
    artwork: f.artUrl ? [{ src: f.artUrl, sizes: '512x512', type: 'image/jpeg' }] : []
  });
}

function setupMediaSessionHandlers() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play', () => {
    musicIntentPlaying = true;
    audio.play().catch(() => {});
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    musicIntentPlaying = false;
    audio.pause();
  });
  navigator.mediaSession.setActionHandler('previoustrack', () => playPreviousTrack());
  navigator.mediaSession.setActionHandler('nexttrack', () => playNextTrack());
  navigator.mediaSession.setActionHandler('stop', () => stopMusicPlayback());
}
setupMediaSessionHandlers();

// A safety net in case anything still manages to pause the real element out
// from under us (a background tab getting reloaded by iOS under memory
// pressure, say): coming back to the tab resumes playback if it was
// supposed to still be going, rather than leaving a silent "playing" mini
// player behind until the person notices and hits play again. The
// visualizer's own context/element get a nudge too, but purely cosmetic --
// nothing here is required for the music itself to keep going.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (visualizerCtx && visualizerCtx.state === 'suspended') visualizerCtx.resume();
  if (musicIntentPlaying && audio.paused && audio.src) audio.play().catch(() => {});
  syncVizAudio(true);
});

function playTrack(index) {
  const f = state.filtered[index];
  if (!f) return;
  state.slideshow.musicStartedByUs = false;
  // Snapshot the currently-visible order as "up next" — a stable copy, not
  // a live reference to state.filtered, so playback keeps advancing
  // correctly through the right list even if you navigate away, search, or
  // the shelf's contents change while a song is playing.
  state.musicSourceList = state.filtered.slice();
  const order = buildPlayOrder(state.musicSourceList, index);
  state.musicPlaylist = order.list;
  state.musicPlaylistIndex = order.index;
  playTrackFile(f, index);
}

// ---------- Shuffle ----------
// The queue is kept two ways: musicSourceList is the list in its normal
// (on-screen) order, and musicPlaylist is the order songs actually play in
// -- the same list when shuffle is off, or the chosen song followed by
// everything else in random order when it's on. Every song plays once per
// run, no repeats, and next/previous (including the lock-screen buttons)
// just walk whichever order is active. Remembered between visits.
let musicShuffle = false;
try { musicShuffle = localStorage.getItem('shelf-shuffle') === '1'; } catch { /* storage blocked -- default off */ }

function shuffledCopy(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { // Fisher-Yates: every order equally likely
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildPlayOrder(source, startIndex) {
  if (!musicShuffle) return { list: source.slice(), index: startIndex };
  const first = source[startIndex];
  return { list: [first, ...shuffledCopy(source.filter((_, i) => i !== startIndex))], index: 0 };
}

function applyShuffleButton() {
  const btn = el('#miniShuffleBtn');
  btn.classList.toggle('on', musicShuffle);
  btn.setAttribute('aria-pressed', String(musicShuffle));
  btn.title = musicShuffle ? 'Shuffle is on' : 'Shuffle is off';
}

// Flipping shuffle mid-song re-orders what's still to come; the song
// that's playing carries on uninterrupted.
function setMusicShuffle(on) {
  musicShuffle = on;
  try { localStorage.setItem('shelf-shuffle', on ? '1' : '0'); } catch { /* fine */ }
  applyShuffleButton();
  if (!state.currentTrackName || state.musicPlaylistIndex < 0) return;
  const source = (state.musicSourceList && state.musicSourceList.length) ? state.musicSourceList : state.musicPlaylist;
  const current = source.findIndex(f => f.name === state.currentTrackName);
  if (current === -1) return;
  const order = buildPlayOrder(source, current);
  state.musicPlaylist = order.list;
  state.musicPlaylistIndex = order.index;
}

el('#miniShuffleBtn').addEventListener('click', () => setMusicShuffle(!musicShuffle));
applyShuffleButton();

// "Shuffle play" on the Music shelf: shuffle on, starting from a random
// song in whatever's currently shown (so a search or filter narrows it).
el('#shuffleAllBtn').addEventListener('click', () => {
  if (!state.filtered.length) return;
  setMusicShuffle(true);
  playTrack(Math.floor(Math.random() * state.filtered.length));
});

function playTrackFile(f, renderedIndex) {
  musicIntentPlaying = true;
  audio.src = f.url;
  audio.play().catch(() => { /* superseded by a newer track before it started -- expected when skipping quickly */ });
  startVisualizer();
  state.currentTrackName = f.name;
  state.currentTrackArtUrl = f.artUrl || null;
  miniPlayer.hidden = false;
  el('#miniTitle').textContent = f.name;
  setPlayPauseIcon(true);
  updateMiniArt();
  updateMediaSessionMetadata(f);
  if (!el('#fullscreenVizOverlay').hidden) {
    el('#fullscreenVizTitle').textContent = f.name;
    updateFullscreenVizArt();
  }
  document.querySelectorAll('.track-row').forEach(r => r.classList.remove('playing'));
  if (renderedIndex != null) {
    const row = document.querySelector(`.track-row[data-index="${renderedIndex}"]`);
    if (row) row.classList.add('playing');
  }
  recordPlay('Music', f.name);
}

// Advances to the next track in the snapshotted playlist, if there is one.
// Looks the track back up by name in whatever's currently rendered (rather
// than trusting the snapshot's own index) so the "now playing" highlight
// still lands on the right row if you're still viewing Music.
function playNextTrack() {
  if (state.musicPlaylistIndex < 0) return;
  const nextIndex = state.musicPlaylistIndex + 1;
  const next = state.musicPlaylist[nextIndex];
  if (!next) return; // reached the end of the list — stop rather than loop
  state.musicPlaylistIndex = nextIndex;
  const renderedIndex = state.filtered.findIndex(f => f.name === next.name);
  playTrackFile(next, renderedIndex === -1 ? null : renderedIndex);
}

// Same idea, one track back -- there's no in-app button for this yet, but
// the lock-screen / Control Center widget shows a previous-track button by
// default once Media Session handlers are registered, so it should do
// something sensible rather than nothing.
function playPreviousTrack() {
  if (state.musicPlaylistIndex < 0) return;
  const prevIndex = state.musicPlaylistIndex - 1;
  const prev = state.musicPlaylist[prevIndex];
  if (!prev) return; // already at the start of the list
  state.musicPlaylistIndex = prevIndex;
  const renderedIndex = state.filtered.findIndex(f => f.name === prev.name);
  playTrackFile(prev, renderedIndex === -1 ? null : renderedIndex);
}

audio.addEventListener('pause', stopVisualizer);
audio.addEventListener('play', startVisualizer);
// Keeps the Control Center / lock-screen widget's own play/pause display in
// sync even when playback starts or stops some way other than the mini
// player's button -- a lock-screen tap, or iOS resuming things on its own.
audio.addEventListener('play', () => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
});
audio.addEventListener('pause', () => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
});
audio.addEventListener('ended', () => {
  try { stopVisualizer(); } catch { /* cleanup hiccup shouldn't block advancing to the next track */ }
  playNextTrack();
});

function setPlayPauseIcon(isPlaying) {
  const icon = isPlaying ? '&#10074;&#10074;' : '&#9658;';
  el('#miniPlayPause').innerHTML = icon;
  const vizBtn = el('#vizPlayPause');
  if (vizBtn) vizBtn.innerHTML = icon;
}

function toggleMusicPlayPause() {
  if (audio.paused) {
    musicIntentPlaying = true;
    if (visualizerCtx && visualizerCtx.state === 'suspended') visualizerCtx.resume();
    audio.play();
    setPlayPauseIcon(true);
  } else {
    musicIntentPlaying = false;
    audio.pause();
    setPlayPauseIcon(false);
  }
}

el('#miniPlayPause').addEventListener('click', toggleMusicPlayPause);

function stopMusicPlayback() {
  musicIntentPlaying = false;
  audio.pause();
  audio.src = '';
  miniPlayer.hidden = true;
  state.currentTrackName = null;
  state.musicPlaylistIndex = -1;
  document.querySelectorAll('.track-row').forEach(r => r.classList.remove('playing'));
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'none';
    navigator.mediaSession.metadata = null;
  }
}

el('#miniPlayerClose').addEventListener('click', stopMusicPlayback);

// Keeps every page clear of the floating player: its real on-screen height
// (it's two rows on a phone, one on a computer, a small pill when
// minimized) plus the gap below it is published as --player-space, which
// the page's bottom padding and the AI chat box's height both subtract.
// A ResizeObserver catches every change -- the player appearing, closing,
// minimizing, or wrapping onto two lines.
function updatePlayerSpace() {
  let space = 0;
  if (!miniPlayer.hidden) {
    const r = miniPlayer.getBoundingClientRect();
    if (r.height) space = Math.ceil(r.height + (window.innerHeight - r.bottom) + 12);
  }
  document.documentElement.style.setProperty('--player-space', `${space}px`);
}
new ResizeObserver(updatePlayerSpace).observe(miniPlayer);
window.addEventListener('resize', updatePlayerSpace);

// Minimize: shrinks the player down to cover art + play/pause in the
// corner. Remembered between visits.
let miniMinimized = false;
try { miniMinimized = localStorage.getItem('shelf-mini-minimized') === '1'; } catch { /* storage blocked -- just default */ }
function applyMiniMinimized() {
  miniPlayer.classList.toggle('minimized', miniMinimized);
  const btn = el('#miniCollapseBtn');
  btn.innerHTML = miniMinimized ? '&#9652;' : '&#9662;';
  const label = miniMinimized ? 'Show full player' : 'Minimize player';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  updatePlayerSpace();
}
el('#miniCollapseBtn').addEventListener('click', () => {
  miniMinimized = !miniMinimized;
  try { localStorage.setItem('shelf-mini-minimized', miniMinimized ? '1' : '0'); } catch { /* fine */ }
  applyMiniMinimized();
});
applyMiniMinimized();

audio.addEventListener('timeupdate', () => {
  if (audio.duration) {
    el('#miniSeek').value = (audio.currentTime / audio.duration) * 100;
  }
  if (vizAudio && !audio.paused) syncVizAudio(); // gentle drift correction (iOS only)
});
// A seek on the real player: snap the iOS visualizer copy straight there.
audio.addEventListener('seeked', () => syncVizAudio(true));

el('#miniSeek').addEventListener('input', (e) => {
  if (audio.duration) {
    audio.currentTime = (e.target.value / 100) * audio.duration;
  }
});

// ---------- Volume ----------
// Shared between the mini player, the slideshow, and the fullscreen
// visualizer — all three control the same underlying audio element, so
// they're kept in sync: move any one and the others update to match.

const volumeSlider = el('#volumeSlider');
const muteBtn = el('#muteBtn');
const slideVolumeSlider = el('#slideVolumeSlider');
const slideMuteBtn = el('#slideMuteBtn');
const vizVolumeSlider = el('#vizVolumeSlider');
const vizMuteBtn = el('#vizMuteBtn');

const savedVolumeRaw = localStorage.getItem('shelf-volume');
const savedVolume = savedVolumeRaw === null ? NaN : Number(savedVolumeRaw);
const startVolume = Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 100 ? savedVolume : 80;
audio.volume = startVolume / 100;
volumeSlider.value = startVolume;
slideVolumeSlider.value = startVolume;
vizVolumeSlider.value = startVolume;
updateMuteIcon();

function setVolume(v) {
  audio.volume = v / 100;
  audio.muted = false;
  volumeSlider.value = v;
  slideVolumeSlider.value = v;
  vizVolumeSlider.value = v;
  localStorage.setItem('shelf-volume', String(v));
  updateMuteIcon();
}

function toggleMute() {
  audio.muted = !audio.muted;
  updateMuteIcon();
}

volumeSlider.addEventListener('input', (e) => setVolume(Number(e.target.value)));
slideVolumeSlider.addEventListener('input', (e) => setVolume(Number(e.target.value)));
vizVolumeSlider.addEventListener('input', (e) => setVolume(Number(e.target.value)));
muteBtn.addEventListener('click', toggleMute);
slideMuteBtn.addEventListener('click', toggleMute);
vizMuteBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // don't bubble up to the overlay's dblclick-to-close area
  toggleMute();
});

function updateMuteIcon() {
  const isMuted = audio.muted || Number(volumeSlider.value) === 0;
  const icon = isMuted ? '&#128263;' : '&#128266;';
  muteBtn.innerHTML = icon;
  slideMuteBtn.innerHTML = icon;
  vizMuteBtn.innerHTML = icon;
}

// ---------- Video playback ----------

const videoPlayer = el('#videoPlayer');
const videoPlayerEl = el('#videoPlayerEl');

function playVideo(index) {
  const f = state.filtered[index];
  if (!f) return;
  state.videoPlaylist = state.filtered.slice();
  state.videoPlaylistIndex = index;
  playVideoFile(f);
}

function playVideoFile(f) {
  videoPlayerEl.src = f.url;
  videoPlayerEl.play();
  el('#videoPlayerTitle').textContent = f.name;
  el('#videoDownloadLink').href = f.url;
  videoPlayer.hidden = false;
  recordPlay('Videos', f.name);
}

function playNextVideo() {
  if (state.videoPlaylistIndex < 0) return;
  const nextIndex = state.videoPlaylistIndex + 1;
  const next = state.videoPlaylist[nextIndex];
  if (!next) return; // reached the end of the list — stop rather than loop
  state.videoPlaylistIndex = nextIndex;
  playVideoFile(next);
}

videoPlayerEl.addEventListener('ended', playNextVideo);

el('#videoPlayerClose').addEventListener('click', () => {
  videoPlayer.hidden = true;
  videoPlayerEl.pause();
  videoPlayerEl.src = '';
  state.videoPlaylistIndex = -1; // closing the player is an explicit stop, not a pause between tracks
});

// ---------- Slideshow ----------

const overlay = el('#slideshowOverlay');
const slideImg = el('#slideshowImg');
const slideCaption = el('#slideshowCaption');

function openSlideshow(index) {
  state.slideshow.index = index;
  state.slideshow.playing = true;
  overlay.hidden = false;
  updateSlideshowFitMode();
  showSlide();
  startSlideTimer();
  maybeAutoPlayMusicForSlideshow();
}

// If nothing's already playing and the Music shelf has anything in it,
// starts a shuffled run through the library as background music. Respects
// music you're already playing — it won't interrupt a deliberate choice.
async function maybeAutoPlayMusicForSlideshow() {
  if (state.currentTrackName) return; // something's already loaded (playing or paused) — leave it alone
  try {
    const tracks = await fetch('/api/files?category=Music').then(r => r.json());
    if (!tracks.length) return;
    const shuffled = shuffledCopy(tracks);
    state.musicSourceList = tracks;
    state.musicPlaylist = shuffled;
    state.musicPlaylistIndex = 0;
    playTrackFile(shuffled[0], null);
    state.slideshow.musicStartedByUs = true;
  } catch {
    // Background music is a nice-to-have — a failed fetch here shouldn't
    // block the slideshow itself from opening.
  }
}

// Randomized pan/zoom pairs so consecutive photos don't all drift the same
// direction — picked fresh each slide for a bit of variety.
const KEN_BURNS_MOVES = [
  { from: 'scale(1) translate(0%, 0%)', to: 'scale(1.15) translate(-4%, -4%)' },
  { from: 'scale(1.15) translate(4%, 4%)', to: 'scale(1) translate(0%, 0%)' },
  { from: 'scale(1) translate(0%, 0%)', to: 'scale(1.15) translate(4%, -4%)' },
  { from: 'scale(1.15) translate(-4%, 4%)', to: 'scale(1) translate(0%, 0%)' },
  { from: 'scale(1) translate(0%, 0%)', to: 'scale(1.18) translate(0%, 0%)' }
];

function applyKenBurns(imgEl, durationMs) {
  imgEl.getAnimations().forEach(anim => anim.cancel());
  if (!state.slideshow.kenBurns) return;
  const move = KEN_BURNS_MOVES[Math.floor(Math.random() * KEN_BURNS_MOVES.length)];
  try {
    imgEl.animate(
      [{ transform: move.from }, { transform: move.to }],
      { duration: durationMs, easing: 'ease-in-out', fill: 'forwards' }
    );
  } catch {
    // Web Animations API isn't universally guaranteed — a photo that just
    // sits still is a fine fallback, not worth erroring over.
  }
}

function showSlide() {
  const f = state.filtered[state.slideshow.index];
  if (!f) return;
  slideImg.classList.remove('visible');
  setTimeout(() => {
    slideImg.src = f.url;
    slideCaption.textContent = `${f.name} — ${state.slideshow.index + 1} of ${state.filtered.length}`;
    slideImg.onload = () => {
      slideImg.classList.add('visible');
      // A little longer than the slide interval so the motion doesn't
      // visibly freeze right before the next photo swaps in.
      applyKenBurns(slideImg, (state.slideshow.seconds * 1000) + 600);
    };
  }, 120);
}

function nextSlide() {
  state.slideshow.index = (state.slideshow.index + 1) % state.filtered.length;
  showSlide();
}

function prevSlide() {
  state.slideshow.index = (state.slideshow.index - 1 + state.filtered.length) % state.filtered.length;
  showSlide();
}

function startSlideTimer() {
  clearInterval(state.slideshow.timer);
  if (!state.slideshow.playing) return;
  state.slideshow.timer = setInterval(nextSlide, state.slideshow.seconds * 1000);
}

function closeSlideshow() {
  overlay.hidden = true;
  clearInterval(state.slideshow.timer);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (state.slideshow.musicStartedByUs) {
    stopMusicPlayback();
    state.slideshow.musicStartedByUs = false;
  }
}

el('#slideshowBtn').addEventListener('click', () => openSlideshow(0));
el('#standardizeNamesBtn').addEventListener('click', standardizeNames);
el('#removeDuplicatesBtn').addEventListener('click', removeDuplicates);
el('#fetchArtBtn').addEventListener('click', fetchAlbumArt);
el('#clearArtBtn').addEventListener('click', clearAlbumArt);
// Export asks what you want first: the whole library as a zip of the actual
// files, or just the spreadsheet catalog. Both downloads are a normal
// navigation, not fetch+blob: the server responds with
// Content-Disposition: attachment, so the browser handles it as a download
// on its own (and streams it to disk -- important for a multi-GB zip, which
// fetch+blob would have to hold entirely in memory first).
const exportBackdrop = el('#exportBackdrop');
function openExportChoice() {
  const files = state.files;
  const total = files.reduce((sum, f) => sum + (f.size || 0), 0);
  el('#exportZipSub').textContent =
    `All ${files.length} song${files.length === 1 ? '' : 's'} in one download — ${humanFileSize(total)}`;
  exportBackdrop.hidden = false;
}
function closeExportChoice() { exportBackdrop.hidden = true; }
el('#exportListBtn').addEventListener('click', openExportChoice);
el('#closeExportBtn').addEventListener('click', closeExportChoice);
exportBackdrop.addEventListener('click', (e) => { if (e.target === exportBackdrop) closeExportChoice(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !exportBackdrop.hidden) closeExportChoice(); });
el('#exportZipBtn').addEventListener('click', () => {
  closeExportChoice();
  window.location.href = `/api/files/${encodeURIComponent(state.category)}/download-all`;
});
el('#exportSheetBtn').addEventListener('click', () => {
  closeExportChoice();
  window.location.href = `/api/files/${encodeURIComponent(state.category)}/export`;
});

// ---------- Create a picture with Pollinations.ai ----------
// Describe it, Pollinations draws it. "Yes" adds it to the Pictures shelf;
// "No" throws it away and draws a fresh take (a new random seed) on the
// same description -- which can be tweaked first. All requests go through
// the host's server, which holds the Pollinations key.
const imagineBackdrop = el('#imagineBackdrop');
const imagine = { shape: 'square', preview: null, busy: false, canManageKey: false };

function setImagineStatus(text, isError = false) {
  const s = el('#imagineStatus');
  s.textContent = text;
  s.classList.toggle('error', isError);
}

function showImagineButtons() {
  const has = !!imagine.preview;
  el('#imagineCreateBtn').hidden = has;
  el('#imagineKeepBtn').hidden = !has;
  el('#imagineNextBtn').hidden = !has;
  ['#imagineCreateBtn', '#imagineKeepBtn', '#imagineNextBtn'].forEach(id => { el(id).disabled = imagine.busy; });
  el('#imaginePrompt').readOnly = imagine.busy;
  el('#imagineStage').classList.toggle('working', imagine.busy);
}

async function openImagine() {
  imagineBackdrop.hidden = false;
  let status;
  try { status = await fetch('/api/imagine/status').then(r => r.json()); } catch { status = { hasKey: false, canManageKey: false }; }
  imagine.canManageKey = !!status.canManageKey;
  el('#imagineChangeKey').hidden = !imagine.canManageKey;
  if (!status.hasKey) return showImagineKeyPanel();
  el('#imagineKeyPanel').hidden = true;
  el('#imagineMainPanel').hidden = false;
  showImagineButtons();
  el('#imaginePrompt').focus();
}

function showImagineKeyPanel() {
  el('#imagineMainPanel').hidden = true;
  el('#imagineKeyPanel').hidden = false;
  el('#imagineKeyStatus').textContent = '';
  if (imagine.canManageKey) {
    el('#imagineKeyText').innerHTML = 'Pictures are drawn by <strong>Pollinations.ai</strong>, an online service that needs an API key. ' +
      'Sign in (free) at <a href="https://enter.pollinations.ai/keys" target="_blank" rel="noopener">enter.pollinations.ai/keys</a>, ' +
      'create a <strong>secret key</strong> (it starts with <code>sk_</code>), and paste it here. It’s stored only on this computer and never sent to anyone’s browser.';
    el('#imagineKeyForm').hidden = false;
    el('#imagineKeyInput').value = '';
    el('#imagineKeyInput').focus();
  } else {
    el('#imagineKeyText').textContent = 'Creating pictures needs a Pollinations.ai API key, and that can only be set up on the computer that runs The Shelf. Ask whoever looks after it to open this there once.';
    el('#imagineKeyForm').hidden = true;
  }
}

el('#imagineKeySave').addEventListener('click', async () => {
  const status = el('#imagineKeyStatus');
  try {
    const res = await fetch('/api/imagine/key', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: el('#imagineKeyInput').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save the key.');
    el('#imagineKeyInput').value = '';
    openImagine();
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('error');
  }
});
el('#imagineKeyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') el('#imagineKeySave').click(); });
el('#imagineChangeKey').addEventListener('click', showImagineKeyPanel);

document.querySelectorAll('.imagine-shape').forEach(btn => btn.addEventListener('click', () => {
  imagine.shape = btn.dataset.shape;
  document.querySelectorAll('.imagine-shape').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
}));

async function discardImaginePreview() {
  if (!imagine.preview) return;
  const id = imagine.preview.id;
  imagine.preview = null;
  try { await fetch(`/api/imagine/${id}`, { method: 'DELETE' }); } catch { /* it expires on its own */ }
}

async function generateImagine() {
  const prompt = el('#imaginePrompt').value.trim();
  if (!prompt) { setImagineStatus('Describe the picture you want first.', true); el('#imaginePrompt').focus(); return; }
  imagine.busy = true;
  showImagineButtons();
  setImagineStatus('Drawing your picture… this can take up to a minute.');
  try {
    const res = await fetch('/api/imagine/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, shape: imagine.shape }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not create the picture.');
    await new Promise((resolve, reject) => {
      const img = el('#imagineImg');
      img.onload = resolve; img.onerror = () => reject(new Error('The picture came back but could not be shown. Try again.'));
      img.src = data.url;
    });
    imagine.preview = { id: data.id, prompt };
    el('#imagineImg').hidden = false;
    el('#imagineImg').alt = prompt;
    el('#imaginePlaceholder').hidden = true;
    setImagineStatus('Keep this one?');
  } catch (err) {
    setImagineStatus(err.message, true);
  } finally {
    imagine.busy = false;
    showImagineButtons();
  }
}

el('#imagineCreateBtn').addEventListener('click', generateImagine);
el('#imaginePrompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !imagine.busy) (imagine.preview ? el('#imagineNextBtn') : el('#imagineCreateBtn')).click();
});

// "No": throw this one away and draw the next take.
el('#imagineNextBtn').addEventListener('click', async () => {
  await discardImaginePreview();
  generateImagine();
});

// "Yes": add it to the Pictures shelf.
el('#imagineKeepBtn').addEventListener('click', async () => {
  if (!imagine.preview) return;
  imagine.busy = true;
  showImagineButtons();
  try {
    const res = await fetch(`/api/imagine/${imagine.preview.id}/keep`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: imagine.preview.prompt }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not add the picture.');
    imagine.preview = null;
    el('#imagineImg').hidden = true;
    el('#imaginePlaceholder').hidden = false;
    el('#imaginePlaceholder').textContent = 'Added. Describe another picture, or close this window.';
    setImagineStatus(`Added “${data.name}” to Pictures.`);
    if (state.view === 'shelf' && state.category === 'Pictures') loadFiles();
  } catch (err) {
    setImagineStatus(err.message, true);
  } finally {
    imagine.busy = false;
    showImagineButtons();
  }
});

function closeImagine() {
  if (imagine.busy) return; // let the current request finish first
  discardImaginePreview();
  el('#imagineImg').hidden = true;
  el('#imaginePlaceholder').hidden = false;
  el('#imaginePlaceholder').textContent = 'Your picture will appear here.';
  setImagineStatus('');
  imagineBackdrop.hidden = true;
}
el('#imagineBtn').addEventListener('click', openImagine);
el('#closeImagineBtn').addEventListener('click', closeImagine);
imagineBackdrop.addEventListener('click', (e) => { if (e.target === imagineBackdrop) closeImagine(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !imagineBackdrop.hidden) closeImagine(); });

// ---------- Backup chooser ----------
// "Export a backup" on Home opens a list of checkboxes, one per section
// (each shelf, each tool's data, settings), with sizes, so you can back up
// just what you need -- e.g. everything except a huge Videos shelf.
const backupBackdrop = el('#backupBackdrop');

async function openBackupChooser() {
  const list = el('#backupSectionList');
  list.innerHTML = '<p class="backup-loading">Working out sizes\u2026</p>';
  backupBackdrop.hidden = false;
  let sections;
  try {
    const res = await fetch('/api/backup/sections');
    sections = await res.json();
    if (!res.ok) throw new Error(sections.error || 'Could not load backup options.');
  } catch (err) {
    list.innerHTML = `<p class="backup-loading">${escapeHtml(err.message)}</p>`;
    return;
  }
  const groups = [...new Set(sections.map(s => s.group))];
  list.innerHTML = groups.map(g => `
    <fieldset class="backup-group">
      <legend>${escapeHtml(g)}</legend>
      ${sections.filter(s => s.group === g).map(s => `
        <label class="backup-option">
          <input type="checkbox" value="${s.id}" data-size="${s.size}" checked>
          <span class="backup-option-label">${escapeHtml(s.label)}</span>
          <span class="backup-option-size">${s.size ? humanFileSize(s.size) : 'empty'}</span>
        </label>`).join('')}
    </fieldset>`).join('');
  list.querySelectorAll('input').forEach(cb => cb.addEventListener('change', updateBackupTotal));
  updateBackupTotal();
}

function checkedBackupSections() {
  return [...el('#backupSectionList').querySelectorAll('input:checked')];
}

function updateBackupTotal() {
  const picked = checkedBackupSections();
  const total = picked.reduce((sum, cb) => sum + Number(cb.dataset.size || 0), 0);
  el('#backupTotal').textContent = picked.length
    ? `${picked.length} selected \u00b7 about ${humanFileSize(total)} before compression`
    : 'Nothing selected';
  el('#backupDownloadBtn').disabled = picked.length === 0;
}

function setAllBackupBoxes(on) {
  el('#backupSectionList').querySelectorAll('input').forEach(cb => { cb.checked = on; });
  updateBackupTotal();
}

function closeBackupChooser() { backupBackdrop.hidden = true; }
el('#backupSelectAll').addEventListener('click', () => setAllBackupBoxes(true));
el('#backupSelectNone').addEventListener('click', () => setAllBackupBoxes(false));
el('#closeBackupBtn').addEventListener('click', closeBackupChooser);
backupBackdrop.addEventListener('click', (e) => { if (e.target === backupBackdrop) closeBackupChooser(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !backupBackdrop.hidden) closeBackupChooser(); });
el('#backupDownloadBtn').addEventListener('click', () => {
  const all = el('#backupSectionList').querySelectorAll('input');
  const picked = checkedBackupSections();
  if (picked.length === 0) return;
  // Everything ticked = a plain full backup, same URL as before.
  const query = picked.length === all.length ? '' : `?sections=${encodeURIComponent(picked.map(cb => cb.value).join(','))}`;
  closeBackupChooser();
  window.location.href = `/api/backup/export${query}`;
});

el('#fetchThumbsBtn').addEventListener('click', () => fetchCategoryThumbnails(state.category));
el('#clearThumbsBtn').addEventListener('click', () => clearCategoryThumbnails(state.category));
el('#thumbPickerInput').addEventListener('change', handleThumbPickerChange);
el('#slideClose').addEventListener('click', closeSlideshow);
el('#slideNext').addEventListener('click', () => { nextSlide(); startSlideTimer(); });
el('#slidePrev').addEventListener('click', () => { prevSlide(); startSlideTimer(); });

el('#slidePlayPause').addEventListener('click', (e) => {
  state.slideshow.playing = !state.slideshow.playing;
  e.target.textContent = state.slideshow.playing ? 'Pause' : 'Play';
  startSlideTimer();
});

el('#slideFullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else if (overlay.requestFullscreen) {
    overlay.requestFullscreen().catch(() => {
      alert("This browser didn't allow fullscreen — you can still use the slideshow normally.");
    });
  }
});

document.addEventListener('fullscreenchange', () => {
  const btn = el('#slideFullscreen');
  if (btn) btn.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
  // If the browser exited fullscreen on its own (native Esc handling, etc.)
  // while the visualizer was showing, make sure the overlay closes too.
  const vizOverlay = el('#fullscreenVizOverlay');
  if (vizOverlay && !vizOverlay.hidden && !document.fullscreenElement) {
    vizOverlay.hidden = true;
  }
});

el('#slideSpeed').addEventListener('input', (e) => {
  state.slideshow.seconds = Number(e.target.value);
  el('#slideSpeedVal').textContent = `${e.target.value}s`;
  startSlideTimer();
});

el('#kenBurnsToggle').addEventListener('change', (e) => {
  state.slideshow.kenBurns = e.target.checked;
  if (!e.target.checked) slideImg.getAnimations().forEach(anim => anim.cancel());
  updateSlideshowFitMode();
});

el('#slideSkipTrackBtn').addEventListener('click', playNextTrack);

// The image fills its frame (cropping edges) only while Ken Burns is
// active, since the pan/zoom needs a fully-filled frame to look right —
// with it off there's no reason to crop, so the whole photo shows instead.
function updateSlideshowFitMode() {
  slideImg.classList.toggle('slideshow-contain', !state.slideshow.kenBurns);
}

document.addEventListener('keydown', (e) => {
  if (!overlay.hidden) {
    if (e.key === 'ArrowRight') { nextSlide(); startSlideTimer(); }
    if (e.key === 'ArrowLeft') { prevSlide(); startSlideTimer(); }
    if (e.key === 'Escape') closeSlideshow();
  }
  if (presentOverlay && !presentOverlay.hidden) {
    if (e.key === 'ArrowRight') { presentIndex = Math.min(presentIndex + 1, presentSlides.length - 1); showPresentSlide(); }
    if (e.key === 'ArrowLeft') { presentIndex = Math.max(presentIndex - 1, 0); showPresentSlide(); }
    if (e.key === 'Escape') closePresent();
  }
  const peOverlay = document.getElementById('photoEditorOverlay');
  if (peOverlay && !peOverlay.hidden && e.key === 'Escape') closePhotoEditor();
});

// ---------- Photo editor ----------
// Non-destructive: every redraw starts fresh from the original image and
// re-applies the current rotate/flip/color state, so Reset is trivial and
// nothing compounds from repeated edits before saving.

const PHOTO_EDITOR_MAX_DIM = 2200; // keeps the working canvas (and save payload) reasonable even for a huge source photo

let peImage = null;
let peFileName = null;
let peWorkingWidth = 0;
let peWorkingHeight = 0;
let peState = { rotation: 0, flipH: false, flipV: false, brightness: 100, contrast: 100, saturation: 100 };

function openPhotoEditor(name) {
  peFileName = name;
  peState = { rotation: 0, flipH: false, flipV: false, brightness: 100, contrast: 100, saturation: 100 };
  el('#peBrightness').value = 100;
  el('#peContrast').value = 100;
  el('#peSaturation').value = 100;
  el('#photoEditorTitle').textContent = `Edit — ${name}`;
  const statusEl = el('#photoEditorStatus');
  statusEl.textContent = '';
  statusEl.classList.remove('error');
  el('#photoEditorOverlay').hidden = false;

  const img = new Image();
  img.onload = () => {
    peImage = img;
    let w = img.naturalWidth, h = img.naturalHeight;
    if (Math.max(w, h) > PHOTO_EDITOR_MAX_DIM) {
      const scale = PHOTO_EDITOR_MAX_DIM / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    peWorkingWidth = w;
    peWorkingHeight = h;
    redrawPhotoEditor();
  };
  img.onerror = () => {
    statusEl.textContent = "Couldn't load this photo for editing.";
    statusEl.classList.add('error');
  };
  img.src = `/shared/Pictures/${encodeURIComponent(name)}`;
}

function redrawPhotoEditor() {
  if (!peImage) return;
  const canvas = el('#photoEditorCanvas');
  const ctx = canvas.getContext('2d');
  const swap = peState.rotation === 90 || peState.rotation === 270;
  const w = swap ? peWorkingHeight : peWorkingWidth;
  const h = swap ? peWorkingWidth : peWorkingHeight;
  canvas.width = w;
  canvas.height = h;
  ctx.save();
  ctx.filter = `brightness(${peState.brightness}%) contrast(${peState.contrast}%) saturate(${peState.saturation}%)`;
  ctx.translate(w / 2, h / 2);
  ctx.rotate((peState.rotation * Math.PI) / 180);
  ctx.scale(peState.flipH ? -1 : 1, peState.flipV ? -1 : 1);
  ctx.drawImage(peImage, -peWorkingWidth / 2, -peWorkingHeight / 2, peWorkingWidth, peWorkingHeight);
  ctx.restore();
}

function closePhotoEditor() {
  el('#photoEditorOverlay').hidden = true;
  peImage = null;
  peFileName = null;
}

function mimeForPhotoFilename(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return { type: 'image/jpeg', quality: 0.92 };
  if (ext === 'webp') return { type: 'image/webp', quality: 0.92 };
  return { type: 'image/png' }; // covers png, gif, bmp, and anything else — a safe, universally-supported default
}

async function savePhotoEdit(saveAs) {
  if (!peImage) return;
  const canvas = el('#photoEditorCanvas');
  const statusEl = el('#photoEditorStatus');
  statusEl.textContent = 'Saving\u2026';
  statusEl.classList.remove('error');
  const { type, quality } = mimeForPhotoFilename(peFileName);
  const imageData = canvas.toDataURL(type, quality);
  try {
    const res = await fetch(`/api/files/Pictures/${encodeURIComponent(peFileName)}/edit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageData, saveAs })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save changes.');
    statusEl.textContent = saveAs === 'copy' ? `Saved as "${data.saved}".` : 'Saved.';
    if (state.category === 'Pictures') await loadFiles();
    setTimeout(closePhotoEditor, saveAs === 'copy' ? 900 : 600);
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add('error');
  }
}

el('#peRotateLeft').addEventListener('click', () => { peState.rotation = (peState.rotation + 270) % 360; redrawPhotoEditor(); });
el('#peRotateRight').addEventListener('click', () => { peState.rotation = (peState.rotation + 90) % 360; redrawPhotoEditor(); });
el('#peFlipH').addEventListener('click', () => { peState.flipH = !peState.flipH; redrawPhotoEditor(); });
el('#peFlipV').addEventListener('click', () => { peState.flipV = !peState.flipV; redrawPhotoEditor(); });
el('#peReset').addEventListener('click', () => {
  peState = { rotation: 0, flipH: false, flipV: false, brightness: 100, contrast: 100, saturation: 100 };
  el('#peBrightness').value = 100;
  el('#peContrast').value = 100;
  el('#peSaturation').value = 100;
  redrawPhotoEditor();
});
el('#peBrightness').addEventListener('input', (e) => { peState.brightness = Number(e.target.value); redrawPhotoEditor(); });
el('#peContrast').addEventListener('input', (e) => { peState.contrast = Number(e.target.value); redrawPhotoEditor(); });
el('#peSaturation').addEventListener('input', (e) => { peState.saturation = Number(e.target.value); redrawPhotoEditor(); });
el('#peSaveOverwrite').addEventListener('click', () => savePhotoEdit('overwrite'));
el('#peSaveCopy').addEventListener('click', () => savePhotoEdit('copy'));
el('#peCancel').addEventListener('click', closePhotoEditor);
el('#peClose').addEventListener('click', closePhotoEditor);

el('#teSave').addEventListener('click', () => saveTagEditor());
el('#teSaveAndRefetchArt').addEventListener('click', () => saveTagEditor({ thenFetchArt: true }));
el('#teCancel').addEventListener('click', closeTagEditor);

// Copies the song's file name, to paste into a tag field (or anywhere else).
el('#teCopyName').addEventListener('click', async () => {
  const name = el('#teFileName').textContent;
  const btn = el('#teCopyName');
  try {
    await navigator.clipboard.writeText(name);
    btn.textContent = 'Copied';
  } catch {
    // Clipboard access needs a secure page (localhost, or https) -- over a
    // plain LAN address it's often refused, so select the text instead and
    // let Ctrl+C / Cmd+C do the copying.
    const range = document.createRange();
    range.selectNodeContents(el('#teFileName'));
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    btn.textContent = 'Selected \u2014 press Ctrl+C';
  }
});

// Splits a typical file name into tags, so most songs never need any
// typing or pasting at all:
//   "01 - The Analog Kids - Night Drive.mp3"  -> Track 1, Artist, Title
//   "The_Analog_Kids-Night_Drive.mp3"         -> Artist, Title
//   "Night Drive.mp3"                         -> Title only
function tagsFromFileName(fileName) {
  let base = fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  let track = '';
  const num = base.match(/^(\d{1,3})\s*(?:[-.)]\s*|\s+)(.+)$/);
  if (num) { track = String(Number(num[1])); base = num[2].trim(); }
  let parts = base.split(/\s+[-\u2013\u2014]\s+/);
  if (parts.length === 1) parts = base.split(/\s*-\s*/); // "Artist-Title" with no spaces
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim(), track };
  return { artist: '', title: base, track };
}

el('#teFillFromName').addEventListener('click', () => {
  const t = tagsFromFileName(el('#teFileName').textContent);
  if (t.artist) el('#teArtist').value = t.artist;
  if (t.title) el('#teTitle').value = t.title;
  if (t.track) el('#teTrack').value = t.track;
  const status = el('#tagEditorStatus');
  status.classList.remove('error');
  status.textContent = 'Filled in from the file name \u2014 check it, then Save.';
});
el('#teClose').addEventListener('click', closeTagEditor);

async function playGame(category, name) {
  // Open the tab synchronously, in direct response to the click — opening it
  // only after the fetch below resolves would get blocked as a popup by most
  // browsers, since it would no longer count as a direct user gesture.
  const newTab = window.open('', '_blank');
  if (newTab) {
    newTab.document.write('<title>Loading\u2026</title><body style="background:#1B1424;color:#F0E9E3;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">Loading\u2026</body>');
  }
  recordPlay(category, name);

  try {
    const res = await fetch(`/api/play-info?category=${encodeURIComponent(category)}&name=${encodeURIComponent(name)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load this game.');
    if (newTab) {
      newTab.location.href = data.url;
    } else {
      alert('Your browser blocked the new tab — allow popups for this site and try again.');
    }
  } catch (err) {
    if (newTab) newTab.document.body.textContent = err.message;
    else alert(err.message);
  }
}

// ---------- PDF reader ----------
// Opens the PDF directly in a new tab, letting the browser's own native
// PDF viewer handle it completely -- same reasoning as playGame opening
// games in their own tab, and more reliable than embedding it in an
// iframe here (iOS Safari's PDF rendering inside an iframe has been
// flaky in practice; its full-tab PDF viewer is not).
function readPdf(category, name) {
  recordPlay(category, name);
  const url = `/shared/${encodeURIComponent(category)}/${encodeURIComponent(name)}`;
  const newTab = window.open(url, '_blank');
  if (!newTab) {
    alert('Your browser blocked the new tab — allow popups for this site and try again.');
  }
}

// ---------- Upload modal ----------

const uploadBackdrop = el('#uploadBackdrop');

el('#openUploadBtn').addEventListener('click', () => {
  el('#categorySelect').value = state.category in CATEGORY_COLORS ? state.category : 'Pictures';
  el('#uploadList').innerHTML = '';
  uploadBackdrop.hidden = false;
});

el('#closeUploadBtn').addEventListener('click', () => uploadBackdrop.hidden = true);
uploadBackdrop.addEventListener('click', (e) => {
  if (e.target === uploadBackdrop) uploadBackdrop.hidden = true;
});

const dropzone = el('#dropzone');
const fileInput = el('#fileInput');

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => uploadFiles(fileInput.files));

dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--accent)'; });
dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.style.borderColor = '';
  uploadFiles(e.dataTransfer.files);
});

async function uploadFiles(fileList, category) {
  category = category || el('#categorySelect').value;
  const list = el('#uploadList');

  for (const file of fileList) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(file.name)}</span><span class="status">uploading&hellip;</span>`;
    list.appendChild(li);

    const form = new FormData();
    form.append('category', category);
    form.append('files', file);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (res.ok) {
        li.querySelector('.status').textContent = 'done';
        li.querySelector('.status').classList.add('ok');
      } else {
        throw new Error(data.error || 'failed');
      }
    } catch (err) {
      li.querySelector('.status').textContent = 'failed';
      li.querySelector('.status').classList.add('err');
    }
  }

  loadCategories();
  if (category === state.category) loadFiles();
}

// ---------- Master power toggle ----------

function applyPowerState(on) {
  el('#powerToggle').checked = on;
  el('#powerLabel').textContent = on ? 'The Shelf is on' : 'The Shelf is off';
  // Everyone can see whether The Shelf is on, but only the host machine is
  // allowed to flip it -- matches the server-side isLocalRequest check on
  // PUT /api/power, so non-host visitors see an accurate, disabled control
  // instead of a switch that silently fails.
  const toggle = el('#powerToggle');
  toggle.disabled = !state.auth.isLocal;
  el('#powerToggleRow').title = state.auth.isLocal
    ? ''
    : 'Only the host computer can turn The Shelf on or off.';
}

async function loadPowerState() {
  try {
    const data = await fetch('/api/power').then(r => r.json());
    applyPowerState(data.on);
  } catch { /* ignore — defaults to the checked/on state already in the HTML */ }
}

el('#powerToggle').addEventListener('change', async (e) => {
  const turningOff = !e.target.checked;
  if (turningOff && !confirm("Turn off The Shelf? Nobody on your network will be able to use it until it's turned back on from this computer.")) {
    e.target.checked = true;
    return;
  }
  try {
    const resp = await fetch('/api/power', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: e.target.checked })
    });
    if (!resp.ok) { applyPowerState(!e.target.checked); return; }
    const data = await resp.json();
    applyPowerState(data.on);
    if (!data.on) location.reload(); // shows the actual "turned off" page as confirmation
  } catch { applyPowerState(!e.target.checked); }
});

// ---------- Localhost-only mode ----------
// A separate, harder switch than the power toggle above: instead of
// turning The Shelf off entirely, this keeps it running but only for
// requests actually coming from this computer -- every other device on
// the network is turned away, without needing to touch router settings or
// pull a network cable. Only ever shown/usable on the host machine itself
// (same restriction as the secure-mode toggle above), since there'd be no
// way for a device it just locked out to reach this control anyway.

function applyLocalhostOnlyState(on) {
  const row = el('#localhostOnlyToggleRow');
  if (!state.auth.isLocal) { row.hidden = true; return; }
  row.hidden = false;
  el('#localhostOnlyToggle').checked = on;
}

async function loadLocalhostOnlyState() {
  if (!state.auth.isLocal) { el('#localhostOnlyToggleRow').hidden = true; return; }
  try {
    const data = await fetch('/api/localhost-only').then(r => r.json());
    applyLocalhostOnlyState(data.localhostOnly);
  } catch { /* leave the row as it defaulted (hidden) — no worse than not offering the control */ }
}

el('#localhostOnlyToggle').addEventListener('change', async (e) => {
  const turningOn = e.target.checked;
  if (turningOn && !confirm("Make The Shelf reachable only from this computer? Everyone else on your network — including anyone mid-download or mid-message — will lose access immediately, and won't be able to turn this back off themselves. Only this computer will be able to switch it back.")) {
    e.target.checked = false;
    return;
  }
  try {
    const data = await fetch('/api/localhost-only', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localhostOnly: turningOn })
    }).then(r => r.json());
    applyLocalhostOnlyState(data.localhostOnly);
  } catch {
    e.target.checked = !turningOn; // revert on failure
  }
});

// ---------- Open write access ----------
// A quick, temporary override for the write-protection rule ("Anonymous
// read only" / write-access accounts) — instead of setting someone up with
// a real account, this just waves everyone through as if they already had
// write access, host machine or not. Covers everything that rule
// otherwise gates, including the AI tab (chatting with it is a write
// action like any other), which is the main reason to flip this on: to
// let someone on your network actually use the AI tab without first
// setting up an account for them. Same host-only restriction as the other
// two toggles above.

function applyOpenWriteAccessState(on) {
  const row = el('#openWriteToggleRow');
  if (!state.auth.isLocal) { row.hidden = true; return; }
  row.hidden = false;
  el('#openWriteToggle').checked = on;
}

async function loadOpenWriteAccessState() {
  if (!state.auth.isLocal) { el('#openWriteToggleRow').hidden = true; return; }
  try {
    const data = await fetch('/api/open-write-access').then(r => r.json());
    applyOpenWriteAccessState(data.openWriteAccess);
  } catch { /* leave the row as it defaulted (hidden) */ }
}

el('#openWriteToggle').addEventListener('change', async (e) => {
  const turningOn = e.target.checked;
  if (turningOn && !confirm("Let anyone on your network add, change, or remove things on this Shelf — and use the AI tab — without logging in? This overrides any write-access accounts you've set up; turn it off again here any time to go back to requiring one.")) {
    e.target.checked = false;
    return;
  }
  try {
    const data = await fetch('/api/open-write-access', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openWriteAccess: turningOn })
    }).then(r => r.json());
    applyOpenWriteAccessState(data.openWriteAccess);
  } catch {
    e.target.checked = !turningOn; // revert on failure
  }
});

// ---------- Network info ----------

async function loadNetworkInfo() {
  try {
    const res = await fetch('/api/network-info');
    const data = await res.json();
    const url = data.ips.length ? `${data.ips[0]}:${data.port}` : `localhost:${data.port}`;
    el('#networkUrl').textContent = url;
  } catch {
    el('#networkUrl').textContent = 'unavailable';
  }
}

// ---------- Daily affirmation & color-of-the-day ----------
// Both are picked deterministically from today's date, so they change every
// day automatically without any server storage — no "posting" required,
// and everyone looking at the board on the same day sees the same pick.
// The lists cycle after a few months rather than never repeating, which is
// a reasonable trade-off for a positivity widget that runs indefinitely.

const AFFIRMATIONS = [
  "You are allowed to take up space.", "Small steps still move you forward.",
  "Rest is productive too.", "You don't have to earn your worth.",
  "Today is a fresh page.", "Your pace is the right pace.",
  "You are capable of more than you think.", "It's okay to not have it all figured out.",
  "You are doing better than you feel like you are.", "Progress, not perfection.",
  "You are allowed to change your mind.", "Kindness to yourself is not weakness.",
  "You've survived every hard day so far.", "Growth is quiet before it's visible.",
  "You don't need permission to be proud of yourself.", "Today, be gentle with yourself.",
  "You are more than your worst day.", "Someone is glad you exist.",
  "You can start again as many times as you need to.", "Your feelings are valid, even the messy ones.",
  "You are not behind — you're on your own timeline.", "Asking for help is a strength.",
  "You are worthy of good things.", "Today's effort counts, even if it's small.",
  "You don't have to be everything to everyone.", "It's okay to rest before you're exhausted.",
  "You are allowed to outgrow old versions of yourself.", "Your story isn't finished yet.",
  "You are enough, exactly as you are today.", "Breathe — you're doing okay.",
  "You are not a burden.", "Setbacks are not the end of the story.",
  "You get to decide what today means.", "You are learning, even when it doesn't feel like it.",
  "Your effort matters more than the outcome.", "You are allowed to be proud of small wins.",
  "You can be a work in progress and still be worthy of love.", "Today doesn't have to be perfect to be good.",
  "You are not alone in how you feel.", "You have gotten through 100% of your hardest days.",
  "You're allowed to say no.", "Your presence makes a difference.",
  "You don't have to rush your healing.", "You are stronger than you were yesterday.",
  "It's okay to ask for a do-over.", "You are more resilient than you realize.",
  "Your best today doesn't have to match your best yesterday.", "You deserve patience, especially from yourself.",
  "You are allowed to celebrate the little things.", "There is no rush — you'll get there.",
  "You are not defined by your mistakes.", "You bring something to the world only you can.",
  "It's okay to move slowly today.", "You're capable of figuring this out.",
  "Your worth isn't up for debate.", "You are allowed to feel proud without waiting for permission.",
  "You can hold hope and doubt at the same time.", "You are exactly where you need to be right now.",
  "Today, choose the kinder thought.", "You don't owe anyone constant productivity.",
  "You are allowed to take the scenic route.", "Your comeback doesn't need an announcement.",
  "You are doing the best you can with what you have today.", "You deserve the same compassion you give others.",
  "There's no timeline for figuring out life.", "You are not too much — you're just you.",
  "You can build something good from today.", "Your calm is worth protecting.",
  "You are allowed to be a beginner.", "The hard days don't cancel out the good ones.",
  "You are someone's reason to smile today.", "You get to redefine what success looks like.",
  "You are allowed to outgrow people, places, and habits.", "Your journey doesn't need to look like anyone else's.",
  "You're not starting from zero — you're starting from experience.", "Today is enough. You are enough.",
  "You are allowed to protect your peace.", "Trust the process, even the slow parts.",
  "You are more than a checklist.", "You get to choose what you carry forward from today.",
  "You are allowed to be proud and still want to grow.", "Rest now so you can bloom later.",
  "You don't have to explain your boundaries.", "You are made of more strength than you know.",
  "Your softness is not a flaw.", "You are allowed to take things one hour at a time.",
  "You've made it through hard things before — you'll make it through this too.", "You are worth the effort you put into yourself.",
  "You are allowed to be both a work in progress and already whole.", "Today's small effort is tomorrow's momentum.",
  "You get to write the next chapter.", "You are not required to have it all together.",
  "Your gentleness is a strength, not a weakness.", "You are allowed to ask for what you need.",
  "You are doing important, quiet work just by trying.", "You are allowed to be proud of surviving, not just thriving.",
  "You are capable of change.", "Today can be the start of something good.",
  "You are allowed to slow down without guilt.", "Your presence is a gift to the people around you.",
  "You are not behind schedule — there is no schedule.", "You are allowed to let today be simple.",
  "You are still growing, even in the waiting.", "Be as kind to yourself as you are to others.",
  "You are allowed to feel good about today.", "Every day is a chance to begin again.",
  "You are not alone, even when it feels that way.", "You are worthy of rest, joy, and ease.",
  "Your effort today matters, even if no one sees it.", "You are allowed to be gentle with your own growth.",
  "You have everything you need to take the next small step.", "You are allowed to just be, without needing to prove anything."
];

const DAILY_COLORS = [
  { name: 'Coral', hex: '#FF6F61', meaning: 'warmth, energy, and friendly optimism' },
  { name: 'Teal', hex: '#008080', meaning: 'balance, clarity, and calm renewal' },
  { name: 'Amber', hex: '#FFBF00', meaning: 'confidence, warmth, and encouragement' },
  { name: 'Lavender', hex: '#B57EDC', meaning: 'calm, grace, and gentle reflection' },
  { name: 'Sage Green', hex: '#9CAF88', meaning: 'growth, steadiness, and quiet peace' },
  { name: 'Crimson', hex: '#DC143C', meaning: 'passion, courage, and bold action' },
  { name: 'Sky Blue', hex: '#87CEEB', meaning: 'openness, freedom, and easy calm' },
  { name: 'Mustard', hex: '#E1AD01', meaning: 'optimism, curiosity, and warmth' },
  { name: 'Plum', hex: '#8E4585', meaning: 'creativity, depth, and quiet confidence' },
  { name: 'Mint', hex: '#98FF98', meaning: 'freshness, clarity, and new beginnings' },
  { name: 'Burnt Orange', hex: '#CC5500', meaning: 'enthusiasm, warmth, and determination' },
  { name: 'Navy', hex: '#000080', meaning: 'stability, trust, and quiet strength' },
  { name: 'Rose', hex: '#FF007F', meaning: 'kindness, warmth, and gentle affection' },
  { name: 'Turquoise', hex: '#40E0D0', meaning: 'communication, calm, and renewal' },
  { name: 'Gold', hex: '#FFD700', meaning: 'value, achievement, and abundance' },
  { name: 'Slate Gray', hex: '#708090', meaning: 'steadiness, patience, and quiet resolve' },
  { name: 'Peach', hex: '#FFCBA4', meaning: 'gentleness, warmth, and comfort' },
  { name: 'Emerald', hex: '#50C878', meaning: 'growth, balance, and vitality' },
  { name: 'Indigo', hex: '#4B0082', meaning: 'intuition, focus, and quiet wisdom' },
  { name: 'Terracotta', hex: '#E2725B', meaning: 'groundedness, warmth, and resilience' },
  { name: 'Periwinkle', hex: '#CCCCFF', meaning: 'calm, imagination, and gentle optimism' },
  { name: 'Chartreuse', hex: '#DFFF00', meaning: 'energy, curiosity, and fresh perspective' },
  { name: 'Burgundy', hex: '#800020', meaning: 'richness, confidence, and quiet power' },
  { name: 'Powder Blue', hex: '#B0E0E6', meaning: 'serenity, softness, and ease' },
  { name: 'Ochre', hex: '#CC7722', meaning: 'warmth, endurance, and grounded energy' },
  { name: 'Lilac', hex: '#C8A2C8', meaning: 'gentleness, nostalgia, and calm affection' },
  { name: 'Forest Green', hex: '#228B22', meaning: 'growth, stability, and renewal' },
  { name: 'Salmon', hex: '#FA8072', meaning: 'warmth, approachability, and comfort' },
  { name: 'Cerulean', hex: '#007BA7', meaning: 'clarity, calm, and open-mindedness' },
  { name: 'Maroon', hex: '#800000', meaning: 'depth, resilience, and quiet strength' },
  { name: 'Butter Yellow', hex: '#FFDB58', meaning: 'cheer, warmth, and light-hearted joy' },
  { name: 'Steel Blue', hex: '#4682B4', meaning: 'reliability, focus, and calm confidence' },
  { name: 'Blush', hex: '#DE5D83', meaning: 'softness, warmth, and quiet affection' },
  { name: 'Olive', hex: '#808000', meaning: 'groundedness, endurance, and quiet wisdom' },
  { name: 'Cobalt', hex: '#0047AB', meaning: 'depth, focus, and quiet intensity' },
  { name: 'Apricot', hex: '#FBCEB1', meaning: 'warmth, gentleness, and optimism' },
  { name: 'Seafoam', hex: '#93E9BE', meaning: 'renewal, calm, and gentle clarity' },
  { name: 'Wine', hex: '#722F37', meaning: 'richness, depth, and quiet elegance' },
  { name: 'Marigold', hex: '#EAA221', meaning: 'joy, warmth, and celebration' },
  { name: 'Denim Blue', hex: '#1560BD', meaning: 'reliability, comfort, and steady calm' },
  { name: 'Dusty Rose', hex: '#C08081', meaning: 'gentleness, nostalgia, and quiet warmth' },
  { name: 'Pine Green', hex: '#01796F', meaning: 'steadiness, renewal, and quiet resilience' },
  { name: 'Copper', hex: '#B87333', meaning: 'warmth, endurance, and grounded confidence' },
  { name: 'Ice Blue', hex: '#A5F2F3', meaning: 'clarity, calm, and quiet freshness' },
  { name: 'Raspberry', hex: '#E30B5C', meaning: 'boldness, warmth, and playful energy' },
  { name: 'Moss Green', hex: '#8A9A5B', meaning: 'groundedness, calm, and quiet growth' },
  { name: 'Tangerine', hex: '#F28500', meaning: 'enthusiasm, warmth, and energy' },
  { name: 'Orchid', hex: '#DA70D6', meaning: 'creativity, charm, and gentle confidence' },
  { name: 'Charcoal', hex: '#36454F', meaning: 'steadiness, focus, and quiet strength' },
  { name: 'Honeydew', hex: '#C5E8C5', meaning: 'freshness, calm, and gentle renewal' },
  { name: 'Vermilion', hex: '#E34234', meaning: 'boldness, energy, and confidence' },
  { name: 'Powder Pink', hex: '#FFD1DC', meaning: 'gentleness, comfort, and quiet affection' },
  { name: 'Azure', hex: '#007FFF', meaning: 'clarity, openness, and calm confidence' },
  { name: 'Sienna', hex: '#A0522D', meaning: 'warmth, groundedness, and endurance' },
  { name: 'Aquamarine', hex: '#7FFFD4', meaning: 'calm, clarity, and gentle renewal' },
  { name: 'Rust', hex: '#B7410E', meaning: 'resilience, warmth, and quiet determination' },
  { name: 'Lemon', hex: '#FFF44F', meaning: 'cheer, energy, and light-hearted optimism' },
  { name: 'Cool Gray', hex: '#8C92AC', meaning: 'balance, steadiness, and quiet calm' },
  { name: 'Fuchsia', hex: '#FF00FF', meaning: 'boldness, confidence, and playful energy' },
  { name: 'Sand', hex: '#C2B280', meaning: 'warmth, groundedness, and quiet ease' },
  { name: 'Deep Teal', hex: '#014D4E', meaning: 'depth, calm, and quiet focus' },
  { name: 'Flamingo Pink', hex: '#FC8EAC', meaning: 'playfulness, warmth, and gentle joy' },
  { name: 'Hunter Green', hex: '#355E3B', meaning: 'steadiness, endurance, and quiet strength' },
  { name: 'Champagne', hex: '#F7E7CE', meaning: 'warmth, ease, and gentle celebration' },
  { name: 'Royal Blue', hex: '#4169E1', meaning: 'confidence, trust, and steady focus' },
  { name: 'Coral Pink', hex: '#F88379', meaning: 'warmth, friendliness, and gentle optimism' },
  { name: 'Deep Purple', hex: '#673AB7', meaning: 'creativity, depth, and quiet ambition' },
  { name: 'Buttercream', hex: '#FFF1B5', meaning: 'comfort, warmth, and gentle cheer' },
  { name: 'Midnight Blue', hex: '#191970', meaning: 'depth, calm, and quiet introspection' },
  { name: 'Papaya', hex: '#FFEFD5', meaning: 'warmth, gentleness, and light optimism' },
  { name: 'Jade', hex: '#00A86B', meaning: 'balance, renewal, and quiet prosperity' },
  { name: 'Brick Red', hex: '#B22222', meaning: 'groundedness, resilience, and warmth' },
  { name: 'Baby Blue', hex: '#89CFF0', meaning: 'calm, softness, and gentle ease' },
  { name: 'Saffron', hex: '#F4C430', meaning: 'warmth, vitality, and quiet joy' },
  { name: 'Eggplant', hex: '#614051', meaning: 'depth, richness, and quiet confidence' },
  { name: 'Cream', hex: '#FFFDD0', meaning: 'comfort, simplicity, and gentle calm' },
  { name: 'Scarlet', hex: '#FF2400', meaning: 'boldness, passion, and determined energy' },
  { name: 'Pistachio', hex: '#93C572', meaning: 'freshness, growth, and quiet ease' },
  { name: 'Taupe', hex: '#483C32', meaning: 'steadiness, warmth, and quiet balance' },
  { name: 'Cyan', hex: '#00FFFF', meaning: 'clarity, freshness, and open calm' },
  { name: 'Mahogany', hex: '#C04000', meaning: 'warmth, richness, and grounded strength' },
  { name: 'Lime', hex: '#BFFF00', meaning: 'energy, freshness, and playful optimism' },
  { name: 'Dove Gray', hex: '#6D6C6C', meaning: 'balance, calm, and quiet steadiness' },
  { name: 'Watermelon', hex: '#FC6C85', meaning: 'playfulness, warmth, and light joy' },
  { name: 'Deep Sea Blue', hex: '#003153', meaning: 'depth, calm, and quiet resolve' },
  { name: 'Honey', hex: '#EBA937', meaning: 'warmth, comfort, and gentle sweetness' },
  { name: 'Iris', hex: '#5A4FCF', meaning: 'creativity, wisdom, and quiet depth' },
  { name: 'Shell Pink', hex: '#FFDBD9', meaning: 'gentleness, warmth, and quiet comfort' }
];

function getDayNumber() {
  return Math.floor(Date.now() / 86400000); // days since Unix epoch — stable per calendar day
}

function getTodaysAffirmation() {
  return AFFIRMATIONS[getDayNumber() % AFFIRMATIONS.length];
}

function getTodaysColor() {
  // A different multiplier than the affirmation index so the two don't
  // shift in lockstep against each other over time.
  return DAILY_COLORS[(getDayNumber() * 7) % DAILY_COLORS.length];
}

// Picks readable text color (near-black or near-white) for a given hex
// background, based on standard relative luminance.
function readableTextColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.6 ? '#241B2F' : '#F7F3EC';
}

// ---------- Home / Portal ----------

// Paste an image or video anywhere on the page while on the Home tab and
// it gets pinned to the bulletin board. Set up once (not per-render) so we
// don't stack up duplicate listeners every time the tab is revisited.
document.addEventListener('paste', async (e) => {
  if (state.view !== 'portal') return;
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;

  const mediaFiles = [];
  for (const item of items) {
    if (item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/'))) {
      const file = item.getAsFile();
      if (file) mediaFiles.push(file);
    }
  }
  if (mediaFiles.length === 0) return; // not an image/video — let normal text pasting happen

  e.preventDefault();
  for (const file of mediaFiles) {
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/portal/posts/media', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not add that to the board.');
    } catch (err) {
      alert(err.message);
    }
  }
  if (state.view === 'portal') loadPortalView();
});

async function loadPortalView() {
  setToolHeader('Home', 'Your quick dashboard', null, null);
  const [portal, cats] = await Promise.all([
    fetch('/api/portal').then(r => r.json()),
    fetch('/api/categories').then(r => r.json()),
    loadAuthStatus()
  ]);
  state.portal = portal;
  renderPortal(cats);
  loadWeatherWidget();
}

// Finds the person's location via the browser (with their permission), then
// asks our own server for the weather there. Fails silently — no location
// permission, no internet, or a slow/unavailable weather service should
// never break the rest of the dashboard, so the pill just quietly
// disappears if any of that doesn't work out.
function loadWeatherWidget() {
  const pill = document.getElementById('weatherPill');
  if (!pill) return;

  if (!navigator.geolocation) {
    pill.remove();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const currentPill = document.getElementById('weatherPill');
      if (!currentPill) return; // user navigated away already
      try {
        const { latitude, longitude } = position.coords;
        const res = await fetch(`/api/weather?lat=${latitude}&lon=${longitude}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Weather unavailable.');
        currentPill.innerHTML = `${data.icon} <strong>${data.tempF}&deg;F</strong> ${escapeHtml(data.condition)}`;
        currentPill.title = `${data.tempC}\u00b0C \u2014 ${escapeHtml(data.condition)}`;
      } catch {
        currentPill.remove();
      }
    },
    () => { const p = document.getElementById('weatherPill'); if (p) p.remove(); }, // permission denied or unavailable
    { timeout: 8000, maximumAge: 15 * 60 * 1000 }
  );
}

function renderPortal(cats) {
  const content = el('#content');
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const affirmation = getTodaysAffirmation();
  const color = getTodaysColor();
  const colorTextColor = readableTextColor(color.hex);

  content.innerHTML = `
    <div class="daily-affirmation">
      <div class="daily-affirmation-label">Today's affirmation</div>
      <div class="daily-affirmation-quote">${escapeHtml(affirmation)}</div>
    </div>

    <div class="color-experience-bar" style="background:${color.hex}; color:${colorTextColor};">
      <span class="color-bar-name">${escapeHtml(color.name)}</span>
      <span class="color-bar-meaning">means ${escapeHtml(color.meaning)}</span>
    </div>

    <div class="portal-grid">
      <div class="portal-section">
        <div class="portal-clock">${dateStr} &middot; ${timeStr}</div>
        <div class="stat-row">
          ${cats.map(c => `<span class="stat-pill"><strong>${c.count}</strong> ${categoryLabel(c.name)}</span>`).join('')}
          <span class="stat-pill weather-pill" id="weatherPill">Finding your weather&hellip;</span>
        </div>
        <h3>Bulletin board</h3>
        <div class="sticky-board" id="stickyBoard">
          ${state.portal.posts.map(p => `
            <div class="sticky-note ${p.type === 'image' || p.type === 'video' ? 'media' : ''}" data-id="${p.id}" style="background:${STICKY_COLORS[p.color] || STICKY_COLORS.amber}">
              <button class="remove-sticky" data-id="${p.id}">&times;</button>
              ${p.type === 'image' ? `<img class="sticky-media" src="${p.mediaUrl}" alt="Pasted image">`
                : p.type === 'video' ? `<video class="sticky-media" src="${p.mediaUrl}" controls></video>`
                : escapeHtml(p.text)}
            </div>
          `).join('') || '<p style="color:var(--text-muted);font-size:13px;">No posts yet — pin something below, or paste an image or video anywhere on this page.</p>'}
        </div>
        <form class="add-sticky-form" id="addStickyForm">
          <input type="text" id="stickyText" placeholder="Pin a note, or paste an image/video (Ctrl+V)&hellip;" required>
          <button type="submit">Pin</button>
        </form>
      </div>

      <div class="portal-section">
        <h3>Quick links</h3>
        <div class="link-list" id="linkList">
          ${state.portal.links.map(l => `
            <div class="link-row">
              <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>
              <button data-id="${l.id}">&times;</button>
            </div>
          `).join('') || '<p style="color:var(--text-muted);font-size:13px;">No links yet.</p>'}
        </div>
        <form class="add-link-form" id="addLinkForm">
          <input type="text" id="linkLabel" placeholder="Label (e.g. Router admin)" required>
          <input type="text" id="linkUrl" placeholder="http://192.168.1.1" required>
          <button type="submit">Add link</button>
        </form>
      </div>
    </div>

    <div class="portal-section backup-section">
      <h3>Backup &amp; restore</h3>
      <p style="color:var(--text-muted); font-size:13px; margin:0 0 14px;">
        Download your shared files, notes, drawings, sheets, and messages as a single file &mdash;
        everything, or just the parts you pick. Keep it somewhere safe in case you ever need to reinstall.
      </p>
      <div class="backup-actions">
        <button class="tool-btn" id="exportBackupBtn">Export a backup&hellip;</button>
        <button class="tool-btn" id="importBackupBtn">Import a backup&hellip;</button>
        <input type="file" id="importBackupInput" accept=".zip" hidden>
      </div>
      <div class="status" id="backupStatus"></div>
    </div>
  `;

  content.querySelectorAll('.remove-sticky').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await fetch(`/api/portal/posts/${btn.dataset.id}`, { method: 'DELETE' });
      loadPortalView();
    });
  });

  // Notes stay a small, uniform size — anything too long to fit gets a
  // subtle fade at the bottom, and hovering shows the full content in a
  // floating tooltip instead of the note itself growing and pushing its
  // neighbors around.
  content.querySelectorAll('.sticky-note').forEach(note => {
    if (note.scrollHeight > note.clientHeight + 2) {
      note.classList.add('truncated');
      note.addEventListener('mouseenter', () => showStickyTooltip(note));
      note.addEventListener('mouseleave', hideStickyTooltip);
    }
  });
  // Bulletin-board photos are pinned at a small, uniform tile size to keep
  // the board tidy, which crops most of them (object-fit:cover) and makes
  // some too small to make out — same fix as the album art thumbnails:
  // hover (or tap, on a touch screen) to see the whole thing full-size.
  // The listener goes on the whole tile, not just the inner <img> — that
  // was the gap before: the tile has its own padding around the photo, so
  // hovering anywhere that wasn't precisely on the image itself did
  // nothing, which is inconsistent with how the text tiles' tooltip
  // already triggers from anywhere on the tile.
  content.querySelectorAll('.sticky-note.media').forEach(note => {
    const img = note.querySelector('img.sticky-media');
    if (!img) return; // video tiles already have their own full-size controls
    note.addEventListener('mouseenter', () => showArtPreview(note, img.src));
    note.addEventListener('mouseleave', hideArtPreview);
    note.addEventListener('click', (e) => {
      if (e.target.closest('.remove-sticky')) return;
      e.stopPropagation();
      toggleArtPreview(note, img.src);
    });
  });
  content.querySelectorAll('#linkList button[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/portal/links/${btn.dataset.id}`, { method: 'DELETE' });
      loadPortalView();
    });
  });
  // Double-click any tile to see its full content in a new tab — the
  // bulletin board tiles are deliberately small and uniform, so this is
  // the "see it properly" option: images and videos open at their real
  // file resolution (not squeezed into the small hover preview box),
  // and text opens as a plain, fully-readable page instead of staying
  // limited to the small truncated tooltip.
  content.querySelectorAll('.sticky-note').forEach(note => {
    note.addEventListener('dblclick', (e) => {
      if (e.target.closest('.remove-sticky')) return;
      const post = state.portal.posts.find(p => p.id === note.dataset.id);
      if (!post) return;
      if (post.type === 'image' || post.type === 'video') {
        window.open(post.mediaUrl, '_blank');
      } else {
        window.open('data:text/plain;charset=utf-8,' + encodeURIComponent(post.text || ''), '_blank');
      }
    });
  });

  el('#addStickyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = el('#stickyText').value.trim();
    if (!text) return;
    const colors = Object.keys(STICKY_COLORS);
    const color = colors[Math.floor(Math.random() * colors.length)];
    await fetch('/api/portal/posts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, color })
    });
    loadPortalView();
  });

  el('#addLinkForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const label = el('#linkLabel').value.trim();
    let url = el('#linkUrl').value.trim();
    if (!label || !url) return;
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    await fetch('/api/portal/links', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, url })
    });
    loadPortalView();
  });

  el('#exportBackupBtn').addEventListener('click', openBackupChooser);
  el('#importBackupBtn').addEventListener('click', () => el('#importBackupInput').click());
  el('#importBackupInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('Importing a backup replaces whatever parts of this install the backup contains ' +
      '(for example, a Music-only backup replaces just the Music shelf). Everything else is left alone. ' +
      'Older full backups replace everything. This can\'t be undone. Continue?')) {
      e.target.value = '';
      return;
    }
    const status = el('#backupStatus');
    status.className = 'status';
    status.textContent = 'Importing\u2026 this can take a moment for larger backups.';
    const form = new FormData();
    form.append('backup', file);
    try {
      const res = await fetch('/api/backup/import', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed.');
      status.className = 'status ok';
      status.textContent = data.message || 'Import complete. Restart The Shelf for everything to load correctly.';
    } catch (err) {
      status.className = 'status err';
      status.textContent = err.message;
    }
    e.target.value = '';
  });
}

// Loads and renders the account list in the host-only "Accounts" section
// of the Home dashboard — kept separate from renderPortal so it can
// refresh on its own after adding, editing, or removing an account
// without re-rendering the whole page.
async function loadUserList() {
  try {
    const users = await fetch('/api/auth/users').then(r => r.json());
    renderUserList(users);
  } catch {
    // Best-effort — leaves the "Loading…" placeholder if this fails.
  }
}

function renderUserList(users) {
  const container = el('#userList');
  if (!container) return; // section isn't showing on this device — nothing to do
  if (!users.length) {
    container.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">No accounts yet — anyone can currently make changes from any device.</p>';
    return;
  }
  container.innerHTML = users.map(u => `
    <div class="user-row" data-id="${u.id}">
      <span class="user-name">${escapeHtml(u.username)}</span>
      <select class="user-role-select" data-id="${u.id}">
        <option value="write" ${u.role === 'write' ? 'selected' : ''}>Can make changes</option>
        <option value="read" ${u.role === 'read' ? 'selected' : ''}>Read only</option>
      </select>
      <button class="user-reset-btn" data-id="${u.id}">Reset password</button>
      <button class="user-remove-btn" data-id="${u.id}">Remove</button>
    </div>
  `).join('');

  container.querySelectorAll('.user-role-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      await fetch(`/api/auth/users/${sel.dataset.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: sel.value })
      });
    });
  });
  container.querySelectorAll('.user-reset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newPassword = prompt('New password (4+ characters):');
      if (!newPassword) return;
      const res = await fetch(`/api/auth/users/${btn.dataset.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword })
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Could not update the password.');
    });
  });
  container.querySelectorAll('.user-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.user-row');
      const name = row.querySelector('.user-name').textContent;
      if (!confirm(`Remove the account "${name}"?`)) return;
      await fetch(`/api/auth/users/${btn.dataset.id}`, { method: 'DELETE' });
      loadUserList();
    });
  });
}

// ---------- Notes ----------

async function loadNotesView() {
  state.notes.items = await fetch('/api/notes').then(r => r.json());
  if (!state.notes.activeId && state.notes.items.length) state.notes.activeId = state.notes.items[0].id;
  setToolHeader('Notes', `${state.notes.items.length} note${state.notes.items.length === 1 ? '' : 's'}`, '+ New note', createNote);
  renderNotes();
}

function renderNotes() {
  const content = el('#content');
  const active = state.notes.items.find(n => n.id === state.notes.activeId);

  content.innerHTML = `
    <div class="split-pane">
      <div class="split-list">
        <button class="split-new-btn" id="newNoteBtn">+ New note</button>
        ${state.notes.items.map(n => `
          <div class="split-list-item ${n.id === state.notes.activeId ? 'active' : ''}" data-id="${n.id}">
            <div class="item-title">${escapeHtml(n.title || 'Untitled')}</div>
            <div class="item-sub">${new Date(n.updated).toLocaleDateString()}</div>
          </div>
        `).join('') || '<p style="color:var(--text-muted);font-size:13px;">No notes yet.</p>'}
      </div>
      <div class="split-editor">
        ${active ? `
          <div class="editor-topbar">
            <input type="text" class="editor-title-input" id="noteTitleInput" value="${escapeHtml(active.title || '')}" placeholder="Note title">
            <button class="delete-btn" id="deleteNoteBtn">Remove</button>
          </div>
          ${active.image ? `
            <div class="note-image-wrap">
              <img src="${active.image}" class="note-image" alt="Pasted image">
              <button class="note-image-remove" id="removeNoteImageBtn" title="Remove image">&times;</button>
            </div>
          ` : ''}
          <textarea class="notes-textarea" id="noteBodyInput" placeholder="Start typing, or paste an image&hellip;">${escapeHtml(active.body || '')}</textarea>
        ` : `<div class="empty-state">No note selected. Create one to get started.</div>`}
      </div>
    </div>
  `;

  content.querySelectorAll('.split-list-item').forEach(item => {
    item.addEventListener('click', () => { state.notes.activeId = item.dataset.id; renderNotes(); });
  });
  el('#newNoteBtn').addEventListener('click', createNote);

  if (active) {
    const titleInput = el('#noteTitleInput');
    const bodyInput = el('#noteBodyInput');
    let saveTimer;
    const scheduleSave = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveNote(active.id, titleInput.value, bodyInput.value, active.image), 500);
    };
    titleInput.addEventListener('input', scheduleSave);
    bodyInput.addEventListener('input', scheduleSave);
    el('#deleteNoteBtn').addEventListener('click', () => deleteNote(active.id));
    const removeImgBtn = el('#removeNoteImageBtn');
    if (removeImgBtn) {
      removeImgBtn.addEventListener('click', () => {
        active.image = null;
        saveNote(active.id, titleInput.value, bodyInput.value, null);
        renderNotes();
      });
    }
  }
}

// Paste an image while a note is open and it's attached to that note as a
// thumbnail, alongside the text body.
document.addEventListener('paste', async (e) => {
  if (state.view !== 'notes' || !state.notes.activeId) return;
  const bodyInput = document.getElementById('noteBodyInput');
  if (!bodyInput || document.activeElement !== bodyInput) return;
  const file = extractImageFromClipboardEvent(e);
  if (!file) return;
  e.preventDefault();
  try {
    const dataUrl = await resizeImageFile(file, 1000);
    const active = state.notes.items.find(n => n.id === state.notes.activeId);
    active.image = dataUrl;
    await saveNote(active.id, el('#noteTitleInput').value, bodyInput.value, dataUrl);
    renderNotes();
  } catch (err) {
    alert(err.message);
  }
});

async function createNote() {
  const note = await fetch('/api/notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Untitled note', body: '' })
  }).then(r => r.json());
  state.notes.items.unshift(note);
  state.notes.activeId = note.id;
  setToolHeader('Notes', `${state.notes.items.length} notes`, '+ New note', createNote);
  renderNotes();
}

async function saveNote(id, title, body, image) {
  const updated = await fetch(`/api/notes/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, image: image || null })
  }).then(r => r.json());
  const idx = state.notes.items.findIndex(n => n.id === id);
  if (idx !== -1) state.notes.items[idx] = updated;
  const listItem = document.querySelector(`.split-list-item[data-id="${id}"]`);
  if (listItem) {
    listItem.querySelector('.item-title').textContent = updated.title || 'Untitled';
    listItem.querySelector('.item-sub').textContent = new Date(updated.updated).toLocaleDateString();
  }
}

async function deleteNote(id) {
  if (!confirm('Delete this note?')) return;
  await fetch(`/api/notes/${id}`, { method: 'DELETE' });
  state.notes.items = state.notes.items.filter(n => n.id !== id);
  if (state.notes.activeId === id) state.notes.activeId = state.notes.items[0]?.id || null;
  setToolHeader('Notes', `${state.notes.items.length} notes`, '+ New note', createNote);
  renderNotes();
}

// ---------- Docs (word processor) ----------
// Uses document.execCommand for basic formatting. It's a deprecated API but
// still broadly supported by browsers for simple contenteditable toolbars
// like this one, and keeps things dependency-free.

// Paste an image while on Docs with the editor focused and it gets
// inserted inline at the cursor, same as pasting into any rich text editor.
document.addEventListener('paste', async (e) => {
  if (state.view !== 'docs') return;
  const bodyEl = document.getElementById('docBody');
  if (!bodyEl || document.activeElement !== bodyEl) return;
  const file = extractImageFromClipboardEvent(e);
  if (!file) return; // not an image — let normal text pasting happen
  e.preventDefault();
  try {
    const dataUrl = await resizeImageFile(file, 1000);
    document.execCommand('insertImage', false, dataUrl);
    bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (err) {
    alert(err.message);
  }
});

async function loadDocsView() {
  state.documents.items = await fetch('/api/documents').then(r => r.json());
  if (!state.documents.activeId && state.documents.items.length) state.documents.activeId = state.documents.items[0].id;
  setToolHeader('Docs', `${state.documents.items.length} document${state.documents.items.length === 1 ? '' : 's'}`, '+ New document', createDocument);
  renderDocs();
}

function renderDocs() {
  const content = el('#content');
  const active = state.documents.items.find(d => d.id === state.documents.activeId);

  content.innerHTML = `
    <div class="split-pane">
      <div class="split-list">
        <button class="split-new-btn" id="newDocBtn">+ New document</button>
        ${state.documents.items.map(d => `
          <div class="split-list-item ${d.id === state.documents.activeId ? 'active' : ''}" data-id="${d.id}">
            <div class="item-title">${escapeHtml(d.title || 'Untitled')}</div>
            <div class="item-sub">${new Date(d.updated).toLocaleDateString()}</div>
          </div>
        `).join('') || '<p style="color:var(--text-muted);font-size:13px;">No documents yet.</p>'}
      </div>
      <div class="split-editor">
        ${active ? `
          <div class="editor-topbar">
            <input type="text" class="editor-title-input" id="docTitleInput" value="${escapeHtml(active.title || '')}" placeholder="Document title">
            <button class="delete-btn" id="deleteDocBtn">Remove</button>
          </div>
          <div class="docs-toolbar">
            <button type="button" data-cmd="bold"><b>B</b></button>
            <button type="button" data-cmd="italic"><i>I</i></button>
            <button type="button" data-cmd="underline"><u>U</u></button>
            <button type="button" data-cmd="formatBlock" data-value="H1">H1</button>
            <button type="button" data-cmd="formatBlock" data-value="H2">H2</button>
            <button type="button" data-cmd="insertUnorderedList">&bull; List</button>
            <button type="button" data-cmd="insertOrderedList">1. List</button>
            <button type="button" data-cmd="removeFormat">Clear</button>
            <label class="docs-size-control">Size
              <input type="range" id="docFontSize" min="1" max="7" step="1" value="3">
              <span id="docFontSizeLabel">Normal</span>
            </label>
          </div>
          <div class="docs-editor" id="docBody" contenteditable="true">${active.body || ''}</div>
        ` : `<div class="empty-state">No document selected. Create one to get started.</div>`}
      </div>
    </div>
  `;

  content.querySelectorAll('.split-list-item').forEach(item => {
    item.addEventListener('click', () => { state.documents.activeId = item.dataset.id; renderDocs(); });
  });
  el('#newDocBtn').addEventListener('click', createDocument);

  if (active) {
    const titleInput = el('#docTitleInput');
    const bodyEl = el('#docBody');
    let saveTimer;
    const scheduleSave = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveDocument(active.id, titleInput.value, bodyEl.innerHTML), 600);
    };
    titleInput.addEventListener('input', scheduleSave);
    bodyEl.addEventListener('input', scheduleSave);
    el('#deleteDocBtn').addEventListener('click', () => deleteDocument(active.id));

    content.querySelectorAll('.docs-toolbar button').forEach(btn => {
      btn.addEventListener('click', () => {
        bodyEl.focus();
        document.execCommand(btn.dataset.cmd, false, btn.dataset.value || null);
        scheduleSave();
      });
    });

    const sizeLabels = { 1: 'Tiny', 2: 'Small', 3: 'Normal', 4: 'Medium', 5: 'Large', 6: 'X-Large', 7: 'Huge' };
    el('#docFontSize').addEventListener('input', (e) => {
      el('#docFontSizeLabel').textContent = sizeLabels[e.target.value] || 'Normal';
      bodyEl.focus();
      document.execCommand('fontSize', false, e.target.value);
      scheduleSave();
    });
  }
}

async function createDocument() {
  const doc = await fetch('/api/documents', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Untitled document', body: '' })
  }).then(r => r.json());
  state.documents.items.unshift(doc);
  state.documents.activeId = doc.id;
  setToolHeader('Docs', `${state.documents.items.length} documents`, '+ New document', createDocument);
  renderDocs();
}

async function saveDocument(id, title, body) {
  const updated = await fetch(`/api/documents/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body })
  }).then(r => r.json());
  const idx = state.documents.items.findIndex(d => d.id === id);
  if (idx !== -1) state.documents.items[idx] = updated;
  const listItem = document.querySelector(`.split-list-item[data-id="${id}"]`);
  if (listItem) {
    listItem.querySelector('.item-title').textContent = updated.title || 'Untitled';
    listItem.querySelector('.item-sub').textContent = new Date(updated.updated).toLocaleDateString();
  }
}

async function deleteDocument(id) {
  if (!confirm('Delete this document?')) return;
  await fetch(`/api/documents/${id}`, { method: 'DELETE' });
  state.documents.items = state.documents.items.filter(d => d.id !== id);
  if (state.documents.activeId === id) state.documents.activeId = state.documents.items[0]?.id || null;
  setToolHeader('Docs', `${state.documents.items.length} documents`, '+ New document', createDocument);
  renderDocs();
}

// ---------- Slides (presentations) ----------

async function loadSlidesView() {
  state.presentations.items = await fetch('/api/presentations').then(r => r.json());
  if (!state.presentations.activeId && state.presentations.items.length) state.presentations.activeId = state.presentations.items[0].id;
  state.presentations.activeSlide = 0;
  setToolHeader('Slides', `${state.presentations.items.length} presentation${state.presentations.items.length === 1 ? '' : 's'}`, '+ New presentation', createPresentation);
  renderSlides();
}

function renderSlides() {
  const content = el('#content');
  const active = state.presentations.items.find(p => p.id === state.presentations.activeId);
  const slides = (active && active.slides) || [];
  const slideIdx = Math.min(state.presentations.activeSlide, Math.max(slides.length - 1, 0));
  const slide = slides[slideIdx];

  content.innerHTML = `
    <div class="split-pane">
      <div class="split-list">
        <button class="split-new-btn" id="newPresBtn">+ New presentation</button>
        ${state.presentations.items.map(p => `
          <div class="split-list-item ${p.id === state.presentations.activeId ? 'active' : ''}" data-id="${p.id}">
            <div class="item-title">${escapeHtml(p.title || 'Untitled')}</div>
            <div class="item-sub">${(p.slides || []).length} slide${(p.slides || []).length === 1 ? '' : 's'}</div>
          </div>
        `).join('') || '<p style="color:var(--text-muted);font-size:13px;">No presentations yet.</p>'}
      </div>
      <div class="split-editor">
        ${active ? `
          <div class="editor-topbar">
            <input type="text" class="editor-title-input" id="presTitleInput" value="${escapeHtml(active.title || '')}" placeholder="Presentation title">
            <button class="present-btn" id="presentBtn" ${slides.length === 0 ? 'disabled' : ''}>Present</button>
            <button class="delete-btn" id="deletePresBtn">Remove</button>
          </div>
          <div style="display:flex; gap:16px; flex:1; min-height:0;">
            <div class="slide-editor-list" style="width:160px; flex-shrink:0;">
              ${slides.map((s, i) => `
                <div class="slide-editor-item ${i === slideIdx ? 'active' : ''}" data-index="${i}">
                  Slide ${i + 1}${s.heading ? ': ' + escapeHtml(s.heading.slice(0, 18)) : ''}
                </div>
              `).join('')}
              <button class="split-new-btn" id="addSlideBtn">+ Add slide</button>
            </div>
            ${slide ? `
              <div class="slide-fields">
                <input type="text" id="slideHeadingInput" value="${escapeHtml(slide.heading || '')}" placeholder="Slide heading">
                ${slide.image ? `
                  <div class="slide-image-wrap">
                    <img src="${slide.image}" class="slide-image" alt="Slide image">
                    <button class="slide-image-remove" id="removeSlideImageBtn" title="Remove image">&times;</button>
                  </div>
                ` : `<p class="slide-image-hint">Paste an image (Ctrl+V) to add one to this slide.</p>`}
                <textarea id="slideBodyInput" placeholder="Slide content&hellip;">${escapeHtml(slide.body || '')}</textarea>
                <button class="delete-btn" id="removeSlideBtn" style="align-self:flex-start;">Remove this slide</button>
              </div>
            ` : `<div class="empty-state" style="flex:1;">No slides yet — add one to get started.</div>`}
          </div>
        ` : `<div class="empty-state">No presentation selected. Create one to get started.</div>`}
      </div>
    </div>
  `;

  content.querySelectorAll('.split-list-item').forEach(item => {
    item.addEventListener('click', () => {
      state.presentations.activeId = item.dataset.id;
      state.presentations.activeSlide = 0;
      renderSlides();
    });
  });
  el('#newPresBtn').addEventListener('click', createPresentation);

  if (!active) return;

  el('#deletePresBtn').addEventListener('click', () => deletePresentation(active.id));

  let saveTimer;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => savePresentation(active), 600);
  };

  el('#presTitleInput').addEventListener('input', (e) => { active.title = e.target.value; scheduleSave(); });

  content.querySelectorAll('.slide-editor-item').forEach(item => {
    item.addEventListener('click', () => { state.presentations.activeSlide = Number(item.dataset.index); renderSlides(); });
  });

  el('#addSlideBtn').addEventListener('click', () => {
    active.slides = active.slides || [];
    active.slides.push({ heading: 'New slide', body: '' });
    state.presentations.activeSlide = active.slides.length - 1;
    savePresentation(active).then(renderSlides);
  });

  if (slide) {
    el('#slideHeadingInput').addEventListener('input', (e) => { slide.heading = e.target.value; scheduleSave(); });
    el('#slideBodyInput').addEventListener('input', (e) => { slide.body = e.target.value; scheduleSave(); });
    el('#removeSlideBtn').addEventListener('click', () => {
      active.slides.splice(slideIdx, 1);
      state.presentations.activeSlide = Math.max(0, slideIdx - 1);
      savePresentation(active).then(renderSlides);
    });
    const removeImgBtn = el('#removeSlideImageBtn');
    if (removeImgBtn) {
      removeImgBtn.addEventListener('click', () => {
        slide.image = null;
        savePresentation(active).then(renderSlides);
      });
    }
  }

  if (slides.length > 0) {
    el('#presentBtn').addEventListener('click', () => startPresenting(active.slides));
  }
}

// Paste an image while editing a slide and it's attached to that slide.
document.addEventListener('paste', async (e) => {
  if (state.view !== 'slides' || !state.presentations.activeId) return;
  const bodyInput = document.getElementById('slideBodyInput');
  const headingInput = document.getElementById('slideHeadingInput');
  const activeInput = document.activeElement;
  if (activeInput !== bodyInput && activeInput !== headingInput) return;
  const file = extractImageFromClipboardEvent(e);
  if (!file) return;
  e.preventDefault();
  try {
    const dataUrl = await resizeImageFile(file, 1000);
    const active = state.presentations.items.find(p => p.id === state.presentations.activeId);
    const slide = (active.slides || [])[state.presentations.activeSlide];
    if (!slide) return;
    slide.image = dataUrl;
    await savePresentation(active);
    renderSlides();
  } catch (err) {
    alert(err.message);
  }
});

async function createPresentation() {
  const pres = await fetch('/api/presentations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Untitled presentation', slides: [] })
  }).then(r => r.json());
  state.presentations.items.unshift(pres);
  state.presentations.activeId = pres.id;
  state.presentations.activeSlide = 0;
  setToolHeader('Slides', `${state.presentations.items.length} presentations`, '+ New presentation', createPresentation);
  renderSlides();
}

async function savePresentation(item) {
  const updated = await fetch(`/api/presentations/${item.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: item.title, slides: item.slides })
  }).then(r => r.json());
  const idx = state.presentations.items.findIndex(p => p.id === item.id);
  if (idx !== -1) state.presentations.items[idx] = updated;
  return updated;
}

async function deletePresentation(id) {
  if (!confirm('Delete this presentation?')) return;
  await fetch(`/api/presentations/${id}`, { method: 'DELETE' });
  state.presentations.items = state.presentations.items.filter(p => p.id !== id);
  if (state.presentations.activeId === id) state.presentations.activeId = state.presentations.items[0]?.id || null;
  setToolHeader('Slides', `${state.presentations.items.length} presentations`, '+ New presentation', createPresentation);
  renderSlides();
}

// Present mode (fullscreen slideshow of a presentation's slides)
const presentOverlay = el('#presentOverlay');
let presentSlides = [];
let presentIndex = 0;

function startPresenting(slides) {
  presentSlides = slides;
  presentIndex = 0;
  presentOverlay.hidden = false;
  showPresentSlide();
}

function showPresentSlide() {
  const s = presentSlides[presentIndex];
  el('#presentHeading').textContent = (s && s.heading) || '';
  el('#presentBody').textContent = (s && s.body) || '';
  el('#presentCounter').textContent = `${presentIndex + 1} of ${presentSlides.length}`;
  const img = el('#presentImage');
  if (s && s.image) {
    img.src = s.image;
    img.hidden = false;
  } else {
    img.hidden = true;
    img.src = '';
  }
}

function closePresent() {
  presentOverlay.hidden = true;
}

el('#presentClose').addEventListener('click', closePresent);
el('#presentNext').addEventListener('click', () => { presentIndex = Math.min(presentIndex + 1, presentSlides.length - 1); showPresentSlide(); });
el('#presentPrev').addEventListener('click', () => { presentIndex = Math.max(presentIndex - 1, 0); showPresentSlide(); });

// ---------- Draw pad ----------

async function loadDrawView() {
  state.drawings.items = await fetch('/api/drawings').then(r => r.json());
  if (!state.drawings.activeId && state.drawings.items.length) state.drawings.activeId = state.drawings.items[0].id;
  setToolHeader('Draw', `${state.drawings.items.length} drawing${state.drawings.items.length === 1 ? '' : 's'}`, null, null);
  renderDraw();
}

const DRAW_PALETTE = { black: '#000000', red: '#E2725B', amber: '#F2B441', mint: '#6FCF97', blue: '#7AA8F2', white: '#FFFFFF' };

function renderDraw() {
  const content = el('#content');
  content.innerHTML = `
    <div style="display:flex; flex-direction:column; height:68vh; gap:6px;">
      <div class="draw-tabs" id="drawTabs">
        ${state.drawings.items.map(d => `
          <div class="draw-tab ${d.id === state.drawings.activeId ? 'active' : ''}" data-id="${d.id}">
            <span class="draw-tab-label">${escapeHtml(d.title || 'Untitled')}</span>
            <button class="draw-tab-close" data-id="${d.id}" title="Delete this drawing">&times;</button>
          </div>
        `).join('')}
        <button class="draw-tab-add" id="addDrawTab">+ New</button>
      </div>
      <div class="draw-toolbar">
        ${Object.entries(DRAW_PALETTE).map(([name, hex]) => `
          <button class="color-swatch-btn ${state.drawings.color === hex && !state.drawings.erasing ? 'active' : ''}"
            style="background:${hex}; border-color:${hex === '#FFFFFF' ? '#999' : 'transparent'}" data-color="${hex}" title="${name}"></button>
        `).join('')}
        <label>Size <input type="range" id="brushSize" min="2" max="30" value="${state.drawings.size}"></label>
        <button class="tool-btn ${!state.drawings.erasing && !state.drawings.textMode && !state.drawings.shapeMode ? 'active' : ''}" id="penToolBtn" title="Pen (normal drawing)">Pen</button>
        <button class="tool-btn ${state.drawings.erasing ? 'active' : ''}" id="eraserBtn">Eraser</button>
        <button class="tool-btn ${state.drawings.textMode ? 'active' : ''}" id="textModeBtn">Text</button>
        <button class="tool-btn ${state.drawings.shapeMode === 'rect' ? 'active' : ''}" id="rectToolBtn">Rect</button>
        <button class="tool-btn ${state.drawings.shapeMode === 'ellipse' ? 'active' : ''}" id="ellipseToolBtn">Circle</button>
        <button class="tool-btn ${state.drawings.shapeMode === 'line' ? 'active' : ''}" id="lineToolBtn">Line</button>
        <button class="tool-btn" id="undoBtn">Undo</button>
        <button class="tool-btn" id="clearCanvasBtn">Clear</button>
        <button class="tool-btn" id="saveDrawBtn">Save</button>
        <button class="tool-btn" id="copyDrawBtn" title="Copy this drawing to paste elsewhere">Copy</button>
        ${state.drawings.activeId ? `<button class="delete-btn" id="deleteDrawBtn">Remove</button>` : ''}
      </div>
      <div class="draw-canvas-wrap">
        <canvas id="drawCanvas" width="1000" height="600"></canvas>
        <div class="brush-cursor" id="brushCursor"></div>
      </div>
    </div>
  `;

  content.querySelectorAll('.draw-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      if (tab.dataset.id === state.drawings.activeId) return; // already viewing this one
      await saveDrawingIfDirty();
      state.drawings.activeId = tab.dataset.id;
      state.drawings.undoStack = [];
      state.drawings.dirty = false;
      renderDraw();
    });
  });
  content.querySelectorAll('.draw-tab-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteDrawing(btn.dataset.id);
    });
  });
  el('#addDrawTab').addEventListener('click', createDrawing);

  content.querySelectorAll('.color-swatch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.drawings.color = btn.dataset.color;
      state.drawings.erasing = false;
      updateDrawToolbarActiveStates();
    });
  });
  el('#penToolBtn').addEventListener('click', () => {
    state.drawings.erasing = false;
    state.drawings.textMode = false;
    state.drawings.shapeMode = null;
    updateDrawToolbarActiveStates();
    updateDrawCursorMode();
  });
  el('#eraserBtn').addEventListener('click', () => {
    state.drawings.erasing = !state.drawings.erasing;
    if (state.drawings.erasing) { state.drawings.textMode = false; state.drawings.shapeMode = null; }
    updateDrawToolbarActiveStates();
    updateDrawCursorMode();
  });
  el('#textModeBtn').addEventListener('click', () => {
    state.drawings.textMode = !state.drawings.textMode;
    if (state.drawings.textMode) { state.drawings.erasing = false; state.drawings.shapeMode = null; }
    updateDrawToolbarActiveStates();
    updateDrawCursorMode();
  });
  const setShapeMode = (mode) => {
    state.drawings.shapeMode = state.drawings.shapeMode === mode ? null : mode;
    if (state.drawings.shapeMode) { state.drawings.erasing = false; state.drawings.textMode = false; }
    updateDrawToolbarActiveStates();
    updateDrawCursorMode();
  };
  el('#rectToolBtn').addEventListener('click', () => setShapeMode('rect'));
  el('#ellipseToolBtn').addEventListener('click', () => setShapeMode('ellipse'));
  el('#lineToolBtn').addEventListener('click', () => setShapeMode('line'));
  el('#brushSize').addEventListener('input', (e) => { state.drawings.size = Number(e.target.value); refreshBrushCursorSize(); });
  el('#clearCanvasBtn').addEventListener('click', clearCanvas);
  el('#undoBtn').addEventListener('click', undoDraw);
  el('#saveDrawBtn').addEventListener('click', saveDrawing);
  el('#copyDrawBtn').addEventListener('click', copyDrawingToClipboard);
  if (state.drawings.activeId) {
    el('#deleteDrawBtn').addEventListener('click', () => deleteDrawing(state.drawings.activeId));
  }

  setupCanvas();
}

function updateDrawToolbarActiveStates() {
  document.querySelectorAll('.color-swatch-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === state.drawings.color && !state.drawings.erasing);
  });
  const penBtn = document.getElementById('penToolBtn');
  if (penBtn) penBtn.classList.toggle('active', !state.drawings.erasing && !state.drawings.textMode && !state.drawings.shapeMode);
  const eraserBtn = document.getElementById('eraserBtn');
  if (eraserBtn) eraserBtn.classList.toggle('active', state.drawings.erasing);
  const textBtn = document.getElementById('textModeBtn');
  if (textBtn) textBtn.classList.toggle('active', state.drawings.textMode);
  const rectBtn = document.getElementById('rectToolBtn');
  if (rectBtn) rectBtn.classList.toggle('active', state.drawings.shapeMode === 'rect');
  const ellipseBtn = document.getElementById('ellipseToolBtn');
  if (ellipseBtn) ellipseBtn.classList.toggle('active', state.drawings.shapeMode === 'ellipse');
  const lineBtn = document.getElementById('lineToolBtn');
  if (lineBtn) lineBtn.classList.toggle('active', state.drawings.shapeMode === 'line');
}

// Switches the canvas cursor between the brush-preview circle (drawing/
// erasing) and a plain text cursor (text mode), without needing to reload
// the canvas the way a full renderDraw() would.
function updateDrawCursorMode() {
  const canvas = document.getElementById('drawCanvas');
  const cursorEl = document.getElementById('brushCursor');
  if (!canvas) return;
  canvas.style.cursor = 'none'; // we always show our own visible indicator instead
  if (cursorEl) {
    cursorEl.classList.toggle('text-mode', state.drawings.textMode);
    refreshBrushCursorSize();
  }
}

let drawCtx = null;
let isDrawing = false;
let lastPoint = null;
let shapeStartPoint = null;
let shapeSnapshot = null;

// setupCanvas() runs on every re-render of the Draw tool (every tab switch,
// every new/deleted drawing) — a *window*-level listener (needed since the
// mouse can be released outside the canvas) must not be re-added each time,
// or they pile up forever and the page grinds to a halt after enough
// switches. Instead there's exactly one real listener, added once, which
// always calls whichever "end" handler is currently active.
let currentCanvasEndHandler = null;
let windowMouseupListenerAttached = false;
function ensureWindowMouseupListener() {
  if (windowMouseupListenerAttached) return;
  windowMouseupListenerAttached = true;
  window.addEventListener('mouseup', (e) => {
    if (currentCanvasEndHandler) currentCanvasEndHandler(e);
  });
}

// Sizes the visible cursor indicator: a circle matching brush width normally,
// or a thin caret-height bar while the Text tool is active.
function refreshBrushCursorSize() {
  const canvas = document.getElementById('drawCanvas');
  const cursorEl = document.getElementById('brushCursor');
  if (!canvas || !cursorEl) return;
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width ? rect.width / canvas.width : 1;
  if (state.drawings.textMode) {
    const fontSize = Math.max(state.drawings.size * 4, 14);
    cursorEl.style.width = '2px';
    cursorEl.style.height = `${Math.max(fontSize * scale, 10)}px`;
  } else {
    const size = Math.max(state.drawings.size * scale, 4);
    cursorEl.style.width = `${size}px`;
    cursorEl.style.height = `${size}px`;
  }
}

function setupCanvas() {
  const canvas = el('#drawCanvas');
  const cursorEl = el('#brushCursor');
  drawCtx = canvas.getContext('2d');
  drawCtx.fillStyle = '#fff';
  drawCtx.fillRect(0, 0, canvas.width, canvas.height);

  const active = state.drawings.items.find(d => d.id === state.drawings.activeId);
  if (active) {
    const img = new Image();
    img.onload = () => { drawCtx.drawImage(img, 0, 0, canvas.width, canvas.height); pushUndoSnapshot(); };
    img.src = `${active.url}?t=${active.updated}`;
  } else {
    pushUndoSnapshot();
  }

  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const start = (e) => {
    e.preventDefault();
    const p = getPos(e);
    if (state.drawings.textMode) {
      beginTextEntry(p, canvas);
      return;
    }
    if (state.drawings.shapeMode) {
      shapeStartPoint = p;
      shapeSnapshot = drawCtx.getImageData(0, 0, canvas.width, canvas.height);
      isDrawing = true;
      return;
    }
    isDrawing = true;
    lastPoint = p;
  };
  const move = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const p = getPos(e);
    if (state.drawings.shapeMode) {
      drawCtx.putImageData(shapeSnapshot, 0, 0);
      drawShape(state.drawings.shapeMode, shapeStartPoint, p);
      return;
    }
    drawCtx.strokeStyle = state.drawings.erasing ? '#ffffff' : state.drawings.color;
    drawCtx.lineWidth = state.drawings.size;
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';
    drawCtx.beginPath();
    drawCtx.moveTo(lastPoint.x, lastPoint.y);
    drawCtx.lineTo(p.x, p.y);
    drawCtx.stroke();
    lastPoint = p;
  };
  const end = (e) => {
    if (!isDrawing) return;
    isDrawing = false;
    if (state.drawings.shapeMode) {
      // Commit the final shape (mouseup/touchend may not carry a position,
      // so re-use the last preview already drawn onto the canvas as-is).
      shapeStartPoint = null;
      shapeSnapshot = null;
    }
    pushUndoSnapshot();
    state.drawings.dirty = true;
  };

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  currentCanvasEndHandler = end;
  ensureWindowMouseupListener();
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  // Custom cursor indicator (mouse only — touch has no persistent hover position)
  updateDrawCursorMode();
  const moveCursor = (e) => {
    const wrapRect = canvas.parentElement.getBoundingClientRect();
    cursorEl.style.left = `${e.clientX - wrapRect.left}px`;
    cursorEl.style.top = `${e.clientY - wrapRect.top}px`;
  };
  canvas.addEventListener('mouseenter', (e) => {
    cursorEl.style.display = 'block';
    refreshBrushCursorSize();
    moveCursor(e);
  });
  canvas.addEventListener('mousemove', moveCursor);
  canvas.addEventListener('mouseleave', () => { cursorEl.style.display = 'none'; });
}

// Text tool: spawns a small input right where the person clicked, styled to
// feel like typing directly onto the canvas. The text gets baked into the
// canvas as pixels (like a stamp) once confirmed — this is a raster drawing
// tool, not a vector editor, so there's no separate movable text object.
// The little grip handle lets you drag it to the right spot before hitting
// Enter, since it's easy to click slightly off from where you meant.
function beginTextEntry(pos, canvas) {
  const wrap = canvas.parentElement;
  const existingEntry = wrap.querySelector('.draw-text-entry');
  if (existingEntry) existingEntry.remove(); // only one text entry active at a time

  const rect = canvas.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  // The canvas is now letterboxed within its wrapper when their aspect
  // ratios don't match (so the canvas isn't visually stretched) — this
  // offset is how far the canvas's own edge sits from the wrapper's edge,
  // which is no longer always zero and has to be added back in below.
  const canvasOffsetX = rect.left - wrapRect.left;
  const canvasOffsetY = rect.top - wrapRect.top;
  // Separate X/Y scale factors — the canvas's displayed box is very rarely
  // the same aspect ratio as its internal 1000x600 resolution, so a single
  // shared scale (the original bug here) puts the Y position off.
  const scaleX = rect.width ? rect.width / canvas.width : 1;
  const scaleY = rect.height ? rect.height / canvas.height : 1;
  const fontSize = Math.max(state.drawings.size * 4, 14);

  let currentPos = { x: pos.x, y: pos.y }; // canvas-space; updated as the box is dragged

  const container = document.createElement('div');
  container.className = 'draw-text-entry';

  const handle = document.createElement('div');
  handle.className = 'draw-text-handle';
  handle.title = 'Drag to move';
  handle.innerHTML = '&#10021;';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'draw-text-input';
  input.style.fontSize = `${fontSize * scaleY}px`;
  input.style.color = state.drawings.color;

  container.appendChild(handle);
  container.appendChild(input);
  wrap.appendChild(container);

  const reposition = () => {
    container.style.left = `${canvasOffsetX + currentPos.x * scaleX}px`;
    container.style.top = `${canvasOffsetY + currentPos.y * scaleY}px`;
  };
  reposition();
  input.focus();

  let dragging = false;
  let dragStartClient = null;
  let dragStartPos = null;

  const dragMove = (e) => {
    if (!dragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    currentPos = {
      x: dragStartPos.x + (clientX - dragStartClient.x) / scaleX,
      y: dragStartPos.y + (clientY - dragStartClient.y) / scaleY
    };
    reposition();
  };
  const dragEnd = () => {
    dragging = false;
    document.removeEventListener('mousemove', dragMove);
    document.removeEventListener('mouseup', dragEnd);
    document.removeEventListener('touchmove', dragMove);
    document.removeEventListener('touchend', dragEnd);
  };
  const dragStart = (e) => {
    e.preventDefault(); // keeps focus on the input instead of shifting it to the handle
    dragging = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragStartClient = { x: clientX, y: clientY };
    dragStartPos = { x: currentPos.x, y: currentPos.y };
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('mouseup', dragEnd);
    document.addEventListener('touchmove', dragMove, { passive: false });
    document.addEventListener('touchend', dragEnd);
  };
  handle.addEventListener('mousedown', dragStart);
  handle.addEventListener('touchstart', dragStart, { passive: false });

  let settled = false;
  const commit = () => {
    if (settled) return;
    settled = true;
    const text = input.value.trim();
    if (text) {
      drawCtx.fillStyle = state.drawings.color;
      drawCtx.font = `${fontSize}px -apple-system, sans-serif`;
      drawCtx.textBaseline = 'top';
      drawCtx.fillText(text, currentPos.x, currentPos.y);
      pushUndoSnapshot();
      state.drawings.dirty = true;
    }
    dragEnd();
    container.remove();
  };
  const cancel = () => {
    if (settled) return;
    settled = true;
    dragEnd();
    container.remove();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', () => { if (!dragging) commit(); });
}

// Renders a rectangle, ellipse, or straight line between two canvas-space
// points. Called continuously while dragging (over a restored snapshot, for
// a live rubber-band preview) and once more on release to commit it.
function drawShape(mode, start, end) {
  drawCtx.strokeStyle = state.drawings.color;
  drawCtx.lineWidth = state.drawings.size;
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';

  if (mode === 'rect') {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    drawCtx.strokeRect(x, y, w, h);
  } else if (mode === 'ellipse') {
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;
    const rx = Math.max(Math.abs(end.x - start.x) / 2, 0.01);
    const ry = Math.max(Math.abs(end.y - start.y) / 2, 0.01);
    drawCtx.beginPath();
    drawCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    drawCtx.stroke();
  } else if (mode === 'line') {
    drawCtx.beginPath();
    drawCtx.moveTo(start.x, start.y);
    drawCtx.lineTo(end.x, end.y);
    drawCtx.stroke();
  }
}

function pushUndoSnapshot() {
  state.drawings.undoStack.push(el('#drawCanvas').toDataURL());
  if (state.drawings.undoStack.length > 20) state.drawings.undoStack.shift();
}

function undoDraw() {
  if (state.drawings.undoStack.length <= 1) return;
  state.drawings.undoStack.pop();
  const prev = state.drawings.undoStack[state.drawings.undoStack.length - 1];
  const img = new Image();
  img.onload = () => drawCtx.drawImage(img, 0, 0);
  img.src = prev;
}

function clearCanvas() {
  const canvas = el('#drawCanvas');
  drawCtx.fillStyle = '#fff';
  drawCtx.fillRect(0, 0, canvas.width, canvas.height);
  pushUndoSnapshot();
  state.drawings.dirty = true;
}

async function createDrawing() {
  await saveDrawingIfDirty();
  const canvas = document.createElement('canvas');
  canvas.width = 1000; canvas.height = 600;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/png');
  const d = await fetch('/api/drawings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `Drawing ${state.drawings.items.length + 1}`, dataUrl })
  }).then(r => r.json());
  state.drawings.items.unshift(d);
  state.drawings.activeId = d.id;
  state.drawings.undoStack = [];
  state.drawings.dirty = false;
  setToolHeader('Draw', `${state.drawings.items.length} drawings`, null, null);
  renderDraw();
}

async function saveDrawing() {
  const canvas = el('#drawCanvas');
  const dataUrl = canvas.toDataURL('image/png');
  if (!state.drawings.activeId) {
    const d = await fetch('/api/drawings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Untitled drawing', dataUrl })
    }).then(r => r.json());
    state.drawings.items.unshift(d);
    state.drawings.activeId = d.id;
    state.drawings.dirty = false;
    renderDraw();
    return;
  }
  const existing = state.drawings.items.find(d => d.id === state.drawings.activeId);
  const updated = await fetch(`/api/drawings/${state.drawings.activeId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: existing?.title, dataUrl })
  }).then(r => r.json());
  const idx = state.drawings.items.findIndex(d => d.id === updated.id);
  if (idx !== -1) state.drawings.items[idx] = updated;
  state.drawings.dirty = false;
}

// Saves the current canvas first if it has unsaved strokes since the last
// save — called before anything that would otherwise discard it (switching
// drawing tabs, starting a new drawing, or leaving the Draw tool entirely).
async function saveDrawingIfDirty() {
  if (state.view === 'draw' && state.drawings.dirty && el('#drawCanvas')) {
    await saveDrawing();
  }
}

// Copies the current canvas to the real OS clipboard as an image, so it can
// be pasted into Docs, Notes, Slides, Messages, or the Home bulletin board
// (or anywhere else, for that matter — any image-aware app on the computer).
async function copyDrawingToClipboard() {
  const canvas = el('#drawCanvas');
  const btn = el('#copyDrawBtn');
  if (!navigator.clipboard || !window.ClipboardItem) {
    alert("This browser can't copy images to the clipboard from here. Try Save instead, then paste the downloaded file where you need it.");
    return;
  }
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      if (btn) {
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = original; }, 1200);
      }
    } catch (err) {
      // Browsers restrict clipboard writes to secure contexts (HTTPS or
      // localhost) — this is the most likely reason it'd fail when
      // accessing the app over a plain http://<lan-ip> address.
      alert("Couldn't copy to the clipboard — this usually only works when the app is open at localhost on the host computer, not over the network address.");
    }
  }, 'image/png');
}

async function deleteDrawing(id) {
  if (!confirm('Delete this drawing?')) return;
  await fetch(`/api/drawings/${id}`, { method: 'DELETE' });
  state.drawings.items = state.drawings.items.filter(d => d.id !== id);
  if (state.drawings.activeId === id) {
    state.drawings.activeId = state.drawings.items[0]?.id || null;
    state.drawings.undoStack = [];
    state.drawings.dirty = false;
  }
  setToolHeader('Draw', `${state.drawings.items.length} drawings`, null, null);
  renderDraw();
}

// ---------- Messages ----------

let messagingViewTimer = null;

async function loadMessagesView() {
  setToolHeader('Messages', 'Chat with other installs on your network', null, null);
  await refreshIdentity();
  await pollMessagingOnce();
  renderMessages();
  startMessagingPolling();
}

async function refreshIdentity() {
  state.messaging.identity = await fetch('/api/messaging/identity').then(r => r.json());
}

async function pollMessagingOnce() {
  const [peers, conversations] = await Promise.all([
    fetch('/api/messaging/peers').then(r => r.json()),
    fetch('/api/messaging/conversations').then(r => r.json())
  ]);
  state.messaging.peers = peers;
  state.messaging.conversations = conversations;
  state.messaging.unread = conversations.reduce((sum, c) => sum + (c.unread || 0), 0);

  if (state.messaging.activePeerId) {
    state.messaging.messages = await fetch(`/api/messaging/conversations/${state.messaging.activePeerId}`).then(r => r.json());
  }
}

function startMessagingPolling() {
  clearInterval(messagingViewTimer);
  messagingViewTimer = setInterval(async () => {
    await pollMessagingOnce();
    if (state.view === 'messages') renderMessages();
  }, 3000);
}

function stopMessagingPolling() {
  clearInterval(messagingViewTimer);
  messagingViewTimer = null;
}

// Lightweight background poll so the unread badge on the "Messages" tab
// stays current even while you're looking at something else.
async function refreshUnreadBadge() {
  try {
    const conversations = await fetch('/api/messaging/conversations').then(r => r.json());
    state.messaging.unread = conversations.reduce((sum, c) => sum + (c.unread || 0), 0);
    if (state.view !== 'messages') renderToolNav();
  } catch { /* server not ready yet, or briefly offline — just skip this tick */ }
}
setInterval(refreshUnreadBadge, 8000);

// ---------- Visitors ----------
// Every device that's loaded the main page gets logged server-side (see
// server.js) — this tab just displays that list, with a way to clear it.
// Deliberately separate from Messages: this tracks anyone who's opened the
// page in a browser, not just other computers running their own Shelf.

async function loadVisitorsView() {
  setToolHeader('Visitors', 'Devices that have loaded this Shelf', 'Clear all', clearAllVisitors);
  await renderVisitorsView();
}

async function renderVisitorsView() {
  const content = el('#content');
  let visitors = [];
  try {
    visitors = await fetch('/api/visitors').then(r => r.json());
  } catch {
    content.innerHTML = `<div class="empty-state">Couldn't load visitor history.</div>`;
    return;
  }

  if (!visitors.length) {
    content.innerHTML = `<div class="empty-state">No visitors yet — this fills in once someone opens this Shelf from another device. (Visiting from this same computer at localhost doesn't count.)</div>`;
    return;
  }

  const now = Date.now();
  content.innerHTML = `
    <div class="visitors-list">
      ${visitors.map(v => {
        const recent = now - v.lastSeenAt < 5 * 60 * 1000; // seen within the last 5 minutes
        const name = v.hostname || v.ip;
        return `
          <div class="visitor-row">
            <div class="status-dot ${recent ? '' : 'idle'}"></div>
            <div class="visitor-info">
              <div class="visitor-name">${escapeHtml(name)}</div>
              <div class="visitor-meta">${v.hostname ? escapeHtml(v.ip) + ' &middot; ' : ''}first seen ${new Date(v.firstSeenAt).toLocaleDateString()} &middot; last seen ${new Date(v.lastSeenAt).toLocaleString()}</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function clearAllVisitors() {
  if (!confirm("Clear all visitor history? This can't be undone.")) return;
  await fetch('/api/visitors', { method: 'DELETE' });
  renderVisitorsView();
}

function renderMessages() {
  const content = el('#content');
  const m = state.messaging;
  const convPeerIds = new Set(m.conversations.map(c => c.id));
  const onlineOnly = m.peers.filter(p => !convPeerIds.has(p.id));

  // The 3-second background poll calls this same render function, which
  // rebuilds the whole panel's markup -- including the message box you
  // might be mid-sentence in. Save whatever's focused (and its cursor
  // position) beforehand so we can put it right back after, instead of
  // silently wiping out what you were typing.
  const focused = document.activeElement;
  const preserve = (focused && content.contains(focused) && (focused.id === 'messageInput' || focused.id === 'myNameInput'))
    ? { id: focused.id, value: focused.value, selectionStart: focused.selectionStart, selectionEnd: focused.selectionEnd }
    : null;

  content.innerHTML = `
    <div class="identity-bar">
      <label class="toggle-switch">
        <input type="checkbox" id="onlineToggle" ${m.identity.status !== 'offline' ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
      <span style="font-size:13px; min-width:88px;">${m.identity.status !== 'offline' ? 'Messaging on' : 'Messaging off'}</span>
      <input type="text" id="myNameInput" value="${escapeHtml(m.identity.name || '')}" placeholder="Your name">
      <select id="myStatusSelect" ${m.identity.status === 'offline' ? 'disabled' : ''}>
        ${Object.entries(STATUS_LABELS).filter(([val]) => val !== 'offline').map(([val, label]) => `<option value="${val}" ${m.identity.status === val ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <span style="color:var(--text-muted); font-size:12.5px;">This is how others on your network see you.</span>
    </div>
    <div class="split-pane">
      <div class="split-list">
        ${onlineOnly.length ? `<div class="list-section-label">Online now</div>` : ''}
        ${onlineOnly.map(p => `
          <div class="peer-row" data-id="${p.id}" data-name="${escapeHtml(p.name)}" ${p.ip ? `title="${escapeHtml(p.ip)}"` : ''}>
            <span class="status-dot-inline status-${p.status}"></span>
            <span class="peer-name">${escapeHtml(p.name)}</span>
          </div>
        `).join('')}
        ${m.conversations.length ? `<div class="list-section-label">Conversations</div>` : ''}
        ${m.conversations.map(c => `
          <div class="conv-row ${c.id === m.activePeerId ? 'active' : ''}" data-id="${c.id}" data-name="${escapeHtml(c.name)}" ${c.online && c.ip ? `title="${escapeHtml(c.ip)}"` : ''}>
            <span class="status-dot-inline ${c.online ? 'status-online' : 'status-offline'}"></span>
            <div class="conv-name-wrap">
              <span class="conv-name">${escapeHtml(c.name)}</span>
              <span class="conv-preview">${escapeHtml(c.lastMessage || '')}</span>
            </div>
            ${c.unread ? `<span class="unread-badge">${c.unread}</span>` : ''}
          </div>
        `).join('') || (onlineOnly.length ? '' : '<p style="color:var(--text-muted);font-size:13px;padding:8px 12px;">No one else found on your network yet.</p>')}
      </div>
      <div class="thread-wrap">
        ${m.activePeerId ? `
          <div class="thread-messages" id="threadMessages">
            ${m.messages.map(msg => `
              <div class="msg-bubble ${msg.direction}">
                ${msg.image ? `<img src="${msg.image}" class="msg-image" alt="Shared image">` : ''}
                ${msg.text ? escapeHtml(msg.text) : ''}
                <div class="msg-time">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            `).join('') || '<p style="color:var(--text-muted);font-size:13px;">Say hello&hellip;</p>'}
          </div>
          <div class="thread-input-row">
            <input type="text" id="messageInput" placeholder="Message ${escapeHtml(m.activePeerName)}&hellip;">
            <button id="sendMessageBtn">Send</button>
          </div>
        ` : `<div class="empty-state">Pick someone from the list to start chatting.</div>`}
      </div>
    </div>
  `;

  content.querySelectorAll('.peer-row').forEach(row => {
    row.addEventListener('click', () => openConversation(row.dataset.id, row.dataset.name));
  });
  content.querySelectorAll('.conv-row').forEach(row => {
    row.addEventListener('click', () => openConversation(row.dataset.id, row.dataset.name));
  });

  el('#myNameInput').addEventListener('change', (e) => updateIdentity({ name: e.target.value }));
  el('#myStatusSelect').addEventListener('change', (e) => updateIdentity({ status: e.target.value }));
  el('#onlineToggle').addEventListener('change', async (e) => {
    await updateIdentity({ status: e.target.checked ? 'online' : 'offline' });
    renderMessages();
  });

  if (m.activePeerId) {
    const input = el('#messageInput');
    const sendBtn = el('#sendMessageBtn');
    const doSend = () => sendMessage(input.value);
    sendBtn.addEventListener('click', doSend);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); });

    const box = el('#threadMessages');
    if (box) box.scrollTop = box.scrollHeight;
  }

  if (preserve) {
    const toRestore = el(`#${preserve.id}`);
    if (toRestore) {
      toRestore.value = preserve.value;
      toRestore.focus();
      try { toRestore.setSelectionRange(preserve.selectionStart, preserve.selectionEnd); } catch { /* not all input types support this */ }
    }
  }
}

async function updateIdentity(patch) {
  state.messaging.identity = await fetch('/api/messaging/identity', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  }).then(r => r.json());
}

async function openConversation(peerId, name) {
  state.messaging.activePeerId = peerId;
  state.messaging.activePeerName = name;
  state.messaging.messages = await fetch(`/api/messaging/conversations/${peerId}`).then(r => r.json());
  await pollMessagingOnce(); // refreshes the conversation list so this thread's unread badge clears
  renderMessages();
}

async function sendMessage(text, image) {
  text = (text || '').trim();
  if ((!text && !image) || !state.messaging.activePeerId) return;
  const input = el('#messageInput');
  if (input && !image) input.value = '';
  try {
    const res = await fetch('/api/messaging/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toId: state.messaging.activePeerId, text, image: image || null })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not send message.');
    state.messaging.messages.push(data);
    renderMessages();
  } catch (err) {
    alert(err.message);
  }
}

// Paste an image while a conversation is open and it gets sent as an image
// message, the same way any chat app handles pasting a screenshot.
document.addEventListener('paste', async (e) => {
  if (state.view !== 'messages' || !state.messaging.activePeerId) return;
  const input = document.getElementById('messageInput');
  if (!input || document.activeElement !== input) return;
  const file = extractImageFromClipboardEvent(e);
  if (!file) return;
  e.preventDefault();
  try {
    const dataUrl = await resizeImageFile(file, 1000);
    await sendMessage('', dataUrl);
  } catch (err) {
    alert(err.message);
  }
});

// Pastes an image straight onto the Draw canvas — scaled down to fit if
// it's larger than the canvas (never scaled up), and centered either way.
// Counts as a normal drawing action for undo/autosave purposes, same as
// a pen stroke or a shape.
document.addEventListener('paste', (e) => {
  if (state.view !== 'draw') return;
  const canvas = el('#drawCanvas');
  if (!canvas || !drawCtx) return;
  const file = extractImageFromClipboardEvent(e);
  if (!file) return; // not an image — nothing for the canvas to do with it
  e.preventDefault();

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, canvas.width / img.width, canvas.height / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (canvas.width - w) / 2;
      const y = (canvas.height - h) / 2;
      drawCtx.drawImage(img, x, y, w, h);
      pushUndoSnapshot();
      state.drawings.dirty = true;
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

// ---------- Sheets (mini spreadsheet) ----------
//
// Formulas are intentionally simple: =SUM(range), =AVERAGE(range), and
// +-chains of cell refs/numbers like =A1+A2+3. Refs are resolved against the
// *raw* value of the target cell (not its computed result), so formulas
// can total up numbers but can't chain off other formulas — this keeps
// things predictable and rules out circular-reference bugs entirely.

function colLetter(i) { return String.fromCharCode(65 + i); }
function parseCellRef(ref) {
  const m = /^([A-Za-z])(\d+)$/.exec(ref.trim());
  if (!m) return null;
  const col = m[1].toUpperCase().charCodeAt(0) - 65;
  const row = Number(m[2]) - 1;
  if (row < 0) return null;
  return { row, col };
}

function evaluateCell(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('=')) return raw || '';
  const expr = raw.slice(1).trim();
  const data = state.sheets.items.find(s => s.id === state.sheets.activeId)?.data || {};

  const rangeMatch = /^(SUM|AVERAGE)\(([A-Za-z]\d+):([A-Za-z]\d+)\)$/i.exec(expr);
  if (rangeMatch) {
    const fn = rangeMatch[1].toUpperCase();
    const start = parseCellRef(rangeMatch[2]);
    const end = parseCellRef(rangeMatch[3]);
    if (!start || !end) return '#REF!';
    const values = [];
    for (let r = Math.min(start.row, end.row); r <= Math.max(start.row, end.row); r++) {
      for (let c = Math.min(start.col, end.col); c <= Math.max(start.col, end.col); c++) {
        const v = parseFloat(data[`${r}-${c}`]);
        if (!isNaN(v)) values.push(v);
      }
    }
    const sum = values.reduce((a, b) => a + b, 0);
    return fn === 'SUM' ? String(sum) : (values.length ? String(sum / values.length) : '0');
  }

  const terms = expr.split('+').map(t => t.trim());
  let total = 0;
  for (const t of terms) {
    const ref = parseCellRef(t);
    if (ref) {
      const v = parseFloat(data[`${ref.row}-${ref.col}`]);
      if (isNaN(v)) return '#ERR';
      total += v;
    } else {
      const v = parseFloat(t);
      if (isNaN(v)) return '#ERR';
      total += v;
    }
  }
  return String(total);
}

// Drag-and-drop CSV/XLS/XLSX import — registered once (not inside
// renderSheets) so re-rendering the sheet list never stacks up duplicate
// listeners. Guarded to the Sheets tab, and skips drops that land on the
// sidebar (those are handled by the sidebar's own upload/move logic).
document.addEventListener('dragover', (e) => {
  if (state.view !== 'sheets' || e.target.closest('.sidebar')) return;
  e.preventDefault();
  const content = el('#content');
  if (content) content.classList.add('sheet-drag-over');
});
document.addEventListener('dragleave', (e) => {
  if (state.view !== 'sheets') return;
  const content = el('#content');
  if (content && !content.contains(e.relatedTarget)) content.classList.remove('sheet-drag-over');
});
document.addEventListener('drop', async (e) => {
  if (state.view !== 'sheets' || e.target.closest('.sidebar')) return;
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || files.length === 0) return; // not a file drop — let normal behavior proceed
  e.preventDefault();
  const content = el('#content');
  if (content) content.classList.remove('sheet-drag-over');
  await importSheetFiles(files);
});

async function importSheetFiles(fileList) {
  let lastImported = null;
  for (const file of fileList) {
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/sheets/import', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not import that file.');
      lastImported = data;
    } catch (err) {
      alert(err.message);
    }
  }
  if (lastImported) {
    state.sheets.items = await fetch('/api/sheets').then(r => r.json());
    state.sheets.activeId = lastImported.id;
    setToolHeader('Sheets', `${state.sheets.items.length} sheet${state.sheets.items.length === 1 ? '' : 's'}`, '+ New sheet', createSheet);
    renderSheets();
  }
}

async function loadSheetsView() {
  state.sheets.items = await fetch('/api/sheets').then(r => r.json());
  if (!state.sheets.activeId && state.sheets.items.length) state.sheets.activeId = state.sheets.items[0].id;
  setToolHeader('Sheets', `${state.sheets.items.length} sheet${state.sheets.items.length === 1 ? '' : 's'}`, '+ New sheet', createSheet);
  renderSheets();
}

function renderSheets() {
  const content = el('#content');
  const active = state.sheets.items.find(s => s.id === state.sheets.activeId);

  content.innerHTML = `
    <div class="split-pane">
      <div class="split-list">
        <button class="split-new-btn" id="newSheetBtn">+ New sheet</button>
        <p class="sheet-import-hint">Drop a .csv, .xls, or .xlsx file here to import it</p>
        ${state.sheets.items.map(s => `
          <div class="split-list-item ${s.id === state.sheets.activeId ? 'active' : ''}" data-id="${s.id}">
            <div class="item-title">${escapeHtml(s.title || 'Untitled')}</div>
            <div class="item-sub">${(s.cols || SHEET_DEFAULT_COLS)}&times;${(s.rows || SHEET_DEFAULT_ROWS)}</div>
          </div>
        `).join('') || '<p style="color:var(--text-muted);font-size:13px;">No sheets yet.</p>'}
      </div>
      <div class="split-editor">
        ${active ? `
          <div class="editor-topbar">
            <input type="text" class="editor-title-input" id="sheetTitleInput" value="${escapeHtml(active.title || '')}" placeholder="Sheet title">
            <button class="tool-btn" id="addSheetRowBtn">+ Row</button>
            <button class="tool-btn" id="addSheetColBtn">+ Column</button>
            <button class="delete-btn" id="deleteSheetBtn">Remove</button>
          </div>
          <p style="color:var(--text-muted); font-size:12px; margin:0;">
            Formulas: <code>=SUM(A1:A5)</code>, <code>=AVERAGE(A1:B4)</code>, or <code>=A1+A2+3</code>.
          </p>
          <div class="sheet-grid-wrap" id="sheetGridWrap"></div>
        ` : `<div class="empty-state">No sheet selected. Create one to get started.</div>`}
      </div>
    </div>
  `;

  content.querySelectorAll('.split-list-item').forEach(item => {
    item.addEventListener('click', () => { state.sheets.activeId = item.dataset.id; renderSheets(); });
  });
  el('#newSheetBtn').addEventListener('click', createSheet);

  if (!active) return;

  el('#sheetTitleInput').addEventListener('change', (e) => saveSheetMeta(active, { title: e.target.value }));
  el('#deleteSheetBtn').addEventListener('click', () => deleteSheet(active.id));
  el('#addSheetRowBtn').addEventListener('click', () => {
    if ((active.rows || SHEET_DEFAULT_ROWS) >= SHEET_MAX_ROWS) return;
    saveSheetMeta(active, { rows: (active.rows || SHEET_DEFAULT_ROWS) + 1 }).then(renderSheets);
  });
  el('#addSheetColBtn').addEventListener('click', () => {
    if ((active.cols || SHEET_DEFAULT_COLS) >= SHEET_MAX_COLS) return;
    saveSheetMeta(active, { cols: (active.cols || SHEET_DEFAULT_COLS) + 1 }).then(renderSheets);
  });

  renderSheetGrid(active);
}

function renderSheetGrid(active) {
  const cols = active.cols || SHEET_DEFAULT_COLS;
  const rows = active.rows || SHEET_DEFAULT_ROWS;
  const data = active.data || {};

  let html = '<table class="sheet-grid"><thead><tr><th></th>';
  for (let c = 0; c < cols; c++) html += `<th>${colLetter(c)}</th>`;
  html += '</tr></thead><tbody>';
  for (let r = 0; r < rows; r++) {
    html += `<tr><th>${r + 1}</th>`;
    for (let c = 0; c < cols; c++) {
      const raw = data[`${r}-${c}`] || '';
      html += `<td><input type="text" data-r="${r}" data-c="${c}" value="${escapeHtml(evaluateCell(raw))}"></td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';

  const wrap = el('#sheetGridWrap');
  wrap.innerHTML = html;

  let saveTimer;
  wrap.querySelectorAll('input').forEach(input => {
    const r = input.dataset.r, c = input.dataset.c;
    input.addEventListener('focus', () => {
      const raw = (active.data || {})[`${r}-${c}`] || '';
      input.value = raw; // show the formula/raw text while editing
    });
    input.addEventListener('blur', () => {
      active.data = active.data || {};
      const val = input.value;
      if (val) active.data[`${r}-${c}`] = val; else delete active.data[`${r}-${c}`];
      input.value = evaluateCell(val);
      refreshOtherSheetCells(wrap, input);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveSheetMeta(active, { data: active.data }), 500);
    });
  });
}

// After any cell changes, every OTHER cell's displayed value needs
// recalculating too, since a formula elsewhere in the grid might depend on
// it (e.g. a SUM that was typed before the numbers it totals were filled
// in — a completely normal order of operations). Skips whichever input is
// currently being edited so we don't overwrite what the person is typing.
function refreshOtherSheetCells(wrap, skipInput) {
  wrap.querySelectorAll('input').forEach(input => {
    if (input === skipInput || input === document.activeElement) return;
    const r = input.dataset.r, c = input.dataset.c;
    const raw = (state.sheets.items.find(s => s.id === state.sheets.activeId)?.data || {})[`${r}-${c}`] || '';
    input.value = evaluateCell(raw);
  });
}

async function createSheet() {
  const sheet = await fetch('/api/sheets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Untitled sheet', cols: SHEET_DEFAULT_COLS, rows: SHEET_DEFAULT_ROWS, data: {} })
  }).then(r => r.json());
  state.sheets.items.unshift(sheet);
  state.sheets.activeId = sheet.id;
  setToolHeader('Sheets', `${state.sheets.items.length} sheets`, '+ New sheet', createSheet);
  renderSheets();
}

async function saveSheetMeta(item, patch) {
  Object.assign(item, patch);
  const updated = await fetch(`/api/sheets/${item.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: item.title, cols: item.cols, rows: item.rows, data: item.data })
  }).then(r => r.json());
  const idx = state.sheets.items.findIndex(s => s.id === item.id);
  if (idx !== -1) state.sheets.items[idx] = updated;
  return updated;
}

async function deleteSheet(id) {
  if (!confirm('Delete this sheet?')) return;
  await fetch(`/api/sheets/${id}`, { method: 'DELETE' });
  state.sheets.items = state.sheets.items.filter(s => s.id !== id);
  if (state.sheets.activeId === id) state.sheets.activeId = state.sheets.items[0]?.id || null;
  setToolHeader('Sheets', `${state.sheets.items.length} sheets`, '+ New sheet', createSheet);
  renderSheets();
}

// ---------- AI ----------
// A small local chat model, run entirely on this machine via node-llama-cpp
// (server.js does the actual model loading/inference; this is just the
// chat UI + the on/off toggle + the one-time model download). The chat
// history here is deliberately just an in-memory client-side list for
// display — the real conversation state lives in the LlamaChatSession on
// the server, so "New chat" resets both sides together.

let aiChatHistory = []; // [{ role: 'user' | 'assistant', text }]
let aiStatusPollTimer = null;

async function loadAiView() {
  setToolHeader('AI', 'A small, fully local chat assistant — nothing here ever leaves this machine', null, null);
  await renderAiView();
}

async function fetchAiStatus() {
  try {
    return await fetch('/api/ai/status').then(r => r.json());
  } catch {
    return null;
  }
}

async function renderAiView() {
  const content = el('#content');
  const status = await fetchAiStatus();
  if (!status) {
    content.innerHTML = `<div class="empty-state">Couldn't reach the AI service.</div>`;
    return;
  }

  const toggleRow = `
    <div class="power-toggle ai-toggle-row">
      <label class="toggle-switch">
        <input type="checkbox" id="aiToggle" ${status.enabled ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
      <span>${status.enabled ? 'AI is on' : 'AI is off'}</span>
    </div>
  `;

  const activeModel = status.models.find(m => m.id === status.modelId) || { label: status.modelLabel };
  const modelBar = status.enabled && status.downloaded ? `
    <div class="ai-model-bar">
      <span class="ai-model-bar-label">Model</span>
      <span class="ai-model-bar-name">${escapeHtml(activeModel.label)}</span>
      ${activeModel.recommended ? '<span class="ai-badge ai-badge-good">Recommended for this machine</span>' : ''}
      ${status.downloaded ? `<button class="link-btn" id="aiChangeModelBtn">${aiPickerOpen ? 'Hide models' : 'Change'}</button>` : ''}
    </div>` : '';

  let body;
  if (!status.enabled) {
    body = `
      <div class="empty-state">
        Turn AI on to chat with a language model that runs entirely on this machine &mdash; you can choose
        how big a model to use once it's on. No account, no API key, and no internet access needed once the model file is downloaded. Turning it back off
        frees the memory it was using; the downloaded model file stays put, so switching it on again later is instant.
      </div>
    `;
  } else if (status.error) {
    // Still offer the picker, so a model that won't load (e.g. too big for
    // this machine) can be swapped for another without getting stuck.
    body = `<p class="ai-error">Something went wrong: ${escapeHtml(status.error)}</p>${aiModelPickerHtml(status)}`;
  } else if (status.downloading && !status.ready) {
    const dl = status.models.find(m => m.id === status.downloadingModelId);
    body = `<div class="empty-state">Downloading ${escapeHtml(dl ? dl.label : status.modelLabel)}&hellip; this only happens once per model.</div>`;
  } else if (!status.downloaded) {
    body = `
      <p class="ai-setup-note">${status.models.some(m => m.downloaded) ? 'Pick a model to use, or download another.' : 'Pick a model to download.'} Bigger models give better answers but run slower and need more memory.
      The first download also sets up a small local AI engine, and this machine needs its own internet connection for it &mdash;
      after that, everything runs offline.</p>
      ${aiModelPickerHtml(status)}
    `;
  } else if (aiPickerOpen) {
    body = aiModelPickerHtml(status);
  } else if (status.loading || !status.ready) {
    body = `<div class="empty-state">Loading the model into memory&hellip;</div>`;
  } else {
    const dl = status.downloading && status.models.find(m => m.id === status.downloadingModelId);
    body = `
      ${dl ? `<p class="ai-setup-note">Downloading ${escapeHtml(dl.label)} in the background &mdash; you can keep chatting with ${escapeHtml(activeModel.label)} meanwhile.</p>` : ''}
      <div class="ai-chat">
        <div class="ai-chat-log" id="aiChatLog"></div>
        <div class="ai-chat-input-row">
          <input type="text" id="aiChatInput" placeholder="Ask me anything…" autocomplete="off">
          <button class="tool-action-btn" id="aiSendBtn">Send</button>
          <button class="tool-action-btn tool-action-btn-secondary" id="aiNewChatBtn" title="Start a new conversation">New chat</button>
        </div>
      </div>
    `;
  }

  content.innerHTML = `<div class="ai-view">${toggleRow}${modelBar}${body}</div>`;

  el('#aiToggle').addEventListener('change', onAiToggleChange);
  const changeBtn = el('#aiChangeModelBtn');
  if (changeBtn) changeBtn.addEventListener('click', () => { aiPickerOpen = !aiPickerOpen; renderAiView(); });
  wireAiModelPicker(status);

  if (el('#aiChatInput')) {
    renderAiChatLog();
    el('#aiSendBtn').addEventListener('click', sendAiChatMessage);
    el('#aiNewChatBtn').addEventListener('click', startAiNewChat);
    el('#aiChatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendAiChatMessage();
    });
  }

  // Downloading and loading are both states that resolve on their own —
  // poll quietly until something changes rather than making the person
  // manually refresh the tab to see progress.
  clearTimeout(aiStatusPollTimer);
  if (status.enabled && !status.downloading && status.downloaded && !status.ready && !status.error && !aiPickerOpen) {
    aiStatusPollTimer = setTimeout(() => { if (state.view === 'ai') renderAiView(); }, 1000);
  }
}

async function onAiToggleChange(e) {
  const enabled = e.target.checked;
  e.target.disabled = true;
  try {
    await fetch('/api/ai/toggle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
  } finally {
    if (!enabled) aiChatHistory = [];
    renderAiView();
  }
}

// ---------- Model picker ----------
// Every model with its download size, how much memory it needs, and how
// well it suits this particular machine (worked out on the host from its
// real memory, and whether it's a Raspberry Pi).
let aiPickerOpen = false;

function formatGB(bytes) {
  const gb = bytes / (1024 ** 3);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / (1024 ** 2))} MB`;
}

function aiModelPickerHtml(status) {
  const m = status.machine;
  const fitBadge = (model) => ({
    good: '',
    tight: '<span class="ai-badge ai-badge-warn">Tight fit &mdash; will be slow</span>',
    'too-big': '<span class="ai-badge ai-badge-bad">Too big for this machine</span>',
    unknown: '',
  })[model.fit];
  const rows = status.models.map(model => {
    const inUse = model.id === status.modelId && status.downloaded;
    let action;
    if (status.downloadingModelId === model.id) action = '<span class="ai-in-use">Downloading&hellip;</span>';
    else if (inUse) action = '<span class="ai-in-use">In use</span>';
    else if (model.downloaded) action = `<button class="tool-action-btn" data-ai-use="${escapeHtml(model.id)}">Use</button>`;
    else if (model.fit === 'too-big') action = '<button class="tool-action-btn" disabled>Download</button>';
    else action = `<button class="tool-action-btn" data-ai-download="${escapeHtml(model.id)}">Download${model.recommended && !status.downloaded ? ' &amp; use' : ''}</button>`;
    const del = model.downloaded && !inUse
      ? `<button class="link-btn ai-delete" data-ai-delete="${escapeHtml(model.id)}">Delete file</button>` : '';
    const needs = model.ramGB ? ` &middot; needs about ${model.ramGB} GB of memory` : '';
    return `
      <div class="ai-model-row ${model.recommended ? 'recommended' : ''} ${model.fit === 'too-big' ? 'too-big' : ''}">
        <div class="ai-model-info">
          <div class="ai-model-name">
            ${escapeHtml(model.label)}
            ${model.recommended ? '<span class="ai-badge ai-badge-good">Recommended</span>' : ''}
            ${model.downloaded ? '<span class="ai-badge">Downloaded</span>' : ''}
            ${fitBadge(model)}
          </div>
          <div class="ai-model-blurb">${escapeHtml(model.blurb)}</div>
          <div class="ai-model-meta">${formatGB(model.size)} ${model.downloaded ? 'on disk' : 'download'}${needs}</div>
        </div>
        <div class="ai-model-actions">${action}${del}</div>
      </div>`;
  }).join('');
  return `
    <div class="ai-model-picker">
      <div class="ai-machine">This machine: <strong>${escapeHtml(m.name)}</strong> &middot; ${m.ramGB} GB of memory</div>
      ${rows}
    </div>`;
}

function wireAiModelPicker(status) {
  document.querySelectorAll('[data-ai-use]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const res = await fetch('/api/ai/select', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: btn.dataset.aiUse }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not switch models.');
      aiChatHistory = []; // a different model starts a fresh conversation
      aiPickerOpen = false;
    } catch (err) { alert(err.message); }
    renderAiView();
  }));
  document.querySelectorAll('[data-ai-download]').forEach(btn => btn.addEventListener('click', () => {
    const model = status.models.find(m => m.id === btn.dataset.aiDownload);
    if (model.fit === 'tight' && !confirm(`${model.label} needs about ${model.ramGB} GB of memory, which is close to everything this machine has. It will run, but slowly, and may slow down the rest of The Shelf while it answers. Download it anyway?`)) return;
    aiPickerOpen = false;
    startAiDownload(model.id, btn);
  }));
  document.querySelectorAll('[data-ai-delete]').forEach(btn => btn.addEventListener('click', async () => {
    const model = status.models.find(m => m.id === btn.dataset.aiDelete);
    if (!confirm(`Delete the ${model.label} model file (${formatGB(model.size)})? You can download it again later.`)) return;
    try {
      const res = await fetch(`/api/ai/models/${encodeURIComponent(model.id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not delete that model.');
    } catch (err) { alert(err.message); }
    renderAiView();
  }));
}

async function startAiDownload(modelId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Downloading…'; }
  showBulkProgress('Starting download…', 0);
  let finished = false;
  // Re-render right away so the tab shows the "downloading in the
  // background" note (and keeps the chat usable) while this runs.
  setTimeout(() => { if (state.view === 'ai') renderAiView(); }, 300);
  try {
    const res = await fetch('/api/ai/download', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Could not start the download.');
    }
    await readNdjson(res, (evt) => {
      if (evt.type === 'installing') {
        showBulkProgress(evt.message || 'Setting up the AI engine…', 0);
      } else if (evt.type === 'progress') {
        const pct = evt.totalSize ? Math.round((evt.downloadedSize / evt.totalSize) * 100) : 0;
        const mb = (n) => (n / (1024 * 1024)).toFixed(0);
        showBulkProgress(`${mb(evt.downloadedSize)} MB / ${mb(evt.totalSize)} MB`, pct);
      } else if (evt.type === 'done') {
        finished = true;
      } else if (evt.type === 'error') {
        throw new Error(evt.message);
      }
    });
  } catch (err) {
    alert(err.message);
  } finally {
    hideBulkProgress();
  }
  if (finished) await offerToLoadAiModel(modelId);
  renderAiView();
}

// After a download: ask before loading it, since loading takes memory
// (and a little while on a Pi) and replaces whatever model is in use.
async function offerToLoadAiModel(modelId) {
  const status = await fetchAiStatus();
  if (!status) return;
  const model = status.models.find(m => m.id === modelId);
  if (!model) return;
  const current = status.models.find(m => m.id === status.modelId);
  const replacing = status.ready && current && current.id !== model.id;
  const question = `${model.label} has finished downloading. Load it now?` + (replacing
    ? `\n\nThis replaces ${current.label} and starts a new chat. You can switch back any time with "Change".`
    : '') + `\n\nChoose Cancel to keep it for later \u2014 it'll be in the model list with a "Use" button.`;
  if (!confirm(question)) return;
  try {
    const res = await fetch('/api/ai/select', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load that model.');
    aiChatHistory = [];
  } catch (err) {
    alert(err.message);
  }
}

// The small line under each reply: how many tokens, how fast, and how long
// before it started answering. While a reply is still being written it
// shows a live estimate; once it's finished, the exact figures from the host.
function aiStatsText(m) {
  const fmt = (n, d = 1) => Number(n).toFixed(d);
  if (m.stats) {
    const st = m.stats;
    const parts = [`${st.tokens} token${st.tokens === 1 ? '' : 's'}`];
    if (st.tokensPerSec) parts.push(`<strong>${fmt(st.tokensPerSec)} tokens/sec</strong>`);
    if (st.firstTokenSecs != null) parts.push(`first word after ${fmt(st.firstTokenSecs)} s`);
    return parts.join(' &middot; ');
  }
  const live = m.live;
  if (!live.firstAt) return 'Thinking&hellip;';
  const secs = (performance.now() - live.firstAt) / 1000;
  const rate = live.tokens > 1 && secs > 0.3 ? `${fmt((live.tokens - 1) / secs)} tokens/sec` : 'writing';
  return `${live.tokens} tokens &middot; ${rate}&hellip;`;
}

function renderAiChatLog() {
  const log = el('#aiChatLog');
  if (!log) return;
  log.innerHTML = aiChatHistory.length
    ? aiChatHistory.map(m => `
        <div class="ai-message ${m.role}">
          <div class="ai-message-bubble">${escapeHtml(m.text)}</div>
          ${m.role === 'assistant' && (m.stats || m.live) ? `<div class="ai-message-stats">${aiStatsText(m)}</div>` : ''}
        </div>
      `).join('')
    : `<div class="ai-chat-hint">Ask about anything — or ask what's on your shelves.</div>`;
  log.scrollTop = log.scrollHeight;
}

async function sendAiChatMessage() {
  const input = el('#aiChatInput');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  const sendBtn = el('#aiSendBtn');
  sendBtn.disabled = true;
  input.disabled = true;

  aiChatHistory.push({ role: 'user', text: message });
  const reply = { role: 'assistant', text: '', live: { tokens: 0, firstAt: null } };
  aiChatHistory.push(reply);
  renderAiChatLog();

  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'The AI could not respond.');
    }
    await readNdjson(res, (evt) => {
      if (evt.type === 'chunk') {
        reply.text += evt.text;
        if (!reply.live.firstAt) reply.live.firstAt = performance.now();
        if (typeof evt.tokens === 'number') reply.live.tokens = evt.tokens;
        renderAiChatLog();
      } else if (evt.type === 'done') {
        if (evt.stats) reply.stats = evt.stats;
        delete reply.live;
        renderAiChatLog();
      } else if (evt.type === 'error') {
        throw new Error(evt.message);
      }
    });
  } catch (err) {
    reply.text = `Something went wrong: ${err.message}`;
    delete reply.live;
    renderAiChatLog();
  } finally {
    delete reply.live; // never leave a "Thinking…" line behind
    sendBtn.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

async function startAiNewChat() {
  aiChatHistory = [];
  renderAiChatLog();
  try {
    await fetch('/api/ai/reset', { method: 'POST' });
  } catch { /* best effort — a stale system-side session isn't worth surfacing an error over */ }
}

// ---------- Big Transfer (large file uploads, 15-25GB and up) ----------
//
// Files this large go over plain chunked POSTs instead of one giant
// multipart request (see the matching comment in server.js): a dropped
// connection only costs the current chunk, not the whole transfer, and
// picking the same file again later — even after closing the browser —
// picks up where it left off instead of starting over. That resume check
// is keyed off the file's own name/size/last-modified time, so "resuming"
// in practice just means dropping the same file back in; there's no way
// for a browser to keep a live handle to it across a real page reload.

const BIGFILE_CHUNK_SIZE = 16 * 1024 * 1024; // 16MB per request

// Tracks the one upload in flight, if any. Deliberately not tied to any
// DOM element — it's plain state, so switching to another tab and back
// (or even leaving the Big Transfer tab entirely) doesn't interrupt it;
// only closing the browser tab itself does.
let bigfileUpload = null; // { file, uploadId, name, size, uploadedBytes, status, error, paused }
let bigfileQueue = []; // additional dropped files, uploaded one at a time

function bigfileClientKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function humanFileSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

async function loadBigfilesView() {
  setToolHeader('Big Transfer', 'A spot for very large files (15-25GB and up) — disk images, backups, whole video projects — that anyone on your network can drop in or download', null, null);
  await renderBigfilesView();
}

async function renderBigfilesView() {
  const content = el('#content');
  let files = [];
  try {
    files = await fetch('/api/bigfiles').then(r => r.json());
  } catch {
    content.innerHTML = `<div class="empty-state">Couldn't reach the server.</div>`;
    return;
  }

  content.innerHTML = `
    <div class="dropzone" id="bigfileDropzone">
      <strong>Drop a file here, or click to choose one</strong>
      <div class="dropzone-sub">No size limit — built for files in the 15-25GB range. Uploads survive a dropped
      connection; if it's ever interrupted, drop the same file back in later to pick up where it left off.</div>
    </div>
    <input type="file" id="bigfileInput" hidden>
    <div id="bigfileUploadCard"></div>
    ${files.length ? `
      <div class="file-cards" id="bigfileCards">
        ${files.map(f => `
          <div class="file-card" data-name="${escapeHtml(f.name)}">
            <div class="file-icon" style="--cat-color: var(--coral)">${(f.name.split('.').pop() || '?').slice(0, 3).toUpperCase()}</div>
            <div class="file-name">${escapeHtml(f.name)}</div>
            <div class="file-meta">${escapeHtml(f.sizeLabel)} &middot; added ${new Date(f.modified).toLocaleDateString()}</div>
            <div class="card-actions">
              <a class="download-btn" href="${f.url}" download>Download</a>
              <button class="delete-btn" data-delete="${escapeHtml(f.name)}">Remove</button>
            </div>
          </div>
        `).join('')}
      </div>
    ` : `<div class="empty-state">Nothing here yet — drop a large file in above to make it available to everyone on your network.</div>`}
  `;

  const dropzone = el('#bigfileDropzone');
  const input = el('#bigfileInput');
  dropzone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files.length) queueBigfileUploads(Array.from(input.files));
    input.value = '';
  });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--accent)'; });
  dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = '';
    if (e.dataTransfer.files.length) queueBigfileUploads(Array.from(e.dataTransfer.files));
  });

  content.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.getAttribute('data-delete');
      if (!confirm(`Remove "${name}"? This can't be undone.`)) return;
      await fetch(`/api/bigfiles/file/${encodeURIComponent(name)}`, { method: 'DELETE' });
      renderBigfilesView();
    });
  });

  renderBigfileUploadCard(); // shows the in-progress upload, if any, even after switching tabs and back
}

function queueBigfileUploads(files) {
  bigfileQueue.push(...files);
  if (!bigfileUpload) startNextBigfileUpload();
}

async function startNextBigfileUpload() {
  const file = bigfileQueue.shift();
  if (!file) return;

  bigfileUpload = { file, uploadId: null, name: file.name, size: file.size, uploadedBytes: 0, status: 'starting', error: null, paused: false };
  renderBigfileUploadCard();

  try {
    const clientKey = bigfileClientKey(file);
    const res = await fetch('/api/bigfiles/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, size: file.size, clientKey }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not start the upload.');
    const data = await res.json();
    bigfileUpload.uploadId = data.uploadId;
    bigfileUpload.uploadedBytes = data.receivedBytes || 0;
    bigfileUpload.status = 'uploading';
    renderBigfileUploadCard();
    await uploadBigfileChunks();
  } catch (err) {
    bigfileUpload.status = 'error';
    bigfileUpload.error = err.message;
    renderBigfileUploadCard();
  }
}

async function uploadBigfileChunks() {
  const u = bigfileUpload;
  if (!u) return;

  while (u.uploadedBytes < u.size) {
    if (u.paused) return; // the loop is simply not restarted until resumeBigfileUpload calls back in

    const end = Math.min(u.uploadedBytes + BIGFILE_CHUNK_SIZE, u.size);
    const chunk = u.file.slice(u.uploadedBytes, end);
    try {
      const res = await fetch(`/api/bigfiles/${u.uploadId}/chunk?offset=${u.uploadedBytes}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk,
      });
      const data = await res.json();
      if (!res.ok) {
        // An offset mismatch means the server and client disagree about how
        // much has arrived (e.g. a retried request that actually landed) --
        // trust the server's number and keep going from there rather than
        // treating it as a hard failure.
        if (res.status === 409 && typeof data.receivedBytes === 'number') {
          u.uploadedBytes = data.receivedBytes;
          continue;
        }
        throw new Error(data.error || 'The upload was rejected.');
      }
      u.uploadedBytes = data.receivedBytes;
      renderBigfileUploadCard();
    } catch (err) {
      u.status = 'error';
      u.error = err.message || 'The connection dropped.';
      renderBigfileUploadCard();
      return;
    }
  }

  u.status = 'finishing';
  renderBigfileUploadCard();
  try {
    const res = await fetch(`/api/bigfiles/${u.uploadId}/complete`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not finish the upload.');
    u.status = 'done';
  } catch (err) {
    u.status = 'error';
    u.error = err.message;
    renderBigfileUploadCard();
    return;
  }

  bigfileUpload = null;
  hideBulkProgress();
  if (state.view === 'bigfiles') renderBigfilesView();
  startNextBigfileUpload();
}

function pauseBigfileUpload() {
  if (!bigfileUpload) return;
  bigfileUpload.paused = true;
  bigfileUpload.status = 'paused';
  renderBigfileUploadCard();
}

function resumeBigfileUpload() {
  if (!bigfileUpload) return;
  bigfileUpload.paused = false;
  bigfileUpload.status = 'uploading';
  renderBigfileUploadCard();
  uploadBigfileChunks();
}

async function cancelBigfileUpload() {
  if (!bigfileUpload) return;
  if (!confirm(`Cancel uploading "${bigfileUpload.name}"? What's uploaded so far will be deleted.`)) return;
  const id = bigfileUpload.uploadId;
  bigfileUpload = null;
  hideBulkProgress();
  if (id) { try { await fetch(`/api/bigfiles/${id}`, { method: 'DELETE' }); } catch { /* best effort */ } }
  if (state.view === 'bigfiles') renderBigfilesView();
  startNextBigfileUpload();
}

// Renders the current upload's progress in whichever spot fits: an inline
// card when the Big Transfer tab is actually open, and the shared bulk
// progress bar (visible from any tab) otherwise, so leaving the tab to do
// something else doesn't make it look like the transfer stopped.
function renderBigfileUploadCard() {
  const u = bigfileUpload;
  const card = document.getElementById('bigfileUploadCard');
  const onBigfilesTab = state.view === 'bigfiles' && card;

  if (!u) {
    if (onBigfilesTab) card.innerHTML = '';
    hideBulkProgress();
    return;
  }

  const pct = u.size ? Math.round((u.uploadedBytes / u.size) * 100) : 0;
  const label = u.status === 'error'
    ? `Couldn't upload "${u.name}": ${u.error}`
    : u.status === 'starting'
      ? `Starting "${u.name}"…`
      : u.status === 'finishing'
        ? `Finishing "${u.name}"…`
        : u.status === 'paused'
          ? `Paused — ${humanFileSize(u.uploadedBytes)} of ${humanFileSize(u.size)}`
          : `${humanFileSize(u.uploadedBytes)} of ${humanFileSize(u.size)} (${pct}%)`;

  if (onBigfilesTab) {
    hideBulkProgress(); // the inline card below covers it while this tab is open
    card.innerHTML = `
      <div class="bigfile-upload-card">
        <div class="bigfile-upload-label">${escapeHtml(label)}</div>
        <div class="bulk-progress-bar" style="margin: 8px 0;">
          <div class="bulk-progress-fill" style="width: ${pct}%"></div>
        </div>
        <div class="card-actions">
          ${u.status === 'error' ? `
            <button class="tool-action-btn" id="bigfileRetryBtn">Retry</button>
          ` : u.status === 'paused' ? `
            <button class="tool-action-btn" id="bigfileResumeBtn">Resume</button>
          ` : (u.status === 'uploading' ? `
            <button class="tool-action-btn tool-action-btn-secondary" id="bigfilePauseBtn">Pause</button>
          ` : '')}
          <button class="delete-btn" id="bigfileCancelBtn">Cancel</button>
        </div>
      </div>
    `;
    const retryBtn = document.getElementById('bigfileRetryBtn');
    if (retryBtn) retryBtn.addEventListener('click', () => { u.status = 'uploading'; u.error = null; renderBigfileUploadCard(); uploadBigfileChunks(); });
    const pauseBtn = document.getElementById('bigfilePauseBtn');
    if (pauseBtn) pauseBtn.addEventListener('click', pauseBigfileUpload);
    const resumeBtn = document.getElementById('bigfileResumeBtn');
    if (resumeBtn) resumeBtn.addEventListener('click', resumeBigfileUpload);
    const cancelBtn = document.getElementById('bigfileCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', cancelBigfileUpload);
  } else {
    showBulkProgress(`Big Transfer: ${label}`, pct);
  }
}

// ---------- Init ----------

async function initApp() {
  await loadAuthStatus();
  if (state.auth.secureMode && !state.auth.isLocal && !state.auth.loggedIn) {
    openLoginOverlay(true); // mandatory — nothing else to show until they log in
    return;
  }
  renderToolNav();
  loadCategories();
  loadFiles();
  loadNetworkInfo();
  loadPowerState();
  loadLocalhostOnlyState();
  loadOpenWriteAccessState();
  refreshUnreadBadge();
}
initApp();
