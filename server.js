const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dns = require('dns');
const os = require('os');
const crypto = require('crypto');
const dgram = require('dgram');
const net = require('net');
const { WebSocketServer } = require('ws');
const { execFile } = require('child_process');
const AdmZip = require('adm-zip');
const archiver = require('archiver');
const XLSX = require('xlsx');
const TagLib = require('node-taglib-sharp');

const app = express();
const PORT = process.env.PORT || 8080;

const SHARED_ROOT = path.join(__dirname, 'shared');
const CATEGORIES = ['Pictures', 'Music', 'Videos', 'Games', 'Programs', 'Books'];

// Where zipped HTML games get unzipped to, so they can be played in-browser.
// Lives inside shared/ but starts with a dot, so it's invisible to the
// category listing (which skips dotfiles) and to the /shared static route.
const EXTRACT_ROOT = path.join(SHARED_ROOT, '.extracted');
fs.mkdirSync(EXTRACT_ROOT, { recursive: true });

// Where the productivity tools (Notes, Draw, Docs, Slides, Home) keep their data.
const DATA_ROOT = path.join(__dirname, 'data');
const COLLECTIONS = ['notes', 'documents', 'presentations', 'sheets'];
for (const kind of COLLECTIONS) {
  fs.mkdirSync(path.join(DATA_ROOT, kind), { recursive: true });
}
const DRAWINGS_DIR = path.join(DATA_ROOT, 'drawings');
fs.mkdirSync(DRAWINGS_DIR, { recursive: true });
const PORTAL_FILE = path.join(DATA_ROOT, 'portal.json');
const PORTAL_MEDIA_DIR = path.join(DATA_ROOT, 'portal-media');
fs.mkdirSync(PORTAL_MEDIA_DIR, { recursive: true });
const PLAY_COUNTS_FILE = path.join(DATA_ROOT, 'play-counts.json');
const ALBUM_ART_DIR = path.join(DATA_ROOT, 'album-art');
fs.mkdirSync(ALBUM_ART_DIR, { recursive: true });
const ALBUM_ART_FILE = path.join(DATA_ROOT, 'album-art.json');
const VIDEO_THUMBS_DIR = path.join(DATA_ROOT, 'video-thumbs');
fs.mkdirSync(VIDEO_THUMBS_DIR, { recursive: true });
const VIDEO_THUMBS_FILE = path.join(DATA_ROOT, 'video-thumbs.json');

// General thumbnails for shelves that have no video frame or embedded art
// to grab automatically: Games and Programs get a cover image the host
// picks by hand, Books gets the first page of the PDF rendered in the
// browser. Separate storage from the video thumbs above so existing video
// thumbnails are untouched by any of this.
const FILE_THUMBS_DIR = path.join(DATA_ROOT, 'file-thumbs');
fs.mkdirSync(FILE_THUMBS_DIR, { recursive: true });
const FILE_THUMBS_FILE = path.join(DATA_ROOT, 'file-thumbs.json');
const THUMBNAILABLE_CATEGORIES = ['Games', 'Programs', 'Books'];
const LOCKED_NAMES_FILE = path.join(DATA_ROOT, 'locked-names.json');
const AI_DIR = path.join(DATA_ROOT, 'ai');
const AI_MODEL_DIR = path.join(AI_DIR, 'model');
fs.mkdirSync(AI_MODEL_DIR, { recursive: true });
const AI_SETTINGS_FILE = path.join(AI_DIR, 'settings.json');
const VISITORS_FILE = path.join(DATA_ROOT, 'visitors.json');
const USERS_FILE = path.join(DATA_ROOT, 'users.json');
const ACCESS_MODE_FILE = path.join(DATA_ROOT, 'access-mode.json');

// Network messaging: presence via UDP broadcast, messages via direct
// peer-to-peer HTTP (no central server, no cloud — matches everything else
// this app does).
const MESSAGING_DIR = path.join(DATA_ROOT, 'messaging');
const CONVERSATIONS_DIR = path.join(MESSAGING_DIR, 'conversations');
fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
const IDENTITY_FILE = path.join(MESSAGING_DIR, 'identity.json');
const KNOWN_PEERS_FILE = path.join(MESSAGING_DIR, 'known-peers.json');

// Master on/off switch for the whole app.
const POWER_FILE = path.join(DATA_ROOT, 'power.json');

// Localhost-only mode: a hard network-level switch, separate from the
// on/off power switch above.
const LOCALHOST_ONLY_FILE = path.join(DATA_ROOT, 'localhost-only.json');

// Quick "open write access" switch -- see the comment above the
// write-protection middleware itself for what this actually does.
const OPEN_WRITE_ACCESS_FILE = path.join(DATA_ROOT, 'open-write-access.json');

// Big Transfer: a dedicated spot for very large files (15-25GB and up --
// disk images, backups, whole video projects) that lives outside the
// regular shelves and their thumbnailing/play-count logic, and outside
// shared/ entirely so it's never swept into an "Export a backup" zip.
// Uploads arrive in chunks over plain POSTs rather than one giant
// multipart request, so a dropped connection only costs the current
// chunk, and a page refresh can find the same in-progress upload again
// (by a stable key derived from the file itself) instead of restarting a
// 20GB transfer from zero.
const BIGFILES_ROOT = path.join(__dirname, 'bigfiles');
const BIGFILES_INCOMING_DIR = path.join(BIGFILES_ROOT, '.incoming');
fs.mkdirSync(BIGFILES_INCOMING_DIR, { recursive: true });
const BIGFILES_STATE_FILE = path.join(DATA_ROOT, 'bigfile-uploads.json');

// Make sure every category folder exists
for (const cat of CATEGORIES) {
  fs.mkdirSync(path.join(SHARED_ROOT, cat), { recursive: true });
}

// ---- helpers ----

function isValidCategory(cat) {
  return CATEGORIES.includes(cat);
}

// Strip anything that could be used for path traversal or is unsafe in a filename.
function sanitizeFilename(name) {
  const base = path.basename(name); // drops any directory components
  return base.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'file';
}

function extOf(filename) {
  return path.extname(filename).slice(1).toLowerCase();
}

const PICTURE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic']);
const MUSIC_EXT = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'ogv', '3gp']);
const PDF_EXT = new Set(['pdf']);

function fileKind(filename) {
  const e = extOf(filename);
  if (PICTURE_EXT.has(e)) return 'image';
  if (MUSIC_EXT.has(e)) return 'audio';
  if (VIDEO_EXT.has(e)) return 'video';
  if (PDF_EXT.has(e)) return 'pdf';
  return 'other';
}

function humanSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// Streamed rather than read into memory all at once -- matters for video
// files, which can easily be gigabytes, and this may need to hash many of
// them in a row.
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addrs.push(iface.address);
      }
    }
  }
  return addrs;
}

// A stable, filesystem-safe folder name for a given (category, filename) pair,
// used as the extraction destination for a zipped game.
function extractionId(category, name) {
  return crypto.createHash('md5').update(`${category}/${name}`).digest('hex');
}

function removeExtractionCache(category, name) {
  const dir = path.join(EXTRACT_ROOT, extractionId(category, name));
  fs.rm(dir, { recursive: true, force: true }, () => {});
}

// Looks for the file a zipped HTML game should be launched from: index.html
// at the shallowest level, or any .html file, searched a few levels deep
// (many game exports wrap everything in one extra folder).
function findEntryHtml(dir, depth = 0) {
  if (depth > 6) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const indexFile = entries.find(e => e.isFile() && e.name.toLowerCase() === 'index.html');
  if (indexFile) return path.join(dir, indexFile.name);

  const anyHtml = entries.find(e => e.isFile() && e.name.toLowerCase().endsWith('.html'));
  if (anyHtml) return path.join(dir, anyHtml.name);

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '__MACOSX') {
      const found = findEntryHtml(path.join(dir, entry.name), depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// Only allow IDs that look like the UUIDs we generate ourselves — blocks
// path traversal via a crafted id in a URL.
function isValidId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(id);
}

// ---- Messaging: identity ----

function loadIdentity() {
  if (fs.existsSync(IDENTITY_FILE)) {
    try { return JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8')); } catch { /* fall through */ }
  }
  const identity = { id: crypto.randomUUID(), name: os.hostname() || 'My Computer', status: 'online' };
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(identity));
  return identity;
}

const identity = loadIdentity();

// Each Shelf's messaging identity belongs to ONE computer. It lives in
// data/messaging/identity.json, which a backup has always included -- so
// setting up a second computer from another's backup used to give both the
// same identity, and each then ignored the other ("that's me") while
// everyone else saw the two as a single entry. Now the identity remembers
// which computer it was made on (its network hardware addresses, or its
// name if those aren't available); if it turns up on a different computer,
// that computer takes a fresh identity of its own. Old identities without
// this record just get it added -- and a clash that already exists is
// caught at runtime instead (see handleIdentityClash).
function machineRecord() {
  const macs = [...new Set(Object.values(os.networkInterfaces()).flat()
    .filter(i => i && !i.internal && i.mac && i.mac !== '00:00:00:00:00:00').map(i => i.mac.toLowerCase()))].sort();
  return { hostname: os.hostname(), macs };
}
(function claimIdentityForThisComputer() {
  const here = machineRecord();
  const saved = identity.machine;
  if (saved) {
    const sameMachine = (saved.macs && saved.macs.length && here.macs.length)
      ? saved.macs.some(m => here.macs.includes(m))
      : saved.hostname === here.hostname;
    if (!sameMachine) {
      console.log(`[Messages] This identity was made on another computer (${saved.hostname}) -- taking a new one for ${here.hostname}.`);
      identity.id = crypto.randomUUID();
      identity.name = here.hostname || identity.name;
    }
  }
  identity.machine = here;
  saveIdentity();
})();

function saveIdentity() {
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(identity));
}

function loadKnownPeers() {
  if (!fs.existsSync(KNOWN_PEERS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(KNOWN_PEERS_FILE, 'utf8')); } catch { return {}; }
}

function saveKnownPeers(kp) {
  fs.writeFileSync(KNOWN_PEERS_FILE, JSON.stringify(kp));
}

// Called on every broadcast and check-in, so it only touches the disk when
// something changed or a minute has passed -- writing a file every few
// seconds per peer would needlessly wear out a Raspberry Pi's SD card.
function rememberPeer(id, info) {
  const known = loadKnownPeers();
  const prev = known[id] || {};
  const now = Date.now();
  const changed = Object.entries(info).some(([k, v]) => v !== undefined && prev[k] !== v);
  if (!changed && prev.lastSeenAt && now - prev.lastSeenAt < 60 * 1000) return;
  known[id] = { ...prev, ...info, lastSeenAt: now };
  // Only one copy of The Shelf can answer at an address, so an older
  // identity at the same address is that computer before it changed --
  // drop it (unless there's a conversation with it, which is kept).
  if (info.ip) {
    const port = info.httpPort || prev.httpPort || PORT;
    for (const [otherId, p] of Object.entries(known)) {
      if (otherId !== id && p.ip === info.ip && (p.httpPort || PORT) === port && !hasConversation(otherId)) delete known[otherId];
    }
  }
  saveKnownPeers(known);
}

function hasConversation(peerId) {
  try { return fs.existsSync(path.join(CONVERSATIONS_DIR, `${peerId}.json`)); } catch { return false; }
}

// Clears out a known-peers list that filled up with throwaway identities
// (see INSTANCE_TAG): keeps the newest entry per address, plus anyone
// there's a conversation with.
function tidyKnownPeers() {
  const known = loadKnownPeers();
  const entries = Object.entries(known).sort((a, b) => (b[1].lastSeenAt || 0) - (a[1].lastSeenAt || 0));
  const seenAddr = new Set();
  const kept = {};
  for (const [id, p] of entries) {
    const addr = p.ip ? `${p.ip}:${p.httpPort || PORT}` : `id:${id}`;
    if (!seenAddr.has(addr) || hasConversation(id)) { kept[id] = p; seenAddr.add(addr); }
  }
  const removed = entries.length - Object.keys(kept).length;
  if (removed > 0) {
    saveKnownPeers(kept);
    console.log(`[Messages] Tidied the list of known computers: removed ${removed} duplicate entr${removed === 1 ? 'y' : 'ies'}.`);
  }
}

// ---- Play counts for Music/Videos/Games/Programs ----
// Keyed by "category/filename" since filenames alone aren't unique across
// categories. Programs don't really "play" in the browser, so their count
// tracks downloads instead — the analogous trackable action for that shelf.

function loadPlayCounts() {
  if (!fs.existsSync(PLAY_COUNTS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PLAY_COUNTS_FILE, 'utf8')); } catch { return {}; }
}

function savePlayCounts(counts) {
  fs.writeFileSync(PLAY_COUNTS_FILE, JSON.stringify(counts));
}

function playCountKey(category, filename) {
  return `${category}/${filename}`;
}

function getPlayCount(category, filename) {
  const counts = loadPlayCounts();
  return counts[playCountKey(category, filename)] || 0;
}

function incrementPlayCount(category, filename) {
  const counts = loadPlayCounts();
  const key = playCountKey(category, filename);
  counts[key] = (counts[key] || 0) + 1;
  savePlayCounts(counts);
  return counts[key];
}

// Called whenever a file is deleted, renamed, or moved so its play count
// doesn't linger under a name that no longer exists, or get silently lost
// when it should have carried over instead.
function migratePlayCount(fromCategory, fromName, toCategory, toName) {
  const counts = loadPlayCounts();
  const fromKey = playCountKey(fromCategory, fromName);
  if (!(fromKey in counts)) return;
  const value = counts[fromKey];
  delete counts[fromKey];
  if (toCategory && toName) {
    counts[playCountKey(toCategory, toName)] = value;
  }
  savePlayCounts(counts);
}

// ---- Manual-rename locking ----
// A file the person has deliberately renamed by hand (via the "Rename"
// action in the file list) is remembered here so bulk tools -- right now
// just "Standardize names" -- leave it completely alone from then on: no
// re-guessing its artist/title, no overwriting its tags, no renaming it
// back to whatever the automatic pattern would produce. Same key format
// and migrate-on-rename/move pattern as play counts/album art above.

function loadLockedNames() {
  if (!fs.existsSync(LOCKED_NAMES_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(LOCKED_NAMES_FILE, 'utf8')); } catch { return {}; }
}

function saveLockedNames(map) {
  fs.writeFileSync(LOCKED_NAMES_FILE, JSON.stringify(map));
}

function lockedNameKey(category, filename) {
  return `${category}/${filename}`;
}

function isNameLocked(category, filename) {
  const map = loadLockedNames();
  return !!map[lockedNameKey(category, filename)];
}

// Marks a filename as manually-set, protecting it going forward. Called
// only from the explicit "Rename" action -- an automatic rename (from
// standardize-names itself, or from migrating a play count/album art
// entry) never calls this, since those aren't the person choosing a name.
function lockName(category, filename) {
  const map = loadLockedNames();
  map[lockedNameKey(category, filename)] = true;
  saveLockedNames(map);
}

function migrateLockedName(fromCategory, fromName, toCategory, toName) {
  const map = loadLockedNames();
  const fromKey = lockedNameKey(fromCategory, fromName);
  if (!(fromKey in map)) return;
  delete map[fromKey];
  if (toCategory && toName) {
    map[lockedNameKey(toCategory, toName)] = true;
  }
  saveLockedNames(map);
}

// ---- Album art ----
// A small local cache mapping "category/filename" to a downloaded cover
// image, fetched on demand from the iTunes Search API (no account or API
// key needed). Same key format and migrate-on-rename/move/delete pattern
// as play counts above, just with an actual file to clean up too.

function loadAlbumArtMap() {
  if (!fs.existsSync(ALBUM_ART_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(ALBUM_ART_FILE, 'utf8')); } catch { return {}; }
}

function saveAlbumArtMap(map) {
  fs.writeFileSync(ALBUM_ART_FILE, JSON.stringify(map));
}

function albumArtKey(category, filename) {
  return `${category}/${filename}`;
}

function getAlbumArtUrl(category, filename) {
  const map = loadAlbumArtMap();
  const entry = map[albumArtKey(category, filename)];
  return entry ? `/data-files/album-art/${entry}` : null;
}

// node-taglib-sharp picks the right underlying tag format for whatever
// file it's given (ID3v2 for MP3, its own picture block for FLAC, Vorbis
// comments for OGG, an MP4 atom for M4A/AAC, an embedded ID3 chunk for
// WAV) behind one consistent tag.pictures API, so this one function
// covers every format The Shelf handles rather than needing a separate
// implementation per format. Setting tag.pictures only touches the
// picture(s) — title, artist, and any other existing tags on the file
// are left exactly as they were.
function embedAlbumArt(filePath, artPath) {
  let file;
  try {
    file = TagLib.File.createFromPath(filePath);
    file.tag.pictures = [TagLib.Picture.fromPath(artPath)];
    file.save();
    return true;
  } catch {
    return false;
  } finally {
    if (file) file.dispose();
  }
}

// Deliberately NOT "does this file have any embedded picture at all" --
// files downloaded via yt-dlp/youtube-dl-style tools very commonly already
// carry the source video's thumbnail as embedded art, which would make
// that check true for basically an entire library and permanently block
// real cover art from ever being fetched for it. "Already has art" is
// tracked by The Shelf's own record of what it fetched (the album-art map
// below) instead, so a track only counts as done once this tool has
// actually put real cover art into it -- "Clear album art" is the way to
// force a re-fetch that overwrites an existing thumbnail.

// Reads just the artist/performer tag, format-agnostic the same way
// embedAlbumArt is — an untagged file, or one taglib can't parse, just
// comes back with no artist rather than failing the whole listing.
//
// Remembered per file (until the file changes): opening a song file and
// parsing its tags is the slowest part of listing the Music shelf, and the
// list is fetched often -- on a Raspberry Pi, re-reading a few hundred
// songs' tags every time made the whole Shelf stall for a second or more
// (nothing else gets answered while it's busy, music streaming included).
const artistCache = new Map(); // path -> { mtimeMs, size, artist }
function readArtist(filePath, stat) {
  try { stat = stat || fs.statSync(filePath); } catch { return null; }
  const hit = artistCache.get(filePath);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.artist;
  let file, artist = null;
  try {
    file = TagLib.File.createFromPath(filePath);
    const a = file.tag.performers && file.tag.performers[0];
    artist = a ? a.trim() : null;
  } catch {
    artist = null;
  } finally {
    if (file) file.dispose();
  }
  artistCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, artist });
  return artist;
}

function migrateAlbumArt(fromCategory, fromName, toCategory, toName) {
  const map = loadAlbumArtMap();
  const fromKey = albumArtKey(fromCategory, fromName);
  if (!(fromKey in map)) return;
  const artFile = map[fromKey];
  delete map[fromKey];
  if (toCategory && toName) {
    map[albumArtKey(toCategory, toName)] = artFile;
  } else {
    // The track itself was deleted, not moved or renamed — the cached art
    // is now orphaned, so clean it up rather than leaving it on disk.
    try { fs.unlinkSync(path.join(ALBUM_ART_DIR, artFile)); } catch { /* already gone, fine */ }
  }
  saveAlbumArtMap(map);
}

// Turns a filename into a reasonable search term for a cover-art lookup —
// strip the extension, swap remaining separators for spaces. Deliberately
// simple: filenames vary too much to reliably split into a real
// artist/title pair, and the search API is fuzzy enough to often find a
// good match from the combined text anyway.
function albumArtSearchTerm(filename) {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---- Video thumbnails ----
// Same idea and storage shape as album art above, but there's no external
// catalog to search for a video cover — instead the browser grabs an
// actual frame from the video itself (via a hidden <video> + canvas) and
// uploads it here as a JPEG data URL. This file just stores whatever the
// browser sends; the frame-capture itself is entirely client-side.

function loadVideoThumbMap() {
  if (!fs.existsSync(VIDEO_THUMBS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(VIDEO_THUMBS_FILE, 'utf8')); } catch { return {}; }
}

function saveVideoThumbMap(map) {
  fs.writeFileSync(VIDEO_THUMBS_FILE, JSON.stringify(map));
}

function videoThumbKey(category, filename) {
  return `${category}/${filename}`;
}

function getVideoThumbUrl(category, filename) {
  const map = loadVideoThumbMap();
  const entry = map[videoThumbKey(category, filename)];
  return entry ? `/data-files/video-thumbs/${entry}` : null;
}

function migrateVideoThumb(fromCategory, fromName, toCategory, toName) {
  const map = loadVideoThumbMap();
  const fromKey = videoThumbKey(fromCategory, fromName);
  if (!(fromKey in map)) return;
  const thumbFile = map[fromKey];
  delete map[fromKey];
  if (toCategory && toName) {
    map[videoThumbKey(toCategory, toName)] = thumbFile;
  } else {
    try { fs.unlinkSync(path.join(VIDEO_THUMBS_DIR, thumbFile)); } catch { /* already gone, fine */ }
  }
  saveVideoThumbMap(map);
}

// ---- General file thumbnails (Games, Programs, Books) ----
// Same storage shape as the video thumbs above, just not tied to one
// category. Games and Programs have nothing visual buried inside the file
// for the browser to grab on its own, so those get whatever cover image
// the host picks and uploads; Books gets the first page of the PDF
// rendered to a canvas via pdf.js. Either way this endpoint just stores
// the finished JPEG the browser hands it -- the generation itself, manual
// or automatic, happens entirely client-side.

function loadFileThumbMap() {
  if (!fs.existsSync(FILE_THUMBS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(FILE_THUMBS_FILE, 'utf8')); } catch { return {}; }
}

function saveFileThumbMap(map) {
  fs.writeFileSync(FILE_THUMBS_FILE, JSON.stringify(map));
}

function fileThumbKey(category, filename) {
  return `${category}/${filename}`;
}

function getFileThumbUrl(category, filename) {
  const map = loadFileThumbMap();
  const entry = map[fileThumbKey(category, filename)];
  return entry ? `/data-files/file-thumbs/${entry}` : null;
}

function migrateFileThumb(fromCategory, fromName, toCategory, toName) {
  const map = loadFileThumbMap();
  const fromKey = fileThumbKey(fromCategory, fromName);
  if (!(fromKey in map)) return;
  const thumbFile = map[fromKey];
  delete map[fromKey];
  if (toCategory && toName) {
    map[fileThumbKey(toCategory, toName)] = thumbFile;
  } else {
    try { fs.unlinkSync(path.join(FILE_THUMBS_DIR, thumbFile)); } catch { /* already gone, fine */ }
  }
  saveFileThumbMap(map);
}

// ---- Visitor tracking ----
// Records every device that's loaded the main page — this is deliberately
// separate from the messaging "known peers" list, which only tracks other
// Shelf *servers* discovered via network broadcast. Most people just open
// this in a browser without running their own Shelf install, so that list
// is usually empty; this one tracks actual visits instead.

function loadVisitors() {
  if (!fs.existsSync(VISITORS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8')); } catch { return {}; }
}

function saveVisitors(v) {
  fs.writeFileSync(VISITORS_FILE, JSON.stringify(v));
}

function recordVisitor(rawIp) {
  if (!rawIp) return;
  const ip = rawIp.replace(/^::ffff:/, ''); // normalize IPv4-mapped IPv6 addresses
  if (ip === '127.0.0.1' || ip === '::1') return; // don't log the host visiting its own page

  const visitors = loadVisitors();
  const now = Date.now();
  const existing = visitors[ip];
  visitors[ip] = {
    ip,
    hostname: existing ? existing.hostname : null,
    firstSeenAt: existing ? existing.firstSeenAt : now,
    lastSeenAt: now
  };
  saveVisitors(visitors);

  // Best-effort reverse DNS for a friendlier name than a raw IP — most home
  // networks won't resolve this for phones/tablets, and that's fine, the IP
  // alone is still useful. Never blocks the actual request.
  if (!existing || !existing.hostname) {
    dns.reverse(ip, (err, hostnames) => {
      if (err || !hostnames || !hostnames.length) return;
      const fresh = loadVisitors();
      if (fresh[ip]) {
        fresh[ip].hostname = hostnames[0].replace(/\.$/, '');
        saveVisitors(fresh);
      }
    });
  }
}

// ---- User accounts & access control ----
// A small local user database — usernames, hashed passwords, and a role of
// either "read" (can browse but not change anything) or "write" (full
// access). This only ever gates requests coming from somewhere other than
// the host machine itself: sitting at the computer running The Shelf
// always has full access, no login needed, same as before this existed.
// Managing users (creating, editing, removing accounts) is itself
// restricted to the host machine for the same reason a stranger on the
// network shouldn't be able to grant themselves an account.

function isLocalRequest(req) {
  const raw = req.ip || (req.connection && req.connection.remoteAddress) || '';
  const ip = raw.replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1';
}

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users));
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  try {
    const actual = Buffer.from(hashPassword(password, salt), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Sessions live in memory only (not written to disk) — restarting The
// Shelf simply logs everyone out, which is a reasonable, safe default.
const sessions = new Map(); // token -> { userId, expiresAt }
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parts = header.split(';').map(c => c.trim());
  const found = parts.find(c => c.startsWith(name + '='));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

function getSessionUser(req) {
  const token = getCookie(req, 'shelfSession');
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const users = loadUsers();
  return users.find(u => u.id === session.userId) || null;
}

// Requests that stay open to anyone even once accounts exist — the login
// flow itself, and a couple of low-stakes actions (play-count ticks,
// messaging) that would make the app frustrating to use if every click
// demanded a write-access login.
function isAuthExemptPath(reqPath) {
  if (reqPath.startsWith('/api/auth/login') || reqPath === '/api/auth/logout') return true;
  if (/^\/api\/files\/[^/]+\/[^/]+\/play$/.test(reqPath)) return true;
  if (reqPath.startsWith('/api/messaging/')) return true;
  return false;
}

// ---- Messaging: discovery (UDP broadcast) ----

const DISCOVERY_PORT = 41234;
const PEER_TIMEOUT_MS = 10000; // 3s broadcast interval; ~3 missed beats = considered offline
const onlinePeers = new Map(); // id -> { id, name, status, ip, httpPort, lastSeen }
const udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

udpSocket.on('message', (msg, rinfo) => {
  let data;
  try { data = JSON.parse(msg.toString()); } catch { return; }
  if (data.type !== 'shelf-presence' || !isValidId(data.id)) return;
  if (isOwnEcho(data)) return; // our own broadcast, heard back
  if (data.id === identity.id) { handleIdentityClash(rinfo.address, data.name); return; }

  onlinePeers.set(data.id, {
    id: data.id,
    name: data.name || 'Unknown',
    status: data.status || 'online',
    ip: rinfo.address,
    httpPort: data.httpPort,
    lastSeen: Date.now()
  });

  rememberPeer(data.id, { name: data.name, ip: rinfo.address, httpPort: data.httpPort });
});

udpSocket.on('error', (err) => {
  console.log('Discovery (UDP) error — network messaging may not find other devices:', err.message);
});

udpSocket.bind(DISCOVERY_PORT, () => {
  try { udpSocket.setBroadcast(true); } catch { /* best effort */ }
  broadcastPresence();
});

// Every IPv4 network this computer is on (Wi-Fi, Ethernet, ...), with the
// broadcast address and host range of each. A computer with more than one
// connection used to announce itself on only one of them: 255.255.255.255
// goes out of whichever connection the OS picks, so copies on the other
// network never heard it.
function localNetworks() {
  const nets = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family !== 'IPv4' || iface.internal || !iface.netmask) continue;
      const ip = ipToInt(iface.address), mask = ipToInt(iface.netmask);
      if (iface.address.startsWith('169.254.')) continue; // self-assigned "no network" address
      nets.push({ address: iface.address, ip, mask, broadcast: intToIp((ip & mask) | (~mask >>> 0)) });
    }
  }
  return nets;
}
function ipToInt(a) { return a.split('.').reduce((n, o) => ((n << 8) | Number(o)) >>> 0, 0); }
function intToIp(n) { return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }

// A random tag for this running copy of The Shelf. It rides along with
// every announcement and "hello" reply, so a message that turns out to be
// our own -- a broadcast echoed back to us, or a scan that reached this
// computer through a second address -- is recognized as us, never as
// "another computer using our identity". Without it, a Pi whose own
// broadcast came back from an address it didn't list as its own (an
// unplugged Ethernet port's self-assigned 169.254.x address, say) took a
// new identity, announced it, heard itself again, and repeated that
// hundreds of times a second -- flooding every other Shelf with thousands
// of fake "raspberrypi" entries.
const INSTANCE_TAG = crypto.randomBytes(8).toString('hex');
function isOwnEcho(msg) { return !!msg && msg.instance === INSTANCE_TAG; }

function presencePayload() {
  return { type: 'shelf-presence', id: identity.id, name: identity.name, status: identity.status, httpPort: Number(PORT), instance: INSTANCE_TAG };
}

function broadcastPresence() {
  if (!appOn || identity.status === 'offline') return; // "appear offline", or the whole app is switched off
  const payload = Buffer.from(JSON.stringify(presencePayload()));
  const targets = new Set(['255.255.255.255', ...localNetworks().map(n => n.broadcast)]);
  for (const addr of targets) udpSocket.send(payload, 0, payload.length, DISCOVERY_PORT, addr, () => {});
}

setInterval(broadcastPresence, 3000);

// ---- Messaging: direct discovery (works where broadcasts don't) ----
// Broadcasts are the quick way to find each other, but plenty of networks
// quietly drop them: Windows' firewall often blocks them, some routers and
// mesh Wi-Fi don't pass them between devices, and VPN/virtual adapters can
// swallow them. So as well as listening, each Shelf also asks directly:
//
//   - a network scan: every address on each local network (up to 254 per
//     network) gets a quick "are you a Shelf?" on the usual port -- at
//     startup, every couple of minutes, and on demand from the Messages
//     tab's "Scan network" button;
//   - a check-in every few seconds with each copy already known, so its
//     online status stays right even if no broadcast ever arrives.
//
// The question carries our own details too, so whoever is asked learns
// about us at the same moment -- discovery works both ways, even if only
// one side can reach the other's broadcast.
const SCAN_PORTS = [...new Set([Number(PORT), 8080])]; // PORT can arrive as text from the environment
let lastScan = { at: 0, found: 0, scanning: false, addresses: 0 };

// Another computer answering with OUR identity (see claimIdentityForThisComputer):
// this computer takes a fresh one so the two can see each other again.
// Hearing our own id from one of our own addresses is just us, though.
let identityClash = null;
// Every address this computer has -- including self-assigned 169.254.x
// ones and IPv6, which localNetworks() leaves out on purpose.
function ownAddresses() {
  const all = new Set(['127.0.0.1', '::1']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) if (iface && iface.address) all.add(iface.address.replace(/^::ffff:/, '').split('%')[0]);
  }
  return all;
}
let lastClashAt = 0;
function handleIdentityClash(fromIp, otherName) {
  const ip = String(fromIp || '').replace(/^::ffff:/, '');
  if (!ip || ownAddresses().has(ip)) return false;
  // A real clash needs fixing once. If it seems to keep happening, something
  // else is going on -- never churn through identities.
  if (Date.now() - lastClashAt < 10 * 60 * 1000) return false;
  lastClashAt = Date.now();
  const oldName = identity.name;
  identity.id = crypto.randomUUID();
  if (otherName && otherName === identity.name && os.hostname() && os.hostname() !== identity.name) identity.name = os.hostname();
  saveIdentity();
  identityClash = { at: Date.now(), withIp: ip, oldName, newName: identity.name };
  console.log(`[Messages] ${ip} was using this computer's identity (likely set up from its backup) -- took a new one.`);
  broadcastPresence();
  return true;
}

// Two DIFFERENT computers seen with the same identity (neither has updated
// yet, so neither has fixed it): remembered so Messages can say so plainly
// instead of quietly showing just one of them.
const idAddresses = new Map(); // id -> Map(ip -> { at, name })
function noteIdAddress(id, ip, name) {
  const now = Date.now();
  // A computer that now answers with a different identity (it fixed a
  // clash) no longer counts toward its old one.
  for (const [otherId, other] of idAddresses) if (otherId !== id) other.delete(ip);
  const m = idAddresses.get(id) || new Map();
  m.set(ip, { at: now, name });
  for (const [k, v] of m) if (now - v.at > 5 * 60 * 1000) m.delete(k);
  idAddresses.set(id, m);
}
function sharedIdentities() {
  const out = [];
  for (const [id, m] of idAddresses) {
    if (m.size > 1) out.push({ id, computers: [...m.entries()].map(([ip, v]) => ({ ip, name: v.name || 'Unknown' })) });
  }
  return out;
}

function notePeer(info, ip, via) {
  if (!info || !isValidId(info.id)) return null;
  if (isOwnEcho(info)) return null; // reached ourselves through another address
  if (info.id === identity.id) { handleIdentityClash(ip, info.name); return null; }
  noteIdAddress(info.id, ip, String(info.name || 'Unknown').slice(0, 60));
  const peer = {
    id: info.id,
    name: String(info.name || 'Unknown').slice(0, 60),
    status: ['online', 'away', 'busy'].includes(info.status) ? info.status : 'online',
    ip,
    httpPort: Number(info.httpPort) || PORT,
    lastSeen: Date.now(),
    via,
  };
  onlinePeers.set(peer.id, peer);
  rememberPeer(peer.id, { name: peer.name, ip: peer.ip, httpPort: peer.httpPort });
  return peer;
}

// Asks one address whether it's a Shelf. Newer copies answer the "hello"
// (and learn about us); older ones without it still answer the plain
// identity request, so they're found too.
async function probeShelf(ip, port, timeoutMs) {
  const base = `http://${ip}:${port}/api/messaging`;
  try {
    const r = await fetch(`${base}/hello`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(presencePayload()), signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.ok) {
      const data = await r.json();
      return data && data.type === 'shelf-hello' ? { ...data, httpPort: data.httpPort || port } : null;
    }
    if (r.status !== 404) return null;
    const old = await fetch(`${base}/identity`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!old.ok) return null;
    const data = await old.json();
    return data && data.id && data.status !== 'offline' ? { ...data, httpPort: port } : null;
  } catch { return null; }
}

async function scanNetwork() {
  if (lastScan.scanning || !appOn || identity.status === 'offline') return lastScan;
  lastScan = { ...lastScan, scanning: true };
  const targets = [];
  const ranges = new Map(); // "a.b.c" -> { base, size, skip }
  for (const net of localNetworks()) {
    // Big networks are narrowed to the 254 addresses around our own, so a
    // scan always finishes in seconds rather than probing thousands.
    const mask = (net.mask >>> 0) < 0xFFFFFF00 ? 0xFFFFFF00 : net.mask;
    const base = (net.ip & mask) >>> 0;
    ranges.set(intToIp(base), { base, size: (~mask >>> 0) + 1, skip: net.address });
  }
  // On a big network (say 10.0.0.0/16) other copies can sit outside our
  // own 254 -- so also cover each nearby range where one has been seen.
  const bigNets = localNetworks().filter(n => (n.mask >>> 0) < 0xFFFFFF00);
  for (const p of Object.values(loadKnownPeers())) {
    if (!p.ip || !/^\d+\.\d+\.\d+\.\d+$/.test(p.ip)) continue;
    const ipInt = ipToInt(p.ip);
    if (!bigNets.some(n => ((ipInt & n.mask) >>> 0) === ((n.ip & n.mask) >>> 0))) continue;
    const base = (ipInt & 0xFFFFFF00) >>> 0;
    if (!ranges.has(intToIp(base)) && ranges.size < 8) ranges.set(intToIp(base), { base, size: 256, skip: null });
  }
  for (const r of ranges.values()) {
    for (let i = 1; i < r.size - 1; i++) {
      const ip = intToIp((r.base + i) >>> 0);
      if (ip !== r.skip) for (const port of SCAN_PORTS) targets.push([ip, port]);
    }
  }
  lastScan.ranges = [...ranges.values()].map(r => `${intToIp((r.base + 1) >>> 0)}\u2013${intToIp((r.base + r.size - 2) >>> 0)}`);
  let found = 0, next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const [ip, port] = targets[next++];
      const info = await probeShelf(ip, port, 800);
      if (info && notePeer(info, ip, 'scan')) found++;
    }
  };
  await Promise.all(Array.from({ length: 48 }, worker));
  lastScan = { at: Date.now(), found, scanning: false, addresses: targets.length, ranges: lastScan.ranges };
  return lastScan;
}
setTimeout(() => scanNetwork().catch(() => {}), 4000);
setInterval(() => scanNetwork().catch(() => {}), 2 * 60 * 1000);

// Check in directly with every copy seen in the last week.
async function checkInWithKnownPeers() {
  if (!appOn || identity.status === 'offline') return;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  // Once per address (newest entry wins), and at most 40 at a time -- a
  // list full of duplicates used to mean thousands of requests every 5
  // seconds, which buried a Raspberry Pi.
  const byAddr = new Map();
  for (const [id, p] of Object.entries(loadKnownPeers())) {
    if (id === identity.id || !p.ip || !(p.lastSeenAt > weekAgo)) continue;
    const addr = `${p.ip}:${p.httpPort || PORT}`;
    const cur = byAddr.get(addr);
    if (!cur || (p.lastSeenAt || 0) > (cur[1].lastSeenAt || 0)) byAddr.set(addr, [id, p]);
  }
  const known = [...byAddr.values()].sort((a, b) => (b[1].lastSeenAt || 0) - (a[1].lastSeenAt || 0)).slice(0, 40);
  await Promise.all(known.map(async ([id, p]) => {
    const info = await probeShelf(p.ip, p.httpPort || PORT, 1500);
    // Noted even if the identity changed -- e.g. that computer just took a
    // new one after a clash -- so it reappears within seconds, not minutes.
    if (info) notePeer(info, p.ip, 'direct');
  }));
}
setInterval(() => checkInWithKnownPeers().catch(() => {}), 5000);
tidyKnownPeers();
setInterval(() => { try { tidyKnownPeers(); } catch { /* best effort */ } }, 10 * 60 * 1000);

function prunedOnlinePeers() {
  const now = Date.now();
  const result = [];
  for (const [id, peer] of onlinePeers) {
    if (now - peer.lastSeen > PEER_TIMEOUT_MS) onlinePeers.delete(id);
    else result.push(peer);
  }
  return result;
}

// ---- Messaging: conversation storage (one JSON file per peer) ----

function conversationFile(peerId) {
  return path.join(CONVERSATIONS_DIR, `${peerId}.json`);
}

function loadConversation(peerId) {
  const file = conversationFile(peerId);
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

// The conversation list is asked for every few seconds by every open
// browser (for the unread badge), and conversations keep shared pictures
// inside them -- so re-reading and re-parsing every one of them each time
// got slower the more you chatted. Each conversation's summary is now
// remembered until its file changes.
const conversationSummaryCache = new Map(); // peerId -> { mtimeMs, size, summary }
function conversationSummary(peerId) {
  const file = conversationFile(peerId);
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const hit = conversationSummaryCache.get(peerId);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.summary;
  const messages = loadConversation(peerId);
  const last = messages[messages.length - 1];
  let lastIn = null, unread = 0;
  for (const m of messages) if (m.direction === 'in') { lastIn = m; if (!m.read) unread++; }
  const summary = {
    last: last ? { timestamp: last.timestamp, text: last.text || '', image: !!last.image } : null,
    lastIn: lastIn ? { timestamp: lastIn.timestamp, text: lastIn.text || '', image: !!lastIn.image } : null,
    unread,
  };
  conversationSummaryCache.set(peerId, { mtimeMs: st.mtimeMs, size: st.size, summary });
  return summary;
}

function saveConversation(peerId, messages) {
  fs.writeFileSync(conversationFile(peerId), JSON.stringify(messages));
}

function appendMessage(peerId, message) {
  const messages = loadConversation(peerId);
  messages.push(message);
  saveConversation(peerId, messages);
  return messages;
}

// ---- Master on/off switch ----

function loadPower() {
  if (fs.existsSync(POWER_FILE)) {
    try { return JSON.parse(fs.readFileSync(POWER_FILE, 'utf8')).on !== false; } catch { /* fall through */ }
  }
  return true;
}

let appOn = loadPower();

function savePower() {
  fs.writeFileSync(POWER_FILE, JSON.stringify({ on: appOn }));
}

// ---- Secure mode ----
// Off (default, "Anonymous read only"): anyone on the network can browse
// without logging in, and only needs an account to make changes (handled
// by the write-protection middleware above). On ("Secured visitors"):
// even browsing requires a logged-in account — the host machine itself
// is always exempt either way.

function loadSecureMode() {
  if (fs.existsSync(ACCESS_MODE_FILE)) {
    try { return JSON.parse(fs.readFileSync(ACCESS_MODE_FILE, 'utf8')).secureMode === true; } catch { /* fall through */ }
  }
  return false;
}

let secureMode = loadSecureMode();

function saveSecureMode() {
  fs.writeFileSync(ACCESS_MODE_FILE, JSON.stringify({ secureMode }));
}

// ---- Open write access ----
// A quick, temporary override for the write-protection rule below: instead
// of setting up a real write-access account for a guest, this just waves
// everyone through, host machine or not. Deliberately covers *everything*
// gated by that same rule -- there's no separate carve-out for AI, so
// turning this on also lets anyone reach the AI chat (normally a
// write-access action like any other POST), which is the main reason
// someone would want this: to let a houseguest actually use the AI tab
// without setting up an account for them first. Off by default, and (like
// the localhost-only and secure-mode switches) only the host machine can
// turn it on or off.

function loadOpenWriteAccess() {
  if (fs.existsSync(OPEN_WRITE_ACCESS_FILE)) {
    try { return JSON.parse(fs.readFileSync(OPEN_WRITE_ACCESS_FILE, 'utf8')).on === true; } catch { /* fall through */ }
  }
  return false;
}

let openWriteAccess = loadOpenWriteAccess();

function saveOpenWriteAccess() {
  fs.writeFileSync(OPEN_WRITE_ACCESS_FILE, JSON.stringify({ on: openWriteAccess }));
}

// Tracks in-progress Big Transfer uploads: uploadId -> { name, size, tempName, createdAt }.
// Persisted to disk (not just kept in memory) so an upload can still be
// resumed by a page refresh even if the server itself restarted meanwhile.
function loadBigfileUploads() {
  if (fs.existsSync(BIGFILES_STATE_FILE)) {
    try { return JSON.parse(fs.readFileSync(BIGFILES_STATE_FILE, 'utf8')); } catch { /* fall through */ }
  }
  return {};
}
let bigfileUploads = loadBigfileUploads();
function saveBigfileUploads() {
  fs.writeFileSync(BIGFILES_STATE_FILE, JSON.stringify(bigfileUploads));
}

const OFF_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>The Shelf — Off</title>
<style>
  body { margin:0; background:#241B2F; color:#F0E9E3; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
    display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px; }
  .card { text-align:center; max-width:360px; }
  h1 { font-family:Georgia,'Iowan Old Style',serif; font-size:24px; margin:0 0 10px; }
  p { color:#B7ABBA; font-size:14px; line-height:1.5; margin:0; }
  button { margin-top:22px; background:#F2B441; color:#2A1D0E; border:none; padding:12px 24px;
    border-radius:8px; font-weight:600; font-size:15px; cursor:pointer; }
  button:hover { filter:brightness(1.05); }
</style>
</head>
<body>
  <div class="card">
    <h1>The Shelf is turned off</h1>
    <p>Someone switched it off from this computer. If you have access to it, you can turn it back on below.</p>
    <button onclick="turnOn()">Turn it back on</button>
  </div>
  <script>
    async function turnOn() {
      await fetch('/api/power', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: true }) });
      location.reload();
    }
  </script>
</body>
</html>
`;

// ---- Localhost-only mode ----
// A hard network-level switch, separate from the on/off power switch
// above: when on, only requests actually originating from this host
// machine are served at all -- every other device on the network is
// turned away before write-protection, before secure mode, before
// anything else gets a say. This is the "pull the network cable" option
// for keeping The Shelf to yourself for a while without fully powering it
// off (which logs everyone out and stops working here too). Only the host
// machine can turn it on or off, for the obvious reason that whoever it
// was just turned on against can't reach the toggle to undo it -- there's
// no self-service "turn it back on" link on the block page below, unlike
// the power-off page, since a page served to a blocked visitor can't very
// well hand them a way back in.

function loadLocalhostOnly() {
  if (fs.existsSync(LOCALHOST_ONLY_FILE)) {
    try { return JSON.parse(fs.readFileSync(LOCALHOST_ONLY_FILE, 'utf8')).on === true; } catch { /* fall through */ }
  }
  return false;
}

let localhostOnly = loadLocalhostOnly();

function saveLocalhostOnly() {
  fs.writeFileSync(LOCALHOST_ONLY_FILE, JSON.stringify({ on: localhostOnly }));
}

const LOCALHOST_ONLY_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>The Shelf</title>
<style>
  body { margin:0; background:#241B2F; color:#F0E9E3; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
    display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px; }
  .card { text-align:center; max-width:360px; }
  h1 { font-family:Georgia,'Iowan Old Style',serif; font-size:24px; margin:0 0 10px; }
  p { color:#B7ABBA; font-size:14px; line-height:1.5; margin:0; }
</style>
</head>
<body>
  <div class="card">
    <h1>Not reachable right now</h1>
    <p>Whoever runs this Shelf has set it to local-only access, so only their own computer can use it at the moment. Check back later, or ask them to turn that off.</p>
  </div>
</body>
</html>
`;

// ---- middleware ----

app.use(express.json({ limit: '25mb' })); // generous enough for a resized pasted image (Docs/Notes/Slides/Messages) or an edited photo

// The localhost-only gate runs before anything else -- including the
// power switch and secure mode below -- since the whole point is that a
// non-host device gets turned away outright, with nothing else about the
// app (its API, its files, even the off page) reachable to them at all.
app.use((req, res, next) => {
  if (!localhostOnly || isLocalRequest(req)) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(503).json({ error: 'This Shelf is currently set to local-only access.' });
  }
  res.status(200).send(LOCALHOST_ONLY_PAGE_HTML);
});

// Gate every change-making request behind a logged-in write-access
// account — but only for requests coming from somewhere other than the
// host machine itself, which always has full access. This applies
// whether or not any accounts have been created yet: "Anonymous read
// only" means what it says — anyone but the host is read-only by
// default, and the host has to explicitly create a write-access account
// to hand out editing permission to someone. The "open write access"
// switch above is the shortcut around all of that: while it's on, this
// gate is effectively switched off for everyone.
const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
app.use((req, res, next) => {
  if (!WRITE_METHODS.has(req.method)) return next();
  if (isLocalRequest(req)) return next();
  if (openWriteAccess) return next();
  if (isAuthExemptPath(req.path)) return next();
  const user = getSessionUser(req);
  if (user && user.role === 'write') return next();
  return res.status(401).json({ error: 'Only the host machine, or a logged-in write-access account, can make changes on this Shelf.' });
});

// "Secured visitors" mode goes further: even browsing requires a logged-in
// account (any role) once it's turned on. Off by default ("Anonymous read
// only"). Covers the actual content directories too (/shared, /play,
// /data-files), not just the API — otherwise someone could still fetch a
// raw file URL directly. The app shell itself (index.html, app.js,
// style.css) deliberately stays reachable so the login form can load.
const READ_METHODS = new Set(['GET', 'HEAD']);
function isProtectedReadPath(reqPath) {
  if (reqPath.startsWith('/api/auth/')) return false;
  if (reqPath.startsWith('/api/')) return true;
  if (reqPath.startsWith('/shared/')) return true;
  if (reqPath.startsWith('/play/')) return true;
  if (reqPath.startsWith('/data-files/')) return true;
  if (reqPath.startsWith('/bigfiles-dl/')) return true;
  return false;
}
app.use((req, res, next) => {
  if (!secureMode) return next();
  if (!READ_METHODS.has(req.method)) return next(); // write methods are already handled above
  if (isLocalRequest(req)) return next();
  if (!isProtectedReadPath(req.path)) return next();
  if (getSessionUser(req)) return next(); // any logged-in account, read or write, can view
  return res.status(401).json({ error: 'Log in to view this Shelf.' });
});

// ---- Auth endpoints ----

app.get('/api/auth/status', (req, res) => {
  const local = isLocalRequest(req);
  const user = getSessionUser(req);
  res.json({
    isLocal: local,
    protectionEnabled: loadUsers().length > 0,
    secureMode,
    loggedIn: !!user,
    username: user ? user.username : null,
    role: local ? 'write' : (user ? user.role : 'read')
  });
});

app.get('/api/auth/mode', (req, res) => res.json({ secureMode }));
app.put('/api/auth/mode', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Only available from the host machine.' });
  secureMode = !!(req.body && req.body.secureMode);
  saveSecureMode();
  res.json({ secureMode });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  const users = loadUsers();
  const match = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!match || !verifyPassword(password, match.salt, match.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId: match.id, expiresAt: Date.now() + SESSION_DURATION_MS });
  res.setHeader('Set-Cookie', `shelfSession=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DURATION_MS / 1000}; SameSite=Lax`);
  res.json({ loggedIn: true, username: match.username, role: match.role });
});

app.post('/api/auth/logout', (req, res) => {
  const token = getCookie(req, 'shelfSession');
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'shelfSession=; HttpOnly; Path=/; Max-Age=0');
  res.json({ loggedOut: true });
});

// User management is host-only — never over the network, so a visitor can
// never grant themselves an account.
app.get('/api/auth/users', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Only available from the host machine.' });
  const users = loadUsers().map(u => ({ id: u.id, username: u.username, role: u.role }));
  res.json(users);
});

app.post('/api/auth/users', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Only available from the host machine.' });
  const { username, password, role } = req.body || {};
  if (typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'A username is required.' });
  }
  if (typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  }
  if (role !== 'read' && role !== 'write') {
    return res.status(400).json({ error: 'Role must be "read" or "write".' });
  }
  const users = loadUsers();
  const cleanUsername = username.trim();
  if (users.some(u => u.username.toLowerCase() === cleanUsername.toLowerCase())) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const newUser = {
    id: crypto.randomBytes(8).toString('hex'),
    username: cleanUsername,
    salt,
    passwordHash: hashPassword(password, salt),
    role
  };
  users.push(newUser);
  saveUsers(users);
  res.json({ id: newUser.id, username: newUser.username, role: newUser.role });
});

app.put('/api/auth/users/:id', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Only available from the host machine.' });
  const users = loadUsers();
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const { password, role } = req.body || {};
  if (role !== undefined) {
    if (role !== 'read' && role !== 'write') {
      return res.status(400).json({ error: 'Role must be "read" or "write".' });
    }
    user.role = role;
  }
  if (password !== undefined) {
    if (typeof password !== 'string' || password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    }
    user.salt = crypto.randomBytes(16).toString('hex');
    user.passwordHash = hashPassword(password, user.salt);
    // Changing a user's password invalidates any of their existing sessions.
    for (const [token, s] of sessions) {
      if (s.userId === user.id) sessions.delete(token);
    }
  }
  saveUsers(users);
  res.json({ id: user.id, username: user.username, role: user.role });
});

app.delete('/api/auth/users/:id', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Only available from the host machine.' });
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found.' });
  const [removed] = users.splice(idx, 1);
  saveUsers(users);
  for (const [token, s] of sessions) {
    if (s.userId === removed.id) sessions.delete(token);
  }
  res.json({ deleted: removed.username });
});

// The master on/off switch always works, even while the app is "off" —
// otherwise there'd be no way to turn it back on.
app.get('/api/power', (req, res) => res.json({ on: appOn }));
app.put('/api/power', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Only available from the host machine.' });
  appOn = !!(req.body && req.body.on);
  savePower();
  res.json({ on: appOn });
});

// Only the host machine can read or change this -- a non-host device is
// already turned away by the gate above whenever it's on, so there'd be
// nothing for it to read anyway, but this keeps a non-host device from
// ever turning it OFF for someone else either.
app.get('/api/localhost-only', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Only available from the host machine.' });
  res.json({ localhostOnly });
});
app.put('/api/localhost-only', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Only available from the host machine.' });
  localhostOnly = !!(req.body && req.body.localhostOnly);
  saveLocalhostOnly();
  res.json({ localhostOnly });
});

// GET is open to anyone (same as /api/auth/mode) so the UI elsewhere can
// tell whether it's currently in effect; only the host machine can flip it.
app.get('/api/open-write-access', (req, res) => res.json({ openWriteAccess }));
app.put('/api/open-write-access', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Only available from the host machine.' });
  openWriteAccess = !!(req.body && req.body.openWriteAccess);
  saveOpenWriteAccess();
  res.json({ openWriteAccess });
});

app.use((req, res, next) => {
  if (appOn || req.path === '/api/power' || req.path.startsWith('/api/backup')) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(503).json({ error: 'The Shelf is currently turned off.' });
  }
  res.status(200).send(OFF_PAGE_HTML);
});

// Serve the actual media files. `dotfiles: deny` and no directory listing.
app.use('/shared', express.static(SHARED_ROOT, { dotfiles: 'deny', index: false }));

// Serve unzipped HTML games so they can run in an iframe.
app.use('/play', express.static(EXTRACT_ROOT, { dotfiles: 'deny' }));

// Serve drawing thumbnails/images.
// Only the media folders the pages actually display are reachable here,
// and only actual picture/video/audio files in them. Before this, the whole
// data/ folder was served -- so anyone on the network could download
// users.json (account password hashes), message history, settings and the
// rest just by typing the address. SVG is left out on purpose: an SVG can
// carry script, which would run as this site.
const PUBLIC_DATA_DIRS = new Set(['album-art', 'video-thumbs', 'file-thumbs', 'drawings', 'portal-media', 'imagine']);
const PUBLIC_DATA_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp',
  '.mp4', '.webm', '.mov', '.m4v', '.ogv', '.mp3', '.m4a', '.ogg', '.wav']);
app.use('/data-files', (req, res, next) => {
  const parts = req.path.split('/').filter(Boolean);
  if (parts.length < 2 || !PUBLIC_DATA_DIRS.has(parts[0]) || !PUBLIC_DATA_EXTS.has(path.extname(req.path).toLowerCase())) {
    return res.status(404).end();
  }
  next();
}, express.static(DATA_ROOT, { dotfiles: 'deny', index: false }));

// Serve completed Big Transfer files -- express.static supports Range
// requests out of the box, so a paused/resumed download works the same
// way it would for any other large file. `.incoming` (still-uploading
// parts) is a dotfile path and so is blocked by dotfiles:'deny' below.
app.use('/bigfiles-dl', express.static(BIGFILES_ROOT, { dotfiles: 'deny', index: false }));

// Records a visitor whenever the main page itself loads (not every asset
// or API call — just the actual "someone opened the app" moment).
app.use((req, res, next) => {
  if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html')) {
    recordVisitor(req.ip);
  }
  next();
});

// Serve the frontend
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const cat = req.body.category;
    if (!isValidCategory(cat)) {
      return cb(new Error('Invalid category'));
    }
    cb(null, path.join(SHARED_ROOT, cat));
  },
  filename: (req, file, cb) => {
    let name = sanitizeFilename(file.originalname);
    const dest = path.join(SHARED_ROOT, req.body.category);
    // avoid overwriting existing files with the same name
    let finalName = name;
    let counter = 1;
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    while (fs.existsSync(path.join(dest, finalName))) {
      finalName = `${base} (${counter})${ext}`;
      counter++;
    }
    cb(null, finalName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 } // 4GB per file, generous for games
});

// ---- API routes ----

app.get('/api/categories', (req, res) => {
  const summary = CATEGORIES.map(cat => {
    const dir = path.join(SHARED_ROOT, cat);
    const count = fs.readdirSync(dir).filter(f => !f.startsWith('.')).length;
    return { name: cat, count };
  });
  res.json(summary);
});

app.get('/api/files', (req, res) => {
  const cat = req.query.category;
  if (!isValidCategory(cat)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const dir = path.join(SHARED_ROOT, cat);
  // Each lookup file is read once for the whole list, not once per item --
  // that was a few hundred reads of the same files per listing.
  const counts = loadPlayCounts();
  const artMap = cat === 'Music' ? loadAlbumArtMap() : null;
  const videoThumbs = cat === 'Videos' ? loadVideoThumbMap() : null;
  const fileThumbs = THUMBNAILABLE_CATEGORIES.includes(cat) ? loadFileThumbMap() : null;
  const key = (f) => `${cat}/${f}`;
  const files = fs.readdirSync(dir)
    .filter(f => !f.startsWith('.'))
    .map(f => {
      const stat = fs.statSync(path.join(dir, f));
      return {
        name: f,
        size: stat.size,
        sizeLabel: humanSize(stat.size),
        modified: stat.mtimeMs,
        added: addedAt(stat),
        kind: fileKind(f),
        ext: extOf(f),
        url: `/shared/${cat}/${encodeURIComponent(f)}`,
        plays: counts[key(f)] || 0,
        artUrl: artMap ? (artMap[key(f)] ? `/data-files/album-art/${artMap[key(f)]}` : null) : undefined,
        artist: cat === 'Music' ? readArtist(path.join(dir, f), stat) : undefined,
        thumbUrl: videoThumbs ? (videoThumbs[key(f)] ? `/data-files/video-thumbs/${videoThumbs[key(f)]}` : null)
          : fileThumbs ? (fileThumbs[key(f)] ? `/data-files/file-thumbs/${fileThumbs[key(f)]}` : null)
          : undefined
      };
    })
    .sort((a, b) => b.modified - a.modified);
  res.json(files);
});

// When a file arrived on the shelf. The file's creation time on this disk
// is the honest answer -- a song copied in today keeps its original
// "modified" date from years ago, and editing its tags later bumps
// "modified" without it being new. Some disks (FAT/exFAT USB drives, a few
// network shares) don't record creation time, so those fall back to
// "modified".
function addedAt(stat) {
  return stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;
}

// Exports a shelf's file listing as a .xlsx spreadsheet -- handy for
// keeping an offline catalog, or sharing "what's on here" with someone
// who can't browse the Shelf directly. Column set adapts a little per
// category (Programs get a "Downloads" column instead of "Plays"; Music
// gets a "Has Album Art" column) since a flat one-size-fits-all sheet
// would either be missing useful info or padded with blank columns that
// don't apply.
app.get('/api/files/:category/export', (req, res) => {
  const { category } = req.params;
  if (!isValidCategory(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const dir = path.join(SHARED_ROOT, category);
  const countLabel = category === 'Programs' ? 'Downloads' : (category === 'Books' ? 'Times Read' : 'Plays');
  const counts = loadPlayCounts();
  const artMap = loadAlbumArtMap();
  const rows = fs.readdirSync(dir)
    .filter(f => !f.startsWith('.'))
    .map(f => {
      const stat = fs.statSync(path.join(dir, f));
      if (!stat.isFile()) return null;
      const row = { 'Name': f };
      if (category === 'Music') row['Artist'] = readArtist(path.join(dir, f), stat) || '';
      row['Type'] = (extOf(f) || '').toUpperCase();
      if (category !== 'Pictures') row[countLabel] = counts[`${category}/${f}`] || 0;
      row['Size (MB)'] = Math.round((stat.size / (1024 * 1024)) * 100) / 100;
      row['Date Added'] = new Date(addedAt(stat)).toLocaleString();
      row['Date Modified'] = new Date(stat.mtimeMs).toLocaleString();
      if (category === 'Music') row['Has Album Art'] = artMap[`${category}/${f}`] ? 'Yes' : 'No';
      return row;
    })
    .filter(Boolean)
    .sort((a, b) => a.Name.localeCompare(b.Name));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const widths = { 'Name': 42, 'Artist': 24, 'Type': 7, [countLabel]: 11, 'Size (MB)': 11, 'Date Added': 20, 'Date Modified': 20, 'Has Album Art': 13 };
  worksheet['!cols'] = Object.keys(rows[0] || {}).map(k => ({ wch: widths[k] || 14 }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, category.slice(0, 31)); // sheet names cap at 31 chars
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${category} list.xlsx"`);
  res.send(buffer);
});

// ---- Big Transfer: chunked large-file uploads (15-25GB and up) ----

app.get('/api/bigfiles', (req, res) => {
  const files = fs.readdirSync(BIGFILES_ROOT)
    .filter(f => !f.startsWith('.'))
    .map(f => {
      const stat = fs.statSync(path.join(BIGFILES_ROOT, f));
      return {
        name: f,
        size: stat.size,
        sizeLabel: humanSize(stat.size),
        modified: stat.mtimeMs,
        url: `/bigfiles-dl/${encodeURIComponent(f)}`
      };
    })
    .sort((a, b) => b.modified - a.modified);
  res.json(files);
});

// Starts (or resumes) a chunked upload. The client sends a stable key
// derived from the file's own name/size/last-modified time, so choosing
// the same file again after a page refresh or a dropped connection finds
// the same in-progress upload instead of starting a second copy from zero.
app.post('/api/bigfiles/start', (req, res) => {
  const { name, size, clientKey } = req.body || {};
  if (!name || typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return res.status(400).json({ error: 'A file name and size are required.' });
  }
  const safeName = sanitizeFilename(name);

  if (clientKey && bigfileUploads[clientKey] && bigfileUploads[clientKey].size === size) {
    const existing = bigfileUploads[clientKey];
    const tempPath = path.join(BIGFILES_INCOMING_DIR, existing.tempName);
    if (fs.existsSync(tempPath)) {
      return res.json({ uploadId: clientKey, name: existing.name, receivedBytes: fs.statSync(tempPath).size });
    }
  }

  const uploadId = (clientKey && String(clientKey)) || crypto.randomBytes(16).toString('hex');
  const tempName = `${crypto.randomBytes(8).toString('hex')}.part`;
  fs.closeSync(fs.openSync(path.join(BIGFILES_INCOMING_DIR, tempName), 'w'));
  bigfileUploads[uploadId] = { name: safeName, size, tempName, createdAt: Date.now() };
  saveBigfileUploads();
  res.json({ uploadId, name: safeName, receivedBytes: 0 });
});

app.get('/api/bigfiles/:uploadId/status', (req, res) => {
  const upload = bigfileUploads[req.params.uploadId];
  if (!upload) return res.status(404).json({ error: 'No upload in progress with that id.' });
  const tempPath = path.join(BIGFILES_INCOMING_DIR, upload.tempName);
  const receivedBytes = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0;
  res.json({ receivedBytes, size: upload.size, name: upload.name });
});

// A single chunk, streamed straight to disk at the given byte offset --
// never buffered fully in memory, so this behaves the same whether a
// chunk is 10MB or 2GB. The client always says what offset it thinks
// it's writing at; if that doesn't match what's actually on disk (a
// retried chunk, a race from two tabs, whatever), the write is refused
// and the real offset handed back instead of risking a corrupted file.
app.post('/api/bigfiles/:uploadId/chunk', (req, res) => {
  const upload = bigfileUploads[req.params.uploadId];
  if (!upload) return res.status(404).json({ error: 'No upload in progress with that id.' });

  const tempPath = path.join(BIGFILES_INCOMING_DIR, upload.tempName);
  const offset = parseInt(req.query.offset, 10);
  const currentSize = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0;
  if (!Number.isFinite(offset) || offset !== currentSize) {
    return res.status(409).json({ error: 'Offset mismatch.', receivedBytes: currentSize });
  }

  const writeStream = fs.createWriteStream(tempPath, { flags: 'r+', start: offset });
  let settled = false;
  const finish = (status, body) => {
    if (settled) return;
    settled = true;
    res.status(status).json(body);
  };

  req.on('error', () => { writeStream.destroy(); finish(400, { error: 'Upload connection dropped.' }); });
  writeStream.on('error', (err) => {
    finish(err.code === 'ENOSPC' ? 507 : 500, { error: 'Could not write to disk.' });
  });
  writeStream.on('finish', () => finish(200, { receivedBytes: fs.statSync(tempPath).size }));
  req.pipe(writeStream);
});

// Finalizes a completed upload: confirms every byte actually arrived, then
// moves it out of the temp/incoming area into the real Big Transfer folder.
app.post('/api/bigfiles/:uploadId/complete', (req, res) => {
  const upload = bigfileUploads[req.params.uploadId];
  if (!upload) return res.status(404).json({ error: 'No upload in progress with that id.' });

  const tempPath = path.join(BIGFILES_INCOMING_DIR, upload.tempName);
  const actualSize = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : -1;
  if (actualSize !== upload.size) {
    return res.status(400).json({
      error: `Only ${humanSize(Math.max(actualSize, 0))} of ${humanSize(upload.size)} has arrived so far -- keep uploading before completing.`
    });
  }

  let finalName = upload.name;
  let counter = 1;
  const ext = path.extname(finalName);
  const base = path.basename(finalName, ext);
  while (fs.existsSync(path.join(BIGFILES_ROOT, finalName))) {
    finalName = `${base} (${counter})${ext}`;
    counter++;
  }
  fs.renameSync(tempPath, path.join(BIGFILES_ROOT, finalName));
  delete bigfileUploads[req.params.uploadId];
  saveBigfileUploads();
  res.json({ name: finalName, size: upload.size });
});

// Cancels an in-progress upload and deletes its partial data.
app.delete('/api/bigfiles/:uploadId', (req, res) => {
  const upload = bigfileUploads[req.params.uploadId];
  if (!upload) return res.status(404).json({ error: 'No upload in progress with that id.' });
  try { fs.unlinkSync(path.join(BIGFILES_INCOMING_DIR, upload.tempName)); } catch { /* already gone */ }
  delete bigfileUploads[req.params.uploadId];
  saveBigfileUploads();
  res.json({ cancelled: true });
});

// Deletes a completed file from the Big Transfer folder.
app.delete('/api/bigfiles/file/:name', (req, res) => {
  const safeName = sanitizeFilename(decodeURIComponent(req.params.name));
  const filePath = path.join(BIGFILES_ROOT, safeName);
  if (!filePath.startsWith(BIGFILES_ROOT) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  fs.unlinkSync(filePath);
  res.json({ deleted: safeName });
});

// Records a play (Music/Videos/Games) or download (Programs) for a file.
// Fire-and-forget from the frontend's perspective — the count is a nice-to-
// have, not something worth blocking or erroring the user's experience over.
app.post('/api/files/:category/:name/play', (req, res) => {
  const { category, name } = req.params;
  if (!isValidCategory(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const safeName = sanitizeFilename(decodeURIComponent(name));
  const filePath = path.join(SHARED_ROOT, category, safeName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  const plays = incrementPlayCount(category, safeName);
  res.json({ plays });
});

// Saves an edited photo from the in-browser editor (rotate/flip/color
// adjustments) — either overwriting the original file or saving alongside
// it as a new copy.
app.post('/api/files/:category/:name/edit', (req, res) => {
  const { category, name } = req.params;
  if (category !== 'Pictures') {
    return res.status(400).json({ error: 'Only pictures can be edited this way.' });
  }
  const safeName = sanitizeFilename(decodeURIComponent(name));
  const filePath = path.join(SHARED_ROOT, category, safeName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const { imageData, saveAs } = req.body || {};
  const match = typeof imageData === 'string' && imageData.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid image data' });
  }
  let buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch {
    return res.status(400).json({ error: 'Could not decode image data' });
  }
  if (buffer.length === 0 || buffer.length > 20 * 1024 * 1024) {
    return res.status(400).json({ error: 'Edited image is too large to save.' });
  }

  if (saveAs === 'copy') {
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);
    let finalName = `${base} (edited)${ext}`;
    let counter = 1;
    while (fs.existsSync(path.join(SHARED_ROOT, category, finalName))) {
      finalName = `${base} (edited ${counter})${ext}`;
      counter++;
    }
    fs.writeFileSync(path.join(SHARED_ROOT, category, finalName), buffer);
    return res.json({ saved: finalName, mode: 'copy' });
  }

  fs.writeFileSync(filePath, buffer);
  res.json({ saved: safeName, mode: 'overwrite' });
});

// ---- Music name/tag standardization ----
// A from-scratch port of a reference desktop tool's parsing rules: rather
// than just mashing separators into spaces, this tries to actually split a
// messy filename into a real Artist / Title / Track guess, protecting known
// multi-word artist names from being split apart, stripping downloader/video
// junk at the word level, and smart-titlecasing the result. Existing ID3-style
// tags on the file always outrank a filename guess (a file that's already
// properly tagged is trusted over whatever its filename happens to say), and
// the guessed/confirmed artist, title and track are written back into the
// file's own tags as well as into its new filename, so the metadata travels
// with the file. A guess the parser isn't confident about gets one best-effort
// iTunes lookup to try to correct it before anything is written.

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// raw (lowercased, words separated by any of space/underscore/hyphen) ->
// canonical display form. Protects names that naive delimiter-splitting
// would otherwise mangle (AC/DC, Jay-Z, ...) or names commonly written with
// spaces instead of punctuation in download-site filenames.
const ARTIST_WHITELIST = {
  'ac-dc': 'AC/DC',
  'jay-z': 'JAY-Z',
  't-pain': 'T-Pain',
  'kool-and-the-gang': 'Kool & The Gang',
  'twenty-one-pilots': 'Twenty One Pilots',
  'wu-tang-clan': 'Wu-Tang Clan',
  'salt-n-pepa': 'Salt-N-Pepa',
  'florence-and-the-machine': 'Florence + the Machine',
  'aerosmith': 'Aerosmith',
  'alex-warren': 'Alex Warren',
  'april-wine': 'April Wine',
  'billy-joel': 'Billy Joel',
  'bon-jovi': 'Bon Jovi',
  'creedence-clearwater-revival': 'Creedence Clearwater Revival',
  'dire-straits': 'Dire Straits',
  'guess-who': 'The Guess Who',
  'the-guess-who': 'The Guess Who',
  'bill-medley-jennifer-warnes': 'Bill Medley & Jennifer Warnes',
  'dolly-parton-kenny-rogers': 'Dolly Parton & Kenny Rogers',
  'glen-campbell-carl-jackson': 'Glen Campbell & Carl Jackson',
  // Common two-word artist names -- without one of these, a filename whose
  // *raw* hyphen happens to fall between an artist's first and last name
  // (e.g. "Taylor - Swift Wildest Dreams" instead of "Taylor Swift -
  // Wildest Dreams") gets mis-split into artist "Taylor" / title "Swift
  // Wildest Dreams", since nothing else marks "Taylor Swift" as one name.
  'taylor-swift': 'Taylor Swift',
  'katy-perry': 'Katy Perry',
  'sam-smith': 'Sam Smith',
  'ariana-grande': 'Ariana Grande',
  'justin-bieber': 'Justin Bieber',
  'selena-gomez': 'Selena Gomez',
  'demi-lovato': 'Demi Lovato',
  'shawn-mendes': 'Shawn Mendes',
  'ed-sheeran': 'Ed Sheeran',
  'bruno-mars': 'Bruno Mars',
  'billie-eilish': 'Billie Eilish',
  'dua-lipa': 'Dua Lipa',
  'olivia-rodrigo': 'Olivia Rodrigo',
  'miley-cyrus': 'Miley Cyrus',
  'lady-gaga': 'Lady Gaga',
  'nicki-minaj': 'Nicki Minaj',
  'kari-jobe': 'Kari Jobe',
  'cody-carnes': 'Cody Carnes',
  'elevation-worship': 'Elevation Worship',
  'hillsong-worship': 'Hillsong Worship',
  'chris-tomlin': 'Chris Tomlin',
  'phil-wickham': 'Phil Wickham',
};

// Downloader tools that sanitize filenames typically strip apostrophes
// entirely, but they usually leave the letter(s) that followed it behind
// as their own separate word -- "Taylor's" becomes "Taylor S", "I'm"
// becomes "I M", "Don't" becomes "Don T". Reassembling these (rather than
// leaving the stray letter dangling, or discarding it and quietly losing
// meaning) recovers real title text that would otherwise look like junk.
const CONTRACTION_SUFFIXES = new Set(['s', 't', 'd', 'm', 're', 've', 'll']);

// Runs after the per-token junk filtering below, on whatever tokens
// survived it. Two passes: first, glue a trailing contraction fragment
// back onto the real word in front of it ("Taylor" + "S" -> "Taylor's");
// then drop any single-letter token still left on its own (aside from the
// real one-letter words "I" and "A") -- a lone "S" or "T" with nothing in
// front of it to attach to, or a lone "J"/"Z"/etc. that was never a
// contraction fragment at all, is essentially always debris (either an
// unattachable contraction remnant or a chopped-up ID/site token), never a
// genuine word.
function mergeContractionsAndDropStray(tokens) {
  const merged = [];
  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (merged.length && CONTRACTION_SUFFIXES.has(low) && /^[A-Za-z]+$/.test(merged[merged.length - 1])) {
      merged[merged.length - 1] = merged[merged.length - 1] + "'" + low;
      continue;
    }
    merged.push(tok);
  }
  return merged.filter(t => !(/^[A-Za-z]$/.test(t) && !/^[ia]$/i.test(t)));
}

// junk tokens commonly injected by downloader sites (case-insensitive)
const JUNK_SITE_TOKENS = new Set([
  'ytdown.com', 'ytdown', 'youtube', 'y2mate', 'savefrom.net', 'savefrom',
  'snaptube', 'videoder', 'ytmp3', 'mp3juices', 'ssyoutube', 'media',
  'yt1s.com', 'yt1s', 'onlinevideoconverter', 'downloader',
]);

// descriptor words that belong to the *video*, not the song
const JUNK_DESCRIPTOR_WORDS = new Set([
  'official', 'video', 'audio', 'hd', 'hq', '4k', '2k', '8k', 'lyrics', 'lyric',
  'visualizer', 'mv', 'live', 'remastered', 'remaster', 'upgrade', 'full', 'version', 'clip',
  'explicit', 'clean', 'topic', 'records', 'vevo', 'music', 'song',
  'cover', 'singer',
]);

// words that shouldn't be capitalized mid-title (unless first word)
const LOWERCASE_WORDS = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
  'for', 'feat', 'ft', 'vs', 'with',
]);

const BITRATE_RE = /^\d{2,4}k(bps)?$/i;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{10,12}$/;
const TRACK_NUM_RE = /^\d{1,3}$/;

function looksLikeVideoId(token) {
  if (!VIDEO_ID_RE.test(token)) return false;
  const hasUpper = /[A-Z]/.test(token);
  const hasLower = /[a-z]/.test(token);
  const hasDigit = /[0-9]/.test(token);
  return hasUpper && hasLower && hasDigit;
}

// Replaces whitelisted artist names with a placeholder so they survive
// naive hyphen-splitting, returning [protectedSegment, mapping]. Matches
// regardless of whether the source filename uses hyphens, spaces, or
// underscores between words -- "AC DC", "AC-DC", and "AC_DC" all match a
// whitelist entry written as "ac-dc".
function protectWhitelisted(segment, whitelist) {
  const mapping = {};
  const entries = Object.entries(whitelist).sort((a, b) => b[0].length - a[0].length);
  entries.forEach(([raw, canon], i) => {
    const parts = raw.split(/[\s_-]+/).filter(Boolean).map(escapeRegex);
    if (!parts.length) return;
    const pattern = new RegExp('\\b' + parts.join('[\\s_-]*') + '\\b', 'i');
    const match = pattern.exec(segment);
    if (match) {
      const placeholder = `\x00${i}\x00`;
      mapping[placeholder] = canon;
      segment = segment.slice(0, match.index) + placeholder + segment.slice(match.index + match[0].length);
    }
  });
  return [segment, mapping];
}

function isUpperWord(w) {
  return /[A-Z]/.test(w) && w === w.toUpperCase() && !/[a-z]/.test(w);
}
function isLowerWord(w) {
  return /[a-z]/.test(w) && w === w.toLowerCase() && !/[A-Z]/.test(w);
}

function smartTitlecase(text) {
  const words = text.split(' ');
  const out = [];
  words.forEach((w, i) => {
    if (!w) return;
    if (i > 0 && LOWERCASE_WORDS.has(w.toLowerCase())) {
      out.push(w.toLowerCase());
    } else if (isUpperWord(w) && w.length <= 4) {
      out.push(w); // keep short acronyms like DJ, MC, HD as-is
    } else if (isLowerWord(w) || isUpperWord(w)) {
      out.push(w.slice(0, 1).toUpperCase() + w.slice(1).toLowerCase());
    } else {
      out.push(w);
    }
  });
  return out.join(' ');
}

// Parses a messy filename stem into { artist, title, track, confidence }
// ("high" | "low"), following the same rules as the reference tool: strip
// known junk tokens, protect whitelisted artist names before splitting on
// hyphens, strip descriptor words at the word level, then smart-titlecase
// what's left.
// Bracketed bits that only describe the upload, never the song:
// "(Official Video)", "[HD]", "(Lyrics)", "(Official Music Video 4K)".
// Bracketed bits that ARE part of the song's name -- "(Live)", "(feat. X)",
// "(Taylor's Version)", "(Clean Version)", "(Day-O)" -- don't match,
// because every word inside has to be one of these.
const UPLOAD_ONLY_WORDS = new Set(['official', 'music', 'video', 'audio', 'lyric', 'lyrics', 'hd', 'hq',
  '4k', '1080p', '720p', 'visualizer', 'mv', 'remastered', 'remaster', 'explicit', 'vevo', 'topic', 'with']);
function stripUploadBrackets(text) {
  return text.replace(/\s*[\(\[]([^\)\]]*)[\)\]]/g, (whole, inner) => {
    const words = inner.toLowerCase().split(/[\s\/,&+-]+/).filter(Boolean);
    return words.length && words.every(w => UPLOAD_ONLY_WORDS.has(w) || /^\d{4}$/.test(w)) ? '' : whole;
  }).replace(/\s{2,}/g, ' ').trim();
}

// A name that's already "Artist - Title" (spaces around the dash) with no
// downloader debris in it is left exactly as written. The word-by-word
// cleanup below is for messy download names; run on a tidy one it used
// to do damage -- "Deee-Lite" became "Deee - Lite", "Un-Break My Heart"
// lost its hyphen, "(feat. JAY-Z)" turned JAY-Z into the artist,
// "Pt. 2" lost the 2. Returns null when the name isn't tidy.
function parseTidyName(stem) {
  const text = stem.includes(' ') ? stem : stem.replace(/_/g, ' ');
  const tokens = text.split(/\s+/).filter(Boolean);
  const debris = tokens.some(t => {
    const low = t.toLowerCase().replace(/[()\[\]]/g, '');
    return JUNK_SITE_TOKENS.has(low) || BITRATE_RE.test(low) || looksLikeVideoId(t) || /_/.test(t) || /^0\d{1,2}$/.test(t);
  });
  if (debris) return null;
  const cleaned = stripUploadBrackets(text);
  const at = cleaned.indexOf(' - ');
  if (at <= 0) return null;
  // All-lowercase ("the weeknd - blinding lights") gets capitalized;
  // anything with capitals in it is left as the person wrote it.
  const fixCase = (x) => isLowerWord(x.replace(/[^A-Za-z]/g, '')) ? smartTitlecase(x) : x;
  const artist = fixCase(cleaned.slice(0, at).trim());
  const title = fixCase(cleaned.slice(at + 3).trim());
  if (!artist || !title) return null;
  const result = `${artist} - ${title}`;
  return { artist, title, track: '', confidence: 'high (tidy name)', tidy: true, changed: result !== stem, tidyName: result };
}

function cleanStem(stem, whitelist) {
  const tidy = parseTidyName(stem);
  if (tidy) return tidy;
  stem = stripUploadBrackets(stem.replace(/_/g, ' ')).replace(/ /g, '_');
  const tokens = stem.split(/[\s_]+/).map(t => t.trim()).filter(Boolean);
  let trackGuess = '';
  let meaningfulTokens = [];

  // A bare 1-3 digit number is only treated as a downloader-added track
  // number when it sits at the very front or back of the filename --
  // that's where a real sequence number actually shows up ("001_Song",
  // "Song_009"). A number buried in the middle is overwhelmingly part of
  // the real title itself ("All Too Well (10 Minute Version)", "99
  // Luftballons", "2 Become 1"), so treating it as a track number there
  // would silently swallow real title text instead of junk.
  tokens.forEach((t, idx) => {
    const low = t.toLowerCase();
    if (JUNK_SITE_TOKENS.has(low)) return;
    if (BITRATE_RE.test(t)) return;
    if (looksLikeVideoId(t)) return;
    if (looksLikeJunkIdFragment(t)) return;
    // "009", "012": a downloader's counter (the leading zero gives it away),
    // wherever it lands -- it's often followed by a bitrate, so it isn't
    // necessarily the very last word.
    if (/^0\d{1,2}$/.test(t)) return;
    if (TRACK_NUM_RE.test(t) && !trackGuess && (idx === 0 || idx === tokens.length - 1)) {
      trackGuess = String(parseInt(t, 10));
      return;
    }
    meaningfulTokens.push(t);
  });

  meaningfulTokens = mergeContractionsAndDropStray(meaningfulTokens);

  if (!meaningfulTokens.length) {
    return {
      artist: '',
      title: smartTitlecase(stem.replace(/_/g, ' ').replace(/-/g, ' ')),
      track: trackGuess,
      confidence: 'low',
    };
  }

  const joined = meaningfulTokens.join(' ');
  const [protectedStr, mapping] = protectWhitelisted(joined, whitelist);

  const placeholders = Object.keys(mapping);
  const delimPattern = placeholders.length
    ? new RegExp('-|(' + placeholders.map(escapeRegex).join('|') + ')')
    : /-/;
  const rawParts = protectedStr.split(delimPattern).filter(p => p && p.trim());

  const cleanParts = [];
  let artistFromWhitelist = null;
  for (let p of rawParts) {
    p = p.trim();
    if (Object.prototype.hasOwnProperty.call(mapping, p)) {
      artistFromWhitelist = mapping[p];
      cleanParts.push(mapping[p]);
      continue;
    }
    const words = p.split(' ').filter(w => w.trim() && !JUNK_DESCRIPTOR_WORDS.has(w.toLowerCase()));
    const cleaned = words.join(' ').trim();
    if (cleaned) cleanParts.push(cleaned);
  }

  let artist = '', title = '', confidence = 'low';
  if (artistFromWhitelist) {
    artist = artistFromWhitelist;
    const titleParts = cleanParts.filter(p => p !== artistFromWhitelist);
    title = titleParts.length ? smartTitlecase(titleParts.join(' ')) : '';
    confidence = 'high';
  } else if (joined.includes(' - ') || cleanParts.length === 1) {
    if (cleanParts.length >= 2) {
      artist = smartTitlecase(cleanParts[0]);
      title = smartTitlecase(cleanParts.slice(1).join(' '));
    } else {
      title = cleanParts.length ? smartTitlecase(cleanParts[0]) : '';
    }
  } else {
    artist = cleanParts.length ? smartTitlecase(cleanParts[0]) : '';
    title = cleanParts.length > 1 ? smartTitlecase(cleanParts.slice(1).join(' ')) : '';
  }

  // Never "discover" our own placeholder text as a real artist name -- if a
  // previously-renamed file using "Unknown Artist" as filler gets rescanned,
  // treat that leftover placeholder the same as no artist found at all.
  if (artist.trim().toLowerCase() === 'unknown artist') {
    artist = '';
    confidence = 'low';
  }

  return { artist, title, track: trackGuess, confidence };
}

function buildProposedFilename(artist, title, track, extWithDot, pattern) {
  let core = pattern
    .replace('{artist}', artist || '')
    .replace('{title}', title || 'Unknown Title')
    .replace('{track}', track ? String(track).padStart(2, '0') : '00');
  // An empty {artist} leaves behind stray separators from the pattern --
  // clean those up rather than papering over an unknown artist with a fake
  // "Unknown Artist" name.
  core = core.replace(/^\s*-\s*/, '');
  core = core.replace(/\s*-\s*-\s*/, ' - ');
  core = core.replace(/\s*-\s*$/, '');
  core = core.trim();
  // A "/" here is a legitimate character in an artist name (AC/DC) rather
  // than a directory separator, but sanitizeFilename uses path.basename()
  // to strip directory components -- which would otherwise treat that "/"
  // as a path and silently truncate everything before it. Swap it for a
  // dash first, same as the reference tool does.
  core = core.replace(/\//g, '-');
  return sanitizeFilename(core + extWithDot.toLowerCase());
}

// Reads just artist/title/track, format-agnostic the same way readArtist
// is -- an untagged file, or one taglib can't parse, just comes back empty
// rather than failing the whole operation.
function readMusicTags(filePath) {
  let file;
  try {
    file = TagLib.File.createFromPath(filePath);
    const tag = file.tag;
    let artist = (tag.performers && tag.performers[0]) ? tag.performers[0].trim() : '';
    const title = tag.title ? String(tag.title).trim() : '';
    const album = tag.album ? String(tag.album).trim() : '';
    const track = tag.track ? String(tag.track) : '';
    // Some taggers/rippers write literal "Unknown Artist" for unidentified
    // tracks -- treat that the same as no artist tag at all, so it doesn't
    // get "trusted" as a real, confidently-tagged artist name.
    if (artist.toLowerCase() === 'unknown artist') artist = '';
    return { artist, title, album, track };
  } catch {
    return { artist: '', title: '', album: '', track: '' };
  } finally {
    if (file) file.dispose();
  }
}

// Writes artist/title/album/track into the file's own tag, using whichever
// underlying tag format taglib picks for that extension. Existing album
// art and any other tags are left untouched.
//
// Two different callers need two different behaviors for an empty value:
// the automatic filename-guessing path (standardize-names) only ever fills
// in a *guess*, so an empty guess should leave whatever's already tagged
// alone -- that's the default here. The manual tag editor, on the other
// hand, lets someone deliberately clear a field (e.g. blank out a wrong
// album name), where an empty string has to actually win and clear the
// tag -- that's what allowClear turns on.
function writeMusicTags(filePath, { artist, title, album, track }, allowClear = false) {
  let file;
  try {
    file = TagLib.File.createFromPath(filePath);
    if (artist || allowClear) file.tag.performers = artist ? [artist] : [];
    if (title || allowClear) file.tag.title = title || '';
    if (album || allowClear) file.tag.album = album || '';
    if (track || allowClear) {
      const n = parseInt(track, 10);
      file.tag.track = Number.isNaN(n) ? 0 : n;
    }
    file.save();
    return true;
  } catch {
    return false;
  } finally {
    if (file) file.dispose();
  }
}

// Builds the full Artist/Title/Track/filename proposal for one music file:
// the filename is parsed into a guess, existing tags (if any) override that
// guess field-by-field, and confidence is upgraded to reflect that trust.
function buildMusicProposal(filePath, filename, whitelist) {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';

  const tags = readMusicTags(filePath);
  const guess = cleanStem(stem, whitelist);

  // Already tidy: keep the name (apart from dropping "(Official Video)"-type
  // bits) and only fill in tags that are missing -- never overwrite good
  // tags from the filename, or rename a tidy file to match its tags.
  if (guess.tidy) {
    const proposedFilename = guess.changed ? sanitizeFilename(`${guess.tidyName}${ext.toLowerCase()}`) : filename;
    return {
      artist: tags.artist.trim() ? '' : guess.artist,
      title: tags.title.trim() ? '' : guess.title,
      track: '',
      confidence: guess.confidence,
      proposedFilename,
    };
  }

  const finalArtist = tags.artist.trim() || guess.artist;
  const finalTitle = tags.title.trim() || guess.title;
  const finalTrack = tags.track.trim() || guess.track;
  let confidence = guess.confidence;
  if (tags.artist.trim() && tags.title.trim()) confidence = 'high (from existing tags)';

  const proposedFilename = buildProposedFilename(finalArtist, finalTitle, finalTrack, ext, '{artist} - {title}');

  return { artist: finalArtist, title: finalTitle, track: finalTrack, confidence, proposedFilename };
}

// Best-effort correction for a low-confidence guess: searches the raw guess
// text against iTunes' free public API (no key needed) and, on a match,
// returns its real artist/title. Returns null on no match, no network, or
// any request failure -- callers should treat that as "couldn't resolve it",
// not an error, and just keep the filename-based guess.
async function lookupTrackOnline(query) {
  const q = (query || '').trim();
  if (!q) return null;
  try {
    // Shares itunesSearch's rate limiter/backoff with the album-art fetch
    // below, since both hit the same rate-limited endpoint -- without that
    // they'd race each other for the same budget and both start failing.
    const data = await itunesSearch(q);
    const r = data.results && data.results[0];
    if (!r) return null;
    const artist = (r.artistName || '').trim();
    const title = (r.trackName || '').trim();
    if (!artist || !title) return null;
    return { artist, title };
  } catch (err) {
    console.error(`[standardize-names online lookup] "${q}": ${err.message}`);
    return null;
  }
}

// ---- Video filename standardization ----
// Cleans up the messy filenames that download tools tend to produce, e.g.
// "YTDown.com_YouTube_Teddy-Swims-Lose-Control-The-Village-Ses_Media_9gWlllr2Asw_001_1080p.mp4"
// or "Media_xo1VInw-SKc_Rachel-Platten-Fight-Song_001_1080p.mp4" both become
// "Teddy Swims Lose Control The Village Ses.mp4" / "Rachel Platten Fight
// Song.mp4". This reuses the same word-level approach as Music's parser
// above (strip known junk site tokens, video-ID-shaped tokens, sequence
// numbers and quality suffixes, then smart-titlecase what's left) instead
// of the older version's one rigid, position-anchored regex -- different
// downloader tools put "Media"/the id/the sequence number in different
// places in the filename (front, back, middle), and the old regex only
// ever matched one specific shape. Videos don't carry artist/title tags
// the way music does, so unlike Music above this only cleans up the
// filename itself and doesn't try to split out an "artist" -- hyphens and
// the original title get flattened together by these tools with no way to
// perfectly recover which hyphens were originally spaces, so this is a
// readable best effort, not a perfect reconstruction.

const VIDEO_QUALITY_RE = /^\d{3,4}p$/i; // 1080p, 720p, 480p, ...
const VIDEO_SEQUENCE_RE = /^0\d{1,2}$/; // zero-padded sequence numbers like "001", "007" -- a leading zero is the signal this is a downloader-added counter rather than a meaningful number in the title (e.g. "2 Fast 2 Furious" survives)

// Catches a shorter, mangled fragment of what was originally one longer
// video-ID token -- some downloader filenames get the true 11-character ID
// split apart by an earlier separator-to-space conversion (a hyphen INSIDE
// the id, e.g. "xo1VInw-SKc", becomes two separate tokens once hyphens are
// treated as word breaks). A digit mixed with a letter is an immediate
// giveaway -- that combination essentially never occurs in a real title
// word, but is exactly what an ID fragment looks like. A token that's
// PURELY digits, though, is a different animal: that's just a number, and
// plenty of real titles have one ("2000 Miles", "99 Luftballons", "2 Fast
// 2 Furious"), so it's left for the more specific numeric rules elsewhere
// (track/sequence-number detection) to judge instead of being nuked here.
// Otherwise, this deliberately stops short of "any internal capital
// letter" -- real capitalized-compound words and band names (OneRepublic,
// iPhone, YouTube, PayPal, McDonald) always have exactly ONE internal
// capital and never two in a row, so only two-or-more internal capitals,
// or two capitals back-to-back, count as junk -- and only for a token
// that's genuinely mixed case, so a short all-caps word (DJ, HD, UK) is
// never caught by this at all.
function looksLikeJunkIdFragment(token) {
  if (token.length < 2 || token.length > 12) return false;
  if (/\d/.test(token) && /[A-Za-z]/.test(token)) return true;
  if (!/[A-Z]/.test(token) || !/[a-z]/.test(token)) return false; // not mixed case -- a normal short word/acronym, not a fragment
  const internalUpperCount = (token.slice(1).match(/[A-Z]/g) || []).length;
  // A very short (<=3 char) mixed-case token with even one internal
  // capital is treated as junk too -- there's essentially no common real
  // word or name that short with a stray internal capital (a real short
  // acronym is caught by the all-caps check above instead), whereas it's
  // exactly the shape a video ID gets chopped into (e.g. "nYh").
  return internalUpperCount >= 2 || /[A-Z]{2,}/.test(token) || (token.length <= 3 && internalUpperCount >= 1);
}

// A subset of JUNK_DESCRIPTOR_WORDS with the borderline ones removed --
// "song", "cover", "singer" and "music" show up often enough as genuine
// words within a real video title (Rachel Platten's "Fight Song", a
// "Landslide cover", ...) that stripping them here would do more harm than
// good, even though they're safe to treat as pure filler for Music above
// (where they're overwhelmingly a downloader-added descriptor, not part
// of the track's actual name).
const VIDEO_JUNK_DESCRIPTOR_WORDS = new Set(
  [...JUNK_DESCRIPTOR_WORDS].filter(w => !['song', 'cover', 'singer', 'music'].includes(w))
);

function cleanVideoStem(stem) {
  // Split on underscores, hyphens, AND whitespace -- different downloader
  // tools use any of these as the separator, and a file that already went
  // through an earlier, less thorough cleanup pass may have some
  // separators already converted to spaces.
  const tokens = stem.split(/[\s_-]+/);
  const meaningful = [];

  for (const tok of tokens) {
    const t = tok.trim();
    if (!t) continue;
    const low = t.toLowerCase();
    if (JUNK_SITE_TOKENS.has(low)) continue;
    if (BITRATE_RE.test(t)) continue;
    if (VIDEO_QUALITY_RE.test(t)) continue;
    if (VIDEO_SEQUENCE_RE.test(t)) continue;
    if (looksLikeVideoId(t)) continue;
    if (looksLikeJunkIdFragment(t)) continue;
    if (VIDEO_JUNK_DESCRIPTOR_WORDS.has(low)) continue;
    meaningful.push(t);
  }

  const cleaned = mergeContractionsAndDropStray(meaningful);
  return cleaned.length ? smartTitlecase(cleaned.join(' ')) : '';
}

function standardizeFilename(originalName) {
  const dot = originalName.lastIndexOf('.');
  const rawBase = dot > 0 ? originalName.slice(0, dot) : originalName;
  const rawExt = dot > 0 ? originalName.slice(dot + 1).toLowerCase() : '';
  const cleanBase = cleanVideoStem(rawBase) || 'Untitled';
  return sanitizeFilename(rawExt ? `${cleanBase}.${rawExt}` : cleanBase);
}

// Bulk-renames every file in a category to its standardized name. Skips
// anything that's already clean (no-op) or that would collide with an
// existing file, and carries play counts along to the new name.
// Streams progress the same way fetch-album-art does above, for the same
// reason: a big library takes real time to get through and a single
// all-at-once response left the button looking frozen with no way to tell
// it apart from an actual hang.
app.post('/api/files/:category/standardize-names', async (req, res) => {
  const { category } = req.params;
  if (!isValidCategory(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  // Off by default -- see the note above the low-confidence branch below
  // for why this can't just always be on.
  const onlineLookup = req.query.onlineLookup === 'true';

  res.setHeader('Content-Type', 'application/x-ndjson');
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  const dir = path.join(SHARED_ROOT, category);
  const files = fs.readdirSync(dir).filter(f => !f.startsWith('.'));
  const existingLower = new Set(files.map(f => f.toLowerCase()));

  const renamed = [];
  const skipped = [];

  // Claims a non-colliding version of `target`, including against another
  // file this same pass is about to produce.
  function claimTarget(target, originalName) {
    if (existingLower.has(target.toLowerCase()) && target.toLowerCase() !== originalName.toLowerCase()) {
      const ext = path.extname(target);
      const base = path.basename(target, ext);
      let counter = 1;
      let candidate = target;
      while (existingLower.has(candidate.toLowerCase())) {
        candidate = `${base} (${counter})${ext}`;
        counter++;
      }
      target = candidate;
    }
    return target;
  }

  if (category === 'Music') {
    const musicFiles = files.filter(f => MUSIC_EXT.has(extOf(f)));
    let corrected = 0;

    for (let i = 0; i < musicFiles.length; i++) {
      const name = musicFiles[i];
      const filePath = path.join(dir, name);

      if (isNameLocked(category, name)) {
        send({ type: 'progress', index: i, total: musicFiles.length, name, status: 'skipped — manually renamed' });
        continue;
      }

      let proposal;
      try {
        proposal = buildMusicProposal(filePath, name, ARTIST_WHITELIST);
      } catch (err) {
        skipped.push({ name, reason: err.message });
        send({ type: 'progress', index: i, total: musicFiles.length, name, status: 'error' });
        continue;
      }

      // "Low confidence" just means no whitelist match and no existing
      // tags -- for a library of ordinary, not-pre-tagged music that's
      // effectively every track, not a rare edge case. Looking each of
      // those up online is capped by iTunes' rate limit (~18/min), so
      // turning it on for a few hundred tracks turns a few-second local
      // rename into a many-minutes network operation -- worth doing on
      // request, not silently on every run. It stays fully opt-in
      // (?onlineLookup=true) until there's a UI control for it.
      if (onlineLookup && proposal.confidence === 'low') {
        send({ type: 'progress', index: i, total: musicFiles.length, name, status: 'looking up online…' });
        const query = `${proposal.artist} ${proposal.title}`.trim() || path.basename(name, path.extname(name));
        const found = await lookupTrackOnline(query);
        if (found) {
          proposal.artist = found.artist;
          proposal.title = found.title;
          proposal.confidence = 'high (online match)';
          proposal.proposedFilename = buildProposedFilename(found.artist, found.title, proposal.track, path.extname(name), '{artist} - {title}');
          corrected++;
        }
        // A light pause between lookups -- courteous to a free API.
        await new Promise(r => setTimeout(r, 150));
      }

      writeMusicTags(filePath, { artist: proposal.artist, title: proposal.title, track: proposal.track });

      let target = proposal.proposedFilename;
      if (target === name) {
        send({ type: 'progress', index: i, total: musicFiles.length, name, status: 'already clean' });
        continue;
      }

      target = claimTarget(target, name);

      try {
        fs.renameSync(filePath, path.join(dir, target));
        existingLower.delete(name.toLowerCase());
        existingLower.add(target.toLowerCase());
        migratePlayCount(category, name, category, target);
        migrateAlbumArt(category, name, category, target);
        migrateVideoThumb(category, name, category, target);
        migrateFileThumb(category, name, category, target);
        renamed.push({ from: name, to: target });
        send({ type: 'progress', index: i, total: musicFiles.length, name, status: `renamed to "${target}"` });
      } catch (err) {
        skipped.push({ name, reason: err.message });
        send({ type: 'progress', index: i, total: musicFiles.length, name, status: 'error' });
      }
    }

    send({ type: 'done', renamedCount: renamed.length, renamed, skipped, correctedCount: corrected, checkedCount: musicFiles.length });
    return res.end();
  }

  for (let i = 0; i < files.length; i++) {
    const name = files[i];

    if (isNameLocked(category, name)) {
      send({ type: 'progress', index: i, total: files.length, name, status: 'skipped — manually renamed' });
      continue;
    }

    let target = standardizeFilename(name);
    if (target === name) {
      send({ type: 'progress', index: i, total: files.length, name, status: 'already clean' });
      continue;
    }

    target = claimTarget(target, name);

    try {
      fs.renameSync(path.join(dir, name), path.join(dir, target));
      existingLower.delete(name.toLowerCase());
      existingLower.add(target.toLowerCase());
      migratePlayCount(category, name, category, target);
      migrateAlbumArt(category, name, category, target);
      migrateVideoThumb(category, name, category, target);
      migrateFileThumb(category, name, category, target);
      renamed.push({ from: name, to: target });
      send({ type: 'progress', index: i, total: files.length, name, status: `renamed to "${target}"` });
    } catch (err) {
      skipped.push({ name, reason: err.message });
      send({ type: 'progress', index: i, total: files.length, name, status: 'error' });
    }
  }

  send({ type: 'done', renamedCount: renamed.length, renamed, skipped, checkedCount: files.length });
  res.end();
});

// Finds files with byte-identical content within a shelf and removes all
// but one copy of each -- grouped by a hash of the actual file content,
// not by name, so two genuinely different files are never touched even
// if their names happen to look similar, and conversely two identical
// files ARE caught even if they were named completely differently. A
// cheap size comparison runs first to rule out obviously-different files
// before bothering to hash anything, since hashing is the expensive part
// (especially for large videos). Within each duplicate group, the file
// with the shortest name is kept (a second download or drag-and-drop of
// the same file usually ends up with a "(1)" or "copy" suffix, so the
// plain original name is usually the shortest), ties broken
// alphabetically, and the rest are removed the same way a normal delete
// works -- including cleaning up their play counts, album art, and
// thumbnails.
app.post('/api/files/:category/remove-duplicates', async (req, res) => {
  const { category } = req.params;
  if (!isValidCategory(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const dir = path.join(SHARED_ROOT, category);
  const files = fs.readdirSync(dir).filter(f => !f.startsWith('.'));

  const sizeGroups = {};
  for (const name of files) {
    const size = fs.statSync(path.join(dir, name)).size;
    (sizeGroups[size] ||= []).push(name);
  }

  const removed = [];
  let groupsFound = 0;

  for (const size of Object.keys(sizeGroups)) {
    const candidates = sizeGroups[size];
    if (candidates.length < 2) continue;

    const hashGroups = {};
    for (const name of candidates) {
      try {
        const hash = await hashFile(path.join(dir, name));
        (hashGroups[hash] ||= []).push(name);
      } catch { /* unreadable file — leave it alone rather than guess */ }
    }

    for (const hash of Object.keys(hashGroups)) {
      const group = hashGroups[hash];
      if (group.length < 2) continue;
      groupsFound++;

      group.sort((a, b) => a.length - b.length || a.localeCompare(b));
      const toRemove = group.slice(1); // keep the first (shortest name), remove the rest

      for (const name of toRemove) {
        try {
          fs.unlinkSync(path.join(dir, name));
          removeExtractionCache(category, name);
          migratePlayCount(category, name, null, null);
          migrateAlbumArt(category, name, null, null);
          migrateVideoThumb(category, name, null, null);
          migrateFileThumb(category, name, null, null);
          migrateLockedName(category, name, null, null);
          removed.push(name);
        } catch { /* already gone or in use — skip it, nothing else depends on this succeeding */ }
      }
    }
  }

  res.json({ removed, removedCount: removed.length, groupsFound, total: files.length });
});

// Apple's free iTunes Search API has an informal, undocumented rate limit
// -- roughly ~20 requests/minute per IP -- and a library of any real size
// blows through that in a few seconds if requests are only lightly paced.
// Going over it returns an HTTP 403/429, not a network failure, so treating
// every failure as "check your connection" was misleading: it was almost
// always this. This enforces a conservative pace against the *search*
// endpoint specifically (the actual artwork image comes from a separate,
// unthrottled CDN, so it isn't paced here) and, if a request is rejected as
// rate-limited anyway, backs off well beyond the normal pace and retries a
// couple of times before actually giving up on that track.
const ITUNES_SEARCH_MAX_PER_MINUTE = 18;
const itunesSearchTimestamps = [];

async function waitForItunesSearchSlot() {
  const now = Date.now();
  while (itunesSearchTimestamps.length && now - itunesSearchTimestamps[0] > 60000) {
    itunesSearchTimestamps.shift();
  }
  if (itunesSearchTimestamps.length >= ITUNES_SEARCH_MAX_PER_MINUTE) {
    const waitMs = 60000 - (Date.now() - itunesSearchTimestamps[0]) + 250;
    await new Promise(r => setTimeout(r, Math.max(waitMs, 250)));
    return waitForItunesSearchSlot();
  }
  itunesSearchTimestamps.push(Date.now());
}

async function itunesSearch(term, { timeoutMs = 8000, retriesLeft = 2 } = {}) {
  await waitForItunesSearchSlot();
  const searchUrl = `https://itunes.apple.com/search?media=music&entity=song&limit=1&term=${encodeURIComponent(term)}`;
  const resp = await fetch(searchUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (resp.status === 403 || resp.status === 429) {
    if (retriesLeft > 0) {
      await new Promise(r => setTimeout(r, 20000));
      return itunesSearch(term, { timeoutMs, retriesLeft: retriesLeft - 1 });
    }
    throw new Error(`rate limited by the art lookup service (HTTP ${resp.status}) after retrying`);
  }
  if (!resp.ok) throw new Error(`search returned ${resp.status}`);
  return resp.json();
}

// Bulk-fetches cover art for every Music track that doesn't already have
// it, using Apple's iTunes Search API — free, no account or API key
// needed. Best-effort: a track with no good match, or any single network
// hiccup, just gets skipped rather than failing the whole batch. Saves
// progress after each track so a partial run isn't wasted if something
// interrupts it partway through. Also embeds the art directly into the
// file's own tag (MP3, WAV, OGG, FLAC, M4A, and AAC are all supported)
// so it travels with the file if it's ever copied or downloaded
// elsewhere, rather than only existing in The Shelf's own separate data
// folder.
// Streams progress as newline-delimited JSON (one JSON object per line) so
// the browser can show a live status bar instead of the button just
// sitting on "Fetching art…" for however many minutes a big library takes
// under the rate limiter above. Each line is either a "progress" event
// (one per file, as it's decided) or a final "done" event with the same
// tallies the old single-response version returned.
app.post('/api/files/Music/fetch-album-art', async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson');
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  const dir = path.join(SHARED_ROOT, 'Music');
  const files = fs.readdirSync(dir).filter(f => !f.startsWith('.') && MUSIC_EXT.has(extOf(f)));
  const map = loadAlbumArtMap();

  let found = 0, alreadyHad = 0, notFound = 0, errored = 0, embedded = 0, rateLimited = 0;
  const errorSamples = [];

  for (let i = 0; i < files.length; i++) {
    const name = files[i];
    const key = albumArtKey('Music', name);
    const filePath = path.join(dir, name);

    if (map[key]) {
      alreadyHad++;
      // Retroactively embed art that was cached by an earlier run, before
      // this file-embedding step existed.
      if (embedAlbumArt(filePath, path.join(ALBUM_ART_DIR, map[key]))) embedded++;
      send({ type: 'progress', index: i, total: files.length, name, status: 'already had it' });
      continue;
    }

    const term = albumArtSearchTerm(name);
    if (!term) {
      notFound++;
      send({ type: 'progress', index: i, total: files.length, name, status: 'no match' });
      continue;
    }

    send({ type: 'progress', index: i, total: files.length, name, status: 'searching…' });

    try {
      const searchData = await itunesSearch(term);
      const match = searchData.results && searchData.results[0];
      if (!match || !match.artworkUrl100) {
        notFound++;
        send({ type: 'progress', index: i, total: files.length, name, status: 'no match' });
        continue;
      }

      // iTunes serves a small 100x100 thumbnail by default — this is the
      // well-known trick for asking for a much larger version instead.
      const artUrl = match.artworkUrl100.replace('100x100bb', '600x600bb');
      const imgResp = await fetch(artUrl, { signal: AbortSignal.timeout(8000) });
      if (!imgResp.ok) throw new Error(`image fetch returned ${imgResp.status}`);
      const buffer = Buffer.from(await imgResp.arrayBuffer());

      const artFilename = crypto.randomBytes(12).toString('hex') + '.jpg';
      const artPath = path.join(ALBUM_ART_DIR, artFilename);
      fs.writeFileSync(artPath, buffer);
      map[key] = artFilename;
      saveAlbumArtMap(map);
      found++;
      if (embedAlbumArt(filePath, artPath)) embedded++;
      send({ type: 'progress', index: i, total: files.length, name, status: 'found art' });
    } catch (err) {
      errored++;
      const rl = /rate limited/i.test(err.message);
      if (rl) rateLimited++;
      console.error(`[fetch-album-art] ${name}: ${err.message}`);
      if (errorSamples.length < 5) errorSamples.push(`${name}: ${err.message}`);
      send({ type: 'progress', index: i, total: files.length, name, status: rl ? 'rate limited' : 'error' });
    }

    // A light pause between requests beyond the rate limiter itself —
    // there's no rush since this runs in the background of a button click.
    await new Promise(r => setTimeout(r, 200));
  }

  send({ type: 'done', found, alreadyHad, notFound, errored, rateLimited, embedded, total: files.length, errorSamples });
  res.end();
});

// Deletes every cached cover image and clears the mapping, so a future
// "Get album art" run starts fresh — useful if a wrong match got matched
// to a track, or just to reclaim the disk space.
app.delete('/api/files/Music/album-art', (req, res) => {
  const map = loadAlbumArtMap();
  const count = Object.keys(map).length;
  for (const artFile of Object.values(map)) {
    try { fs.unlinkSync(path.join(ALBUM_ART_DIR, artFile)); } catch { /* already gone, fine */ }
  }
  saveAlbumArtMap({});
  res.json({ cleared: count });
});

function musicFilePath(name) {
  const safeName = sanitizeFilename(decodeURIComponent(name));
  const filePath = path.join(SHARED_ROOT, 'Music', safeName);
  if (!filePath.startsWith(path.join(SHARED_ROOT, 'Music')) || !fs.existsSync(filePath)) return null;
  return { safeName, filePath };
}

// Reads a single track's own Artist/Title/Album/Track tags, for the manual
// tag editor to pre-fill from -- the file listing already carries the
// artist (for the "by ..." line under each track), but not the rest.
app.get('/api/files/Music/:name/tags', (req, res) => {
  const loc = musicFilePath(req.params.name);
  if (!loc) return res.status(404).json({ error: 'File not found' });
  res.json(readMusicTags(loc.filePath));
});

// Manually corrects a track's own Artist/Title/Album/Track tags -- separate
// from the filename (renameFile) and from the automatic guess-from-filename
// pass (standardize-names). This is the fix for a track whose artist tag
// is simply wrong (misread by a downloader, or guessed wrong originally),
// which otherwise keeps causing the wrong cover art to be found for it.
app.put('/api/files/Music/:name/tags', (req, res) => {
  const loc = musicFilePath(req.params.name);
  if (!loc) return res.status(404).json({ error: 'File not found' });
  const { artist, title, album, track } = req.body || {};
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');
  const ok = writeMusicTags(loc.filePath, { artist: clean(artist), title: clean(title), album: clean(album), track: clean(track) }, /* allowClear */ true);
  if (!ok) return res.status(500).json({ error: 'Could not save tags to this file.' });
  res.json(readMusicTags(loc.filePath));
});

// Re-fetches cover art for exactly one track, on demand -- the fix for a
// track that ended up with the wrong art because its artist tag used to be
// wrong. Unlike the bulk "Get album art" pass (which searches by filename,
// since most tracks don't have any tags yet to search by), this one
// prefers the track's own artist/title tags when they're present, since
// that's presumably what was just corrected in the tag editor. Always
// overwrites whatever art the track already had, cached or embedded.
app.post('/api/files/Music/:name/fetch-art', async (req, res) => {
  const loc = musicFilePath(req.params.name);
  if (!loc) return res.status(404).json({ error: 'File not found' });

  const tags = readMusicTags(loc.filePath);
  const term = (tags.artist && tags.title) ? `${tags.artist} ${tags.title}` : albumArtSearchTerm(loc.safeName);
  if (!term) return res.status(400).json({ error: 'Nothing to search by -- this track has no tags or usable filename.' });

  try {
    const searchData = await itunesSearch(term);
    const match = searchData.results && searchData.results[0];
    if (!match || !match.artworkUrl100) {
      return res.status(404).json({ error: `No cover art found for "${term}".` });
    }
    const artUrl = match.artworkUrl100.replace('100x100bb', '600x600bb');
    const imgResp = await fetch(artUrl, { signal: AbortSignal.timeout(8000) });
    if (!imgResp.ok) throw new Error(`image fetch returned ${imgResp.status}`);
    const buffer = Buffer.from(await imgResp.arrayBuffer());

    const map = loadAlbumArtMap();
    const key = albumArtKey('Music', loc.safeName);
    const previous = map[key];
    const artFilename = crypto.randomBytes(12).toString('hex') + '.jpg';
    fs.writeFileSync(path.join(ALBUM_ART_DIR, artFilename), buffer);
    map[key] = artFilename;
    saveAlbumArtMap(map);
    if (previous) {
      try { fs.unlinkSync(path.join(ALBUM_ART_DIR, previous)); } catch { /* already gone, fine */ }
    }

    const embedded = embedAlbumArt(loc.filePath, path.join(ALBUM_ART_DIR, artFilename));
    res.json({ artUrl: `/data-files/album-art/${artFilename}`, embedded, matchedAs: `${match.artistName} — ${match.trackName}` });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not fetch cover art.' });
  }
});

// Saves a video frame the browser already captured (via a hidden <video>
// + canvas, sent here as a JPEG data URL) as that video's thumbnail. The
// actual frame-grabbing happens client-side — this endpoint just stores
// whatever image it's handed, the same as the photo editor's save route.
app.post('/api/files/Videos/:name/thumbnail', (req, res) => {
  const safeName = sanitizeFilename(decodeURIComponent(req.params.name));
  if (!fs.existsSync(path.join(SHARED_ROOT, 'Videos', safeName))) {
    return res.status(404).json({ error: 'File not found' });
  }
  const { imageData } = req.body || {};
  const match = typeof imageData === 'string' && imageData.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid image data' });
  }
  let buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch {
    return res.status(400).json({ error: 'Could not decode image data' });
  }
  if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) {
    return res.status(400).json({ error: 'Thumbnail image is too large to save.' });
  }

  const map = loadVideoThumbMap();
  const key = videoThumbKey('Videos', safeName);
  const thumbFilename = crypto.randomBytes(12).toString('hex') + '.jpg';
  fs.writeFileSync(path.join(VIDEO_THUMBS_DIR, thumbFilename), buffer);
  // Remove any previous thumbnail for this video before recording the new one.
  const previous = map[key];
  if (previous) {
    try { fs.unlinkSync(path.join(VIDEO_THUMBS_DIR, previous)); } catch { /* already gone, fine */ }
  }
  map[key] = thumbFilename;
  saveVideoThumbMap(map);
  res.json({ saved: true, thumbUrl: `/data-files/video-thumbs/${thumbFilename}` });
});

app.delete('/api/files/Videos/video-thumbs', (req, res) => {
  const map = loadVideoThumbMap();
  const count = Object.keys(map).length;
  for (const thumbFile of Object.values(map)) {
    try { fs.unlinkSync(path.join(VIDEO_THUMBS_DIR, thumbFile)); } catch { /* already gone, fine */ }
  }
  saveVideoThumbMap({});
  res.json({ cleared: count });
});

// Saves a thumbnail for a Games/Programs/Books file, the same shape as
// the video-thumbnail route above. The image itself either came from the
// host's own file picker (Games, Programs) or from pdf.js rendering the
// first page of a PDF onto a canvas (Books) — this route doesn't care
// which, it just stores the finished JPEG.
app.post('/api/files/:category/:name/thumbnail', (req, res) => {
  const { category } = req.params;
  if (!THUMBNAILABLE_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'This shelf does not support thumbnails.' });
  }
  const safeName = sanitizeFilename(decodeURIComponent(req.params.name));
  if (!fs.existsSync(path.join(SHARED_ROOT, category, safeName))) {
    return res.status(404).json({ error: 'File not found' });
  }
  const { imageData } = req.body || {};
  const match = typeof imageData === 'string' && imageData.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid image data' });
  }
  let buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch {
    return res.status(400).json({ error: 'Could not decode image data' });
  }
  if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) {
    return res.status(400).json({ error: 'Thumbnail image is too large to save.' });
  }

  const map = loadFileThumbMap();
  const key = fileThumbKey(category, safeName);
  const thumbFilename = crypto.randomBytes(12).toString('hex') + '.jpg';
  fs.writeFileSync(path.join(FILE_THUMBS_DIR, thumbFilename), buffer);
  const previous = map[key];
  if (previous) {
    try { fs.unlinkSync(path.join(FILE_THUMBS_DIR, previous)); } catch { /* already gone, fine */ }
  }
  map[key] = thumbFilename;
  saveFileThumbMap(map);
  res.json({ saved: true, thumbUrl: `/data-files/file-thumbs/${thumbFilename}` });
});

app.delete('/api/files/:category/:name/thumbnail', (req, res) => {
  const { category } = req.params;
  if (!THUMBNAILABLE_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'This shelf does not support thumbnails.' });
  }
  const safeName = sanitizeFilename(decodeURIComponent(req.params.name));
  const map = loadFileThumbMap();
  const key = fileThumbKey(category, safeName);
  const thumbFile = map[key];
  if (!thumbFile) return res.json({ removed: false });
  try { fs.unlinkSync(path.join(FILE_THUMBS_DIR, thumbFile)); } catch { /* already gone, fine */ }
  delete map[key];
  saveFileThumbMap(map);
  res.json({ removed: true });
});

app.delete('/api/files/:category/file-thumbs', (req, res) => {
  const { category } = req.params;
  if (!THUMBNAILABLE_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'This shelf does not support thumbnails.' });
  }
  const map = loadFileThumbMap();
  const prefix = `${category}/`;
  let count = 0;
  for (const key of Object.keys(map)) {
    if (!key.startsWith(prefix)) continue;
    try { fs.unlinkSync(path.join(FILE_THUMBS_DIR, map[key])); } catch { /* already gone, fine */ }
    delete map[key];
    count++;
  }
  saveFileThumbMap(map);
  res.json({ cleared: count });
});

app.post('/api/upload', (req, res) => {
  upload.array('files')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    res.json({ uploaded: (req.files || []).map(f => f.filename) });
  });
});

app.delete('/api/files/:category/:name', (req, res) => {
  const { category, name } = req.params;
  if (!isValidCategory(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const safeName = sanitizeFilename(decodeURIComponent(name));
  const filePath = path.join(SHARED_ROOT, category, safeName);
  if (!filePath.startsWith(path.join(SHARED_ROOT, category))) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  fs.unlink(filePath, (err) => {
    if (err) return res.status(404).json({ error: 'File not found' });
    removeExtractionCache(category, safeName);
    migratePlayCount(category, safeName, null, null);
    migrateAlbumArt(category, safeName, null, null);
    migrateVideoThumb(category, safeName, null, null);
    migrateFileThumb(category, safeName, null, null);
    migrateLockedName(category, safeName, null, null);
    res.json({ deleted: safeName });
  });
});

// Renames a single file. If the requested new name has no extension, the
// original one is kept — most people renaming a file just want to change
// the title, not accidentally change its type.
app.put('/api/files/:category/:name', (req, res) => {
  const { category, name } = req.params;
  if (!isValidCategory(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const safeName = sanitizeFilename(decodeURIComponent(name));
  const filePath = path.join(SHARED_ROOT, category, safeName);
  if (!filePath.startsWith(path.join(SHARED_ROOT, category))) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const { newName } = req.body || {};
  if (!newName || typeof newName !== 'string' || !newName.trim()) {
    return res.status(400).json({ error: 'A new name is required.' });
  }

  const origExt = path.extname(safeName);
  let cleanNewName = sanitizeFilename(newName.trim());
  if (!path.extname(cleanNewName) && origExt) {
    cleanNewName += origExt;
  }

  if (cleanNewName === safeName) {
    return res.json({ renamed: safeName }); // no actual change requested
  }

  const newPath = path.join(SHARED_ROOT, category, cleanNewName);
  if (!newPath.startsWith(path.join(SHARED_ROOT, category))) {
    return res.status(400).json({ error: 'Invalid new name' });
  }
  if (fs.existsSync(newPath) && cleanNewName.toLowerCase() !== safeName.toLowerCase()) {
    return res.status(409).json({ error: `"${cleanNewName}" already exists in this shelf.` });
  }

  try {
    fs.renameSync(filePath, newPath);
  } catch {
    return res.status(500).json({ error: 'Could not rename the file.' });
  }

  removeExtractionCache(category, safeName); // will re-extract under the new name if it's a zipped game
  migratePlayCount(category, safeName, category, cleanNewName);
  migrateAlbumArt(category, safeName, category, cleanNewName);
  migrateVideoThumb(category, safeName, category, cleanNewName);
  migrateFileThumb(category, safeName, category, cleanNewName);
  migrateLockedName(category, safeName, category, cleanNewName); // carry over if it was already locked
  lockName(category, cleanNewName); // a deliberate rename -- protect it from "Standardize names" going forward
  res.json({ renamed: cleanNewName });
});

app.post('/api/files/move', (req, res) => {
  const { fromCategory, toCategory, name } = req.body || {};
  if (!isValidCategory(fromCategory) || !isValidCategory(toCategory)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  if (fromCategory === toCategory) {
    return res.json({ moved: name }); // nothing to do
  }
  const safeName = sanitizeFilename(name || '');
  const sourcePath = path.join(SHARED_ROOT, fromCategory, safeName);
  if (!fs.existsSync(sourcePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const destDir = path.join(SHARED_ROOT, toCategory);
  const ext = path.extname(safeName);
  const base = path.basename(safeName, ext);
  let finalName = safeName;
  let counter = 1;
  while (fs.existsSync(path.join(destDir, finalName))) {
    finalName = `${base} (${counter})${ext}`;
    counter++;
  }

  fs.rename(sourcePath, path.join(destDir, finalName), (err) => {
    if (err) return res.status(500).json({ error: 'Could not move file' });
    removeExtractionCache(fromCategory, safeName); // will re-extract under the new name/category if played again
    migratePlayCount(fromCategory, safeName, toCategory, finalName);
    migrateAlbumArt(fromCategory, safeName, toCategory, finalName);
    migrateVideoThumb(fromCategory, safeName, toCategory, finalName);
    migrateFileThumb(fromCategory, safeName, toCategory, finalName);
    migrateLockedName(fromCategory, safeName, toCategory, finalName);
    res.json({ moved: finalName, category: toCategory });
  });
});

// Tells the frontend what URL to load in the game player for a given file.
// .html/.htm files are served directly; .zip files are unzipped on first
// play (and reused afterwards) so a multi-file HTML5 game works correctly.
app.get('/api/play-info', (req, res) => {
  const category = req.query.category;
  if (!isValidCategory(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const safeName = sanitizeFilename(req.query.name || '');
  const filePath = path.join(SHARED_ROOT, category, safeName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const ext = extOf(safeName);

  if (ext === 'html' || ext === 'htm') {
    return res.json({ url: `/shared/${category}/${encodeURIComponent(safeName)}` });
  }

  if (ext === 'zip') {
    const id = extractionId(category, safeName);
    const destDir = path.join(EXTRACT_ROOT, id);
    try {
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        const zip = new AdmZip(filePath);
        zip.extractAllTo(destDir, true);
      }
      const entry = findEntryHtml(destDir);
      if (!entry) {
        return res.status(400).json({ error: "Couldn't find an index.html inside this zip." });
      }
      const rel = path.relative(destDir, entry).split(path.sep).map(encodeURIComponent).join('/');
      return res.json({ url: `/play/${id}/${rel}` });
    } catch (err) {
      return res.status(500).json({ error: 'Could not open this zip file.' });
    }
  }

  return res.status(400).json({ error: "This file type can't be run in the app — try downloading it instead." });
});

app.get('/api/network-info', (req, res) => {
  res.json({ ips: getLocalIPs(), port: PORT });
});

app.get('/api/visitors', (req, res) => {
  const visitors = loadVisitors();
  const list = Object.values(visitors).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  res.json(list);
});

app.delete('/api/visitors', (req, res) => {
  saveVisitors({});
  res.json({ cleared: true });
});

// ---- Weather (Home dashboard) ----
// The one feature in the whole app that needs an internet connection. Uses
// Open-Meteo (api.open-meteo.com) — free, no API key, no account. Proxied
// through the server (rather than called from the browser) so only the
// host machine needs internet, and so we can cache briefly and be a good
// citizen toward the free API.

const WMO_WEATHER = {
  0: { label: 'Clear sky', icon: '☀️' },
  1: { label: 'Mainly clear', icon: '🌤️' },
  2: { label: 'Partly cloudy', icon: '⛅' },
  3: { label: 'Overcast', icon: '☁️' },
  45: { label: 'Fog', icon: '🌫️' },
  48: { label: 'Freezing fog', icon: '🌫️' },
  51: { label: 'Light drizzle', icon: '🌦️' },
  53: { label: 'Drizzle', icon: '🌦️' },
  55: { label: 'Heavy drizzle', icon: '🌧️' },
  56: { label: 'Light freezing drizzle', icon: '🌧️' },
  57: { label: 'Freezing drizzle', icon: '🌧️' },
  61: { label: 'Light rain', icon: '🌧️' },
  63: { label: 'Rain', icon: '🌧️' },
  65: { label: 'Heavy rain', icon: '🌧️' },
  66: { label: 'Light freezing rain', icon: '🌧️' },
  67: { label: 'Freezing rain', icon: '🌧️' },
  71: { label: 'Light snow', icon: '🌨️' },
  73: { label: 'Snow', icon: '🌨️' },
  75: { label: 'Heavy snow', icon: '❄️' },
  77: { label: 'Snow grains', icon: '🌨️' },
  80: { label: 'Light rain showers', icon: '🌦️' },
  81: { label: 'Rain showers', icon: '🌧️' },
  82: { label: 'Heavy rain showers', icon: '⛈️' },
  85: { label: 'Light snow showers', icon: '🌨️' },
  86: { label: 'Heavy snow showers', icon: '❄️' },
  95: { label: 'Thunderstorm', icon: '⛈️' },
  96: { label: 'Thunderstorm with hail', icon: '⛈️' },
  99: { label: 'Severe thunderstorm', icon: '⛈️' }
};

const weatherCache = new Map(); // "lat,lon" (rounded) -> { data, fetchedAt }
const WEATHER_CACHE_MS = 10 * 60 * 1000; // 10 minutes — plenty fresh, easy on the free API

app.get('/api/weather', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'Missing or invalid location.' });
  }

  // Rounded to ~1km — plenty precise for weather, and groups nearby requests
  // onto the same cache entry.
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < WEATHER_CACHE_MS) {
    return res.json(cached.data);
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`weather service returned ${resp.status}`);
    const json = await resp.json();
    const cw = json.current_weather;
    if (!cw || typeof cw.temperature !== 'number') throw new Error('unexpected response from weather service');

    const info = WMO_WEATHER[cw.weathercode] || { label: 'Unknown', icon: '🌡️' };
    const data = {
      tempC: Math.round(cw.temperature),
      tempF: Math.round(cw.temperature * 9 / 5 + 32),
      condition: info.label,
      icon: info.icon,
      isDay: !!cw.is_day
    };
    weatherCache.set(cacheKey, { data, fetchedAt: Date.now() });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: `Couldn't reach the weather service — check this computer's internet connection. (${err.message})` });
  }
});

// ---- Backup / restore (export everything to a zip, import it back) ----

const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }
});

// Downloads every file on one shelf as a single zip (e.g. the whole Music
// library). Streamed straight to the browser as it's built, so even a
// many-GB library never has to fit in memory or be staged on disk first.
// Files are stored uncompressed: music/video/images are already compressed
// formats, so zipping them harder just burns CPU for no size gain.
app.get('/api/files/:category/download-all', (req, res) => {
  const { category } = req.params;
  if (!isValidCategory(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const dir = path.join(SHARED_ROOT, category);
  const names = fs.readdirSync(dir).filter(f => !f.startsWith('.') && fs.statSync(path.join(dir, f)).isFile());
  if (names.length === 0) {
    return res.status(404).json({ error: 'There is nothing on this shelf to download.' });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="the-shelf-${category.toLowerCase()}-${stamp}.zip"`);

  const archive = archiver('zip', { store: true });
  archive.on('error', (err) => {
    console.error(`${category} zip download error:`, err.message);
    res.end();
  });
  archive.pipe(res);
  for (const name of names) {
    archive.file(path.join(dir, name), { name: `${category}/${name}` });
  }
  archive.finalize();
});

// The backup is split into named sections so the host can pick which to
// include (checkboxes on the Home screen). Each section owns a fixed set of
// paths. Shelves live under shared/; everything else under data/.
//
//   "shelf-extras" is the per-file stuff that belongs to the shelves but is
//   stored centrally: album art, thumbnails, play counts, locked names. It
//   rides along automatically with any shelf, and is MERGED on import
//   rather than replaced, so restoring one shelf never wipes another
//   shelf's album art or thumbnails.
//
//   "settings" is a catch-all for anything in data/ no other section claims
//   (accounts, the on/off and access toggles, visitor log, ...), so a
//   backup with every box ticked still contains everything, even files a
//   future version adds.
const SHELF_EXTRA_PATHS = ['album-art', 'album-art.json', 'video-thumbs', 'video-thumbs.json',
  'file-thumbs', 'file-thumbs.json', 'play-counts.json', 'locked-names.json'];
const DATA_SECTIONS = [
  { id: 'notes',    label: 'Notes',    paths: ['notes'] },
  { id: 'docs',     label: 'Docs',     paths: ['documents'] },
  { id: 'sheets',   label: 'Sheets',   paths: ['sheets'] },
  { id: 'slides',   label: 'Slides',   paths: ['presentations'] },
  { id: 'drawings', label: 'Drawings', paths: ['drawings'] },
  { id: 'messages', label: 'Messages', paths: ['messaging'] },
  { id: 'home',     label: 'Home page (bulletin board, photos, links)', paths: ['portal.json', 'portal-media'] },
  { id: 'ai',       label: 'AI model and settings', paths: ['ai'] },
];
// Never backed up: an in-progress Big Transfer's state is meaningless on
// another machine (the half-uploaded file itself isn't in the backup).
const BACKUP_NEVER = ['bigfile-uploads.json', 'imagine']; // imagine/ = unsaved AI picture previews

function shelfSectionId(cat) { return `shelf-${cat.toLowerCase()}`; }

function settingsPaths() {
  const claimed = new Set([...SHELF_EXTRA_PATHS, ...BACKUP_NEVER, ...DATA_SECTIONS.flatMap(s => s.paths)]);
  return fs.readdirSync(DATA_ROOT).filter(n => !claimed.has(n));
}

function pathSize(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.size;
    return fs.readdirSync(p).reduce((sum, n) => sum + pathSize(path.join(p, n)), 0);
  } catch { return 0; }
}

// Every section, with where its files live. root is SHARED_ROOT or DATA_ROOT.
function backupSections() {
  const shelves = CATEGORIES.map(cat => ({
    id: shelfSectionId(cat), group: 'Shelves', label: cat === 'Books' ? 'Books / PDFs' : cat,
    root: SHARED_ROOT, rootName: 'shared', paths: [cat]
  }));
  const data = DATA_SECTIONS.map(s => ({ ...s, group: 'Your stuff', root: DATA_ROOT, rootName: 'data' }));
  const settings = { id: 'settings', group: 'Settings', label: 'Accounts and settings',
    root: DATA_ROOT, rootName: 'data', paths: settingsPaths() };
  return [...shelves, ...data, settings];
}

// What the checkboxes show: each section's name and size on disk.
app.get('/api/backup/sections', (req, res) => {
  res.json(backupSections().map(s => ({
    id: s.id, group: s.group, label: s.label,
    size: s.paths.reduce((sum, p) => sum + pathSize(path.join(s.root, p)), 0)
  })));
});

// ?sections=a,b,c picks what goes in; leaving it off backs up everything
// (same as before checkboxes existed). The zip carries a small manifest so
// import knows exactly which sections it holds -- and therefore which ones
// it's allowed to replace.
app.get('/api/backup/export', (req, res) => {
  const all = backupSections();
  const wanted = req.query.sections ? new Set(String(req.query.sections).split(',')) : null;
  const chosen = wanted ? all.filter(s => wanted.has(s.id)) : all;
  if (chosen.length === 0) return res.status(400).json({ error: 'Pick at least one thing to back up.' });
  const includeExtras = chosen.some(s => s.root === SHARED_ROOT);

  const stamp = new Date().toISOString().slice(0, 10);
  const everything = chosen.length === all.length;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="the-shelf-backup-${everything ? '' : 'partial-'}${stamp}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => {
    // Headers are likely already sent by the time a mid-stream error happens,
    // so we can't cleanly send a JSON error — just end the response.
    console.error('Backup export error:', err.message);
    res.end();
  });
  archive.pipe(res);

  const addPath = (root, rootName, rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) {
      archive.glob('**/*', { cwd: abs, dot: true, ignore: ['.extracted/**'] }, { prefix: `${rootName}/${rel}` });
    } else {
      archive.file(abs, { name: `${rootName}/${rel}` });
    }
  };
  for (const s of chosen) for (const rel of s.paths) addPath(s.root, s.rootName, rel);
  if (includeExtras) for (const rel of SHELF_EXTRA_PATHS) addPath(DATA_ROOT, 'data', rel);

  const manifest = { version: 1, created: new Date().toISOString(),
    sections: chosen.map(s => s.id), shelfExtras: includeExtras };
  archive.append(JSON.stringify(manifest, null, 2), { name: 'shelf-backup.json' });
  archive.finalize();
});

// Copies everything from src into dest without deleting anything already
// in dest; for JSON maps (play counts, thumbnail maps, ...) the keys are
// merged, with the backup's values winning.
function mergeInto(src, dest) {
  if (!fs.existsSync(src)) return;
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const n of fs.readdirSync(src)) mergeInto(path.join(src, n), path.join(dest, n));
    return;
  }
  if (src.endsWith('.json') && fs.existsSync(dest)) {
    try {
      const a = JSON.parse(fs.readFileSync(dest, 'utf8'));
      const b = JSON.parse(fs.readFileSync(src, 'utf8'));
      if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
        fs.writeFileSync(dest, JSON.stringify({ ...a, ...b }));
        return;
      }
    } catch { /* not a mergeable map -- fall through and just overwrite */ }
  }
  fs.copyFileSync(src, dest);
}

function replaceWith(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  if (fs.existsSync(src)) fs.cpSync(src, dest, { recursive: true });
}

app.post('/api/backup/import', backupUpload.single('backup'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No backup file uploaded.' });

  const tmpDir = path.join(os.tmpdir(), `shelf-import-${Date.now()}-${crypto.randomUUID()}`);
  try {
    const zip = new AdmZip(req.file.buffer);
    zip.extractAllTo(tmpDir, true);

    const importedShared = path.join(tmpDir, 'shared');
    const importedData = path.join(tmpDir, 'data');
    const manifestPath = path.join(tmpDir, 'shelf-backup.json');
    let restored;

    if (fs.existsSync(manifestPath)) {
      // A backup made with the checkboxes: replace only the sections it
      // actually contains, and leave everything else on this machine alone.
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const inBackup = new Set(manifest.sections || []);
      const sections = backupSections().filter(s => inBackup.has(s.id));
      for (const s of sections) {
        const from = s.root === SHARED_ROOT ? importedShared : importedData;
        if (s.id === 'settings') {
          // The settings section is "whatever's left over", which differs
          // between machines -- so restore the files the backup has, rather
          // than deleting this machine's leftovers first.
          if (fs.existsSync(importedData)) {
            const claimed = new Set([...SHELF_EXTRA_PATHS, ...BACKUP_NEVER, ...DATA_SECTIONS.flatMap(d => d.paths)]);
            for (const n of fs.readdirSync(importedData)) if (!claimed.has(n)) replaceWith(path.join(importedData, n), path.join(DATA_ROOT, n));
          }
        } else {
          for (const rel of s.paths) replaceWith(path.join(from, rel), path.join(s.root, rel));
        }
      }
      // Unzipped-game cache is rebuilt on demand; clear it so a restored
      // game can't be served from a stale copy of a same-named old one.
      if (sections.some(s => s.root === SHARED_ROOT)) fs.rmSync(EXTRACT_ROOT, { recursive: true, force: true });
      if (manifest.shelfExtras) for (const rel of SHELF_EXTRA_PATHS) mergeInto(path.join(importedData, rel), path.join(DATA_ROOT, rel));
      restored = sections.length === backupSections().length ? ['everything'] : sections.map(s => s.label);
    } else {
      // An older full backup (from before the checkboxes): it holds
      // everything, so it replaces everything, exactly as it always did.
      if (fs.existsSync(importedShared)) replaceWith(importedShared, SHARED_ROOT);
      if (fs.existsSync(importedData)) replaceWith(importedData, DATA_ROOT);
      restored = ['everything'];
    }

    // Recreate any folders the backup might not have included (e.g. one
    // that was empty at export time).
    for (const cat of CATEGORIES) fs.mkdirSync(path.join(SHARED_ROOT, cat), { recursive: true });
    fs.mkdirSync(EXTRACT_ROOT, { recursive: true });
    for (const kind of COLLECTIONS) fs.mkdirSync(path.join(DATA_ROOT, kind), { recursive: true });
    fs.mkdirSync(DRAWINGS_DIR, { recursive: true });
    fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });

    res.json({ ok: true, restored,
      message: `Restored: ${restored.join(', ')}. Restart The Shelf for everything to load correctly.` });
  } catch (err) {
    res.status(500).json({ error: `Could not import backup: ${err.message}` });
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }, () => {});
  }
});

// ---- Messaging ----

app.get('/api/messaging/identity', (req, res) => res.json(identity));

app.put('/api/messaging/identity', (req, res) => {
  const { name, status } = req.body || {};
  if (typeof name === 'string' && name.trim()) identity.name = name.trim().slice(0, 60);
  if (['online', 'away', 'busy', 'offline'].includes(status)) identity.status = status;
  saveIdentity();
  broadcastPresence(); // reflect the change immediately instead of waiting for the next tick
  res.json(identity);
});

app.get('/api/messaging/peers', (req, res) => {
  res.json(prunedOnlinePeers());
});

// The direct "are you a Shelf?" question from another copy (see
// probeShelf). Answers with our details, and notes theirs -- unless
// messaging is switched off here, in which case we stay invisible.
app.post('/api/messaging/hello', (req, res) => {
  if (!appOn || identity.status === 'offline') return res.status(404).json({ error: 'Not found' });
  const ip = (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const body = req.body || {};
  if (body.type === 'shelf-presence' && ip && ip !== '127.0.0.1' && ip !== '::1') notePeer(body, ip, 'hello'); // (handles a clash too)
  res.json({ type: 'shelf-hello', id: identity.id, name: identity.name, status: identity.status, httpPort: PORT, instance: INSTANCE_TAG });
});

// "Add by address": check one computer directly and say exactly what's
// wrong if it isn't showing up -- not running, wrong port, Local computer
// only switched on, messaging off, not a Shelf at all, or sharing an
// identity with another computer.
app.post('/api/messaging/add', async (req, res) => {
  const raw = String((req.body || {}).address || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const m = /^(\[?[^\]]+?\]?|[^:]+)(?::(\d{1,5}))?$/.exec(raw);
  if (!raw || !m) return res.status(400).json({ error: 'Type an address like 10.0.0.50, 10.0.0.50:8080, or raspberrypi.local.' });
  const host = m[1], port = Number(m[2]) || 8080;
  if (port < 1 || port > 65535) return res.status(400).json({ error: "That port number isn't valid." });

  let ip = host;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    try { ip = (await dns.promises.lookup(host, { family: 4 })).address; }
    catch { return res.json({ ok: false, message: `Couldn't find a computer called "${host}" on the network. Try its IP address instead.` }); }
  }
  if (ownAddresses().has(ip) && port === Number(PORT)) return res.json({ ok: false, message: "That's this computer." });

  const base = `http://${ip}:${port}/api/messaging`;
  const where = `${ip}:${port}`;
  let r;
  try {
    r = await fetch(`${base}/hello`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(presencePayload()), signal: AbortSignal.timeout(4000) });
  } catch (err) {
    const code = err && err.cause && err.cause.code;
    return res.json({ ok: false, message: code === 'ECONNREFUSED'
      ? `${ip} is there, but nothing is answering on port ${port}. Is The Shelf running on it, and on that port? (The address bar on that computer shows its port.)`
      : `Nothing answered at ${port === 8080 ? ip : where}. Check the address, and that the computer is switched on and on the same network. A firewall on that computer can also block it.` });
  }
  let body = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  if (r.status === 503 && body && /local-only/i.test(body.error || '')) {
    return res.json({ ok: false, message: `The Shelf at ${where} has "Local computer only" switched on, so it turns every other computer away. Switch it off on that computer.` });
  }
  if (r.status === 503 && body && /turned off/i.test(body.error || '')) {
    return res.json({ ok: false, message: `The Shelf at ${where} is switched off ("The Shelf is on" toggle). Switch it on there.` });
  }
  let info = r.ok && body && body.type === 'shelf-hello' ? { ...body, httpPort: body.httpPort || port } : null;
  if (!info && r.status === 404) {
    // An older version without "hello", or messaging switched off there.
    try {
      const old = await fetch(`${base}/identity`, { signal: AbortSignal.timeout(4000) });
      const data = old.ok ? await old.json() : null;
      if (data && data.id) {
        if (data.status === 'offline') return res.json({ ok: false, message: `The Shelf at ${where} has messaging switched off. Turn on "Messaging on" in its Messages tab.` });
        info = { ...data, httpPort: port, older: true };
      } else if (old.status === 401) {
        return res.json({ ok: false, message: `The Shelf at ${where} has "Secured visitors" on and is an older version that can't be found that way. Update it to this version, and it will be.` });
      }
    } catch { /* fall through */ }
    if (!info) return res.json({ ok: false, message: `The Shelf at ${where} has messaging switched off, or isn't a Shelf. If it's a Shelf, turn on "Messaging on" in its Messages tab.` });
  }
  if (!info) return res.json({ ok: false, message: `Something answered at ${where}, but it isn't The Shelf.` });
  if (isOwnEcho(info)) return res.json({ ok: false, message: "That's this computer (another of its addresses)." });

  if (info.id === identity.id) {
    handleIdentityClash(ip, info.name);
    return res.json({ ok: false, retry: true, message: `${info.name || 'That computer'} at ${ip} was using the same identity as this one (usually from setting it up with this computer's backup). This computer has taken a new identity — click Add again.` });
  }
  const sameIdElsewhere = Object.entries(loadKnownPeers()).find(([id, p]) => id === info.id && p.ip && p.ip !== ip && onlinePeers.has(id));
  const peer = notePeer(info, ip, 'manual');
  res.json({ ok: true, peer, older: !!info.older,
    warning: sameIdElsewhere ? `Heads up: ${sameIdElsewhere[1].name} at ${sameIdElsewhere[1].ip} is using the same identity as this computer — usually because one was set up from the other's backup. Update both to this version and they'll sort it out themselves.` : null });
});

app.post('/api/messaging/scan', async (req, res) => {
  const result = await scanNetwork();
  res.json({ ...result, online: prunedOnlinePeers().length });
});

// For the "You" line at the top of Messages: this computer's own address(es).
app.get('/api/messaging/self', (req, res) => {
  const { machine, ...pub } = identity;
  res.json({ ...pub, addresses: localNetworks().map(n => n.address), port: PORT, lastScan,
    identityClash, sharedIdentities: sharedIdentities() });
});

// Every Shelf instance ever seen on this network (via discovery broadcast
// or messaging), regardless of whether a conversation was ever started —
// this is the "previously connected computers" list shown in the sidebar.
app.get('/api/messaging/known-peers', (req, res) => {
  const known = loadKnownPeers();
  const online = new Set(prunedOnlinePeers().map(p => p.id));
  const list = Object.entries(known)
    .filter(([id]) => id !== identity.id) // never list ourselves
    .map(([id, info]) => ({
      id,
      name: info.name || 'Unknown',
      ip: info.ip || null,
      httpPort: info.httpPort || null,
      online: online.has(id),
      lastSeenAt: info.lastSeenAt || 0
    }))
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  res.json(list);
});

app.get('/api/messaging/conversations', (req, res) => {
  const known = loadKnownPeers();
  const online = new Set(prunedOnlinePeers().map(p => p.id));
  const peerIds = fs.readdirSync(CONVERSATIONS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));

  const list = peerIds.map(id => {
    const { last, lastIn, unread } = conversationSummary(id) || { last: null, lastIn: null, unread: 0 };
    const lastPreview = last ? (last.text || (last.image ? '\ud83d\uddbc\ufe0f Image' : '')) : '';
    return {
      lastInAt: lastIn ? lastIn.timestamp : 0,
      lastInPreview: lastIn ? (lastIn.text || (lastIn.image ? 'Sent an image' : '')) : '',
      id,
      name: (known[id] && known[id].name) || 'Unknown',
      online: online.has(id),
      ip: (known[id] && known[id].ip) || null,
      httpPort: (known[id] && known[id].httpPort) || null,
      lastMessage: lastPreview,
      lastAt: last ? last.timestamp : (known[id] && known[id].lastSeenAt) || 0,
      unread
    };
  }).sort((a, b) => b.lastAt - a.lastAt);

  res.json(list);
});

app.get('/api/messaging/conversations/:peerId', (req, res) => {
  const { peerId } = req.params;
  if (!isValidId(peerId)) return res.status(400).json({ error: 'Invalid id' });
  const messages = loadConversation(peerId);
  let changed = false;
  messages.forEach(m => { if (m.direction === 'in' && !m.read) { m.read = true; changed = true; } });
  if (changed) saveConversation(peerId, messages);
  res.json(messages);
});

const MAX_MESSAGE_IMAGE_CHARS = 2_000_000; // ~1.5MB of actual image data once decoded — plenty for a resized screenshot/drawing

app.post('/api/messaging/send', async (req, res) => {
  const { toId, text, image } = req.body || {};
  const trimmedText = text ? String(text).trim() : '';
  if (!isValidId(toId) || (!trimmedText && !image)) {
    return res.status(400).json({ error: 'Missing recipient, or nothing to send' });
  }
  if (image && (typeof image !== 'string' || !image.startsWith('data:image/') || image.length > MAX_MESSAGE_IMAGE_CHARS)) {
    return res.status(400).json({ error: 'That image is too large to send.' });
  }
  // Not heard from recently? Try their last known address anyway -- they
  // may be up but unreachable by broadcast.
  let peer = onlinePeers.get(toId);
  if (!peer) {
    const k = loadKnownPeers()[toId];
    if (k && k.ip) peer = { id: toId, name: k.name, ip: k.ip, httpPort: k.httpPort || PORT };
  }
  if (!peer) {
    return res.status(404).json({ error: 'That person appears to be offline right now.' });
  }

  const message = {
    id: crypto.randomUUID(), direction: 'out',
    text: trimmedText.slice(0, 5000),
    image: image || null,
    timestamp: Date.now(), read: true
  };

  try {
    const resp = await fetch(`http://${peer.ip}:${peer.httpPort}/api/messaging/receive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromId: identity.id, fromName: identity.name, fromPort: PORT, text: message.text, image: message.image, timestamp: message.timestamp }),
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) throw new Error('Delivery failed');
  } catch (err) {
    return res.status(502).json({ error: "Couldn't reach that person — they may have just gone offline." });
  }

  appendMessage(toId, message);
  rememberPeer(toId, { name: peer.name, ip: peer.ip, httpPort: peer.httpPort });
  res.json(message);
});

app.post('/api/messaging/receive', (req, res) => {
  const { fromId, fromName, fromPort, text, image, timestamp } = req.body || {};
  if (!isValidId(fromId) || (!text && !image)) {
    return res.status(400).json({ error: 'Invalid message' });
  }
  if (image && (typeof image !== 'string' || !image.startsWith('data:image/') || image.length > MAX_MESSAGE_IMAGE_CHARS)) {
    return res.status(400).json({ error: 'Invalid image' });
  }
  const message = {
    id: crypto.randomUUID(),
    direction: 'in',
    text: text ? String(text).slice(0, 5000) : '',
    image: image || null,
    timestamp: timestamp || Date.now(),
    read: false
  };
  appendMessage(fromId, message);

  const known = loadKnownPeers();
  const senderIp = (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const senderName = fromName || (known[fromId] && known[fromId].name) || 'Unknown';
  if (senderIp && fromPort) notePeer({ id: fromId, name: senderName, httpPort: fromPort }, senderIp, 'message');
  else rememberPeer(fromId, { name: senderName });

  res.json({ ok: true });
});

// ---- Notes / Documents / Presentations ----
// Each is a simple JSON-file-per-item collection: data/<kind>/<id>.json

function registerCollection(kind) {
  const dir = path.join(DATA_ROOT, kind);

  app.get(`/api/${kind}`, (req, res) => {
    const items = fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const item = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          return item;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b.updated || 0) - (a.updated || 0));
    res.json(items);
  });

  app.get(`/api/${kind}/:id`, (req, res) => {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const file = path.join(dir, `${req.params.id}.json`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
    res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
  });

  app.post(`/api/${kind}`, (req, res) => {
    const id = crypto.randomUUID();
    const item = { ...req.body, id, updated: Date.now() };
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(item));
    res.json(item);
  });

  app.put(`/api/${kind}/:id`, (req, res) => {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const file = path.join(dir, `${req.params.id}.json`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
    const item = { ...req.body, id: req.params.id, updated: Date.now() };
    fs.writeFileSync(file, JSON.stringify(item));
    res.json(item);
  });

  app.delete(`/api/${kind}/:id`, (req, res) => {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const file = path.join(dir, `${req.params.id}.json`);
    fs.unlink(file, (err) => {
      if (err) return res.status(404).json({ error: 'Not found' });
      res.json({ deleted: req.params.id });
    });
  });
}

COLLECTIONS.forEach(registerCollection);

// ---- Sheets: import from CSV/XLS/XLSX (drag-and-drop) ----

const sheetImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const SHEET_IMPORT_MAX_COLS = 26;
const SHEET_IMPORT_MAX_ROWS = 500;

app.post('/api/sheets/import', (req, res) => {
  sheetImportUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const ext = extOf(req.file.originalname || '');
    const allowedExt = new Set(['csv', 'tsv', 'xls', 'xlsx', 'xlsm', 'ods']);
    if (!allowedExt.has(ext)) {
      return res.status(400).json({ error: 'Please drop a .csv, .tsv, .xls, .xlsx, or .ods file.' });
    }

    let rows;
    try {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) throw new Error('No sheets found in that file.');
      const worksheet = workbook.Sheets[firstSheetName];
      rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: '' });
    } catch (parseErr) {
      return res.status(400).json({ error: `Could not read that file: ${parseErr.message}` });
    }

    const rowCount = Math.min(rows.length, SHEET_IMPORT_MAX_ROWS);
    let colCount = 0;
    for (let r = 0; r < rowCount; r++) colCount = Math.max(colCount, rows[r] ? rows[r].length : 0);
    colCount = Math.min(colCount, SHEET_IMPORT_MAX_COLS);

    const data = {};
    for (let r = 0; r < rowCount; r++) {
      const row = rows[r] || [];
      for (let c = 0; c < colCount; c++) {
        const val = row[c];
        if (val !== undefined && val !== null && val !== '') {
          data[`${r}-${c}`] = String(val);
        }
      }
    }

    const title = (req.file.originalname || 'Imported sheet').replace(/\.[^.]+$/, '').slice(0, 80) || 'Imported sheet';
    const id = crypto.randomUUID();
    const item = {
      id,
      title,
      cols: Math.max(colCount, 10),
      rows: Math.max(rowCount, 10),
      data,
      updated: Date.now()
    };
    fs.writeFileSync(path.join(DATA_ROOT, 'sheets', `${id}.json`), JSON.stringify(item));
    res.json(item);
  });
});

// ---- Drawings ----
// Each drawing is a PNG (data/drawings/<id>.png) plus metadata
// (data/drawings/<id>.json) so the draw pad can list/rename/reload them.

app.get('/api/drawings', (req, res) => {
  const items = fs.readdirSync(DRAWINGS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(DRAWINGS_DIR, f), 'utf8'));
        return { ...meta, url: `/data-files/drawings/${meta.id}.png` };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
  res.json(items);
});

function saveDrawingImage(id, dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('Expected a PNG data URL');
  fs.writeFileSync(path.join(DRAWINGS_DIR, `${id}.png`), Buffer.from(match[1], 'base64'));
}

app.post('/api/drawings', (req, res) => {
  const id = crypto.randomUUID();
  try {
    saveDrawingImage(id, req.body.dataUrl);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const meta = { id, title: req.body.title || 'Untitled', updated: Date.now() };
  fs.writeFileSync(path.join(DRAWINGS_DIR, `${id}.json`), JSON.stringify(meta));
  res.json({ ...meta, url: `/data-files/drawings/${id}.png` });
});

app.put('/api/drawings/:id', (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const id = req.params.id;
  const metaFile = path.join(DRAWINGS_DIR, `${id}.json`);
  if (!fs.existsSync(metaFile)) return res.status(404).json({ error: 'Not found' });
  if (req.body.dataUrl) {
    try {
      saveDrawingImage(id, req.body.dataUrl);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  const meta = { id, title: req.body.title || 'Untitled', updated: Date.now() };
  fs.writeFileSync(metaFile, JSON.stringify(meta));
  res.json({ ...meta, url: `/data-files/drawings/${id}.png` });
});

app.delete('/api/drawings/:id', (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const id = req.params.id;
  fs.unlink(path.join(DRAWINGS_DIR, `${id}.json`), () => {});
  fs.unlink(path.join(DRAWINGS_DIR, `${id}.png`), () => {});
  res.json({ deleted: id });
});

// ---- Portal / bulletin board (a single shared dashboard, not a collection) ----

function loadPortal() {
  if (!fs.existsSync(PORTAL_FILE)) {
    return { links: [], posts: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(PORTAL_FILE, 'utf8'));
  } catch {
    return { links: [], posts: [] };
  }
}

function savePortal(data) {
  fs.writeFileSync(PORTAL_FILE, JSON.stringify(data));
}

app.get('/api/portal', (req, res) => res.json(loadPortal()));

app.post('/api/portal/links', (req, res) => {
  const portal = loadPortal();
  const link = { id: crypto.randomUUID(), label: req.body.label || req.body.url, url: req.body.url };
  portal.links.push(link);
  savePortal(portal);
  res.json(link);
});

app.delete('/api/portal/links/:id', (req, res) => {
  const portal = loadPortal();
  portal.links = portal.links.filter(l => l.id !== req.params.id);
  savePortal(portal);
  res.json({ deleted: req.params.id });
});

const portalMediaUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PORTAL_MEDIA_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || (file.mimetype.startsWith('video') ? '.webm' : '.png');
      cb(null, `${crypto.randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/'));
  }
});

app.post('/api/portal/posts', (req, res) => {
  const portal = loadPortal();
  const post = {
    id: crypto.randomUUID(),
    type: 'text',
    text: req.body.text || '',
    color: req.body.color || 'amber',
    created: Date.now()
  };
  portal.posts.push(post);
  savePortal(portal);
  res.json(post);
});

app.post('/api/portal/posts/media', (req, res) => {
  portalMediaUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Only images and videos can be pasted onto the board.' });

    const portal = loadPortal();
    const post = {
      id: crypto.randomUUID(),
      type: req.file.mimetype.startsWith('video/') ? 'video' : 'image',
      mediaUrl: `/data-files/portal-media/${req.file.filename}`,
      color: req.body.color || 'amber',
      created: Date.now()
    };
    portal.posts.push(post);
    savePortal(portal);
    res.json(post);
  });
});

app.delete('/api/portal/posts/:id', (req, res) => {
  const portal = loadPortal();
  const post = portal.posts.find(p => p.id === req.params.id);
  if (post && post.mediaUrl) {
    const filename = path.basename(post.mediaUrl);
    fs.unlink(path.join(PORTAL_MEDIA_DIR, filename), () => {});
  }
  portal.posts = portal.posts.filter(p => p.id !== req.params.id);
  savePortal(portal);
  res.json({ deleted: req.params.id });
});

// ---- AI tab: a small, fully local chat model ----
// Runs entirely on this machine via node-llama-cpp (a Node binding for
// llama.cpp) -- no account, API key, or internet access needed once the
// model file has been downloaded once. The on/off toggle controls whether
// the model is actually loaded into memory: "on" loads it (using real RAM
// and some CPU while it's answering), "off" disposes it completely, so a
// low-power host isn't paying that cost when nobody's using it. The model
// file itself, once downloaded, stays on disk either way, so turning it
// back on later is instant rather than downloading it all over again.
// node-llama-cpp is an ESM-only package, hence the dynamic import()s below
// rather than a top-of-file require() (this file is CommonJS).

// The models you can pick from in the AI tab, smallest first. All are
// Q4_K_M quantizations (a good size/quality trade-off for running on a
// CPU). `ramGB` is roughly what each needs while loaded, with a 4K-token
// conversation -- the file itself plus the model's working memory. Sizes
// are the exact file sizes, which is also how a finished download is told
// apart from a half-finished one.
const AI_MODELS = [
  { id: 'qwen2.5-0.5b', label: 'Qwen2.5 0.5B', uri: 'hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M',
    file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf', size: 491400032, ramGB: 1.0,
    blurb: 'Tiny and quick. Fine for short questions; gets confused easily.' },
  { id: 'llama3.2-1b', label: 'Llama 3.2 1B', uri: 'hf:bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M',
    file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf', size: 807694464, ramGB: 1.5,
    blurb: 'Small and fast, noticeably better at conversation than 0.5B.' },
  { id: 'qwen2.5-1.5b', label: 'Qwen2.5 1.5B', uri: 'hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M',
    file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf', size: 1117320736, ramGB: 2.0,
    blurb: 'The best balance for a Raspberry Pi 4 or other low-power machine.' },
  { id: 'gemma2-2b', label: 'Gemma 2 2B', uri: 'hf:bartowski/gemma-2-2b-it-GGUF:Q4_K_M',
    file: 'gemma-2-2b-it-Q4_K_M.gguf', size: 1708582752, ramGB: 2.8,
    blurb: 'Good writing quality for its size. Slow on a Raspberry Pi.' },
  { id: 'llama3.2-3b', label: 'Llama 3.2 3B', uri: 'hf:bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M',
    file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf', size: 2019377696, ramGB: 3.2,
    blurb: 'Clearly smarter, but only for machines with room to spare. Very slow on a Pi.' },
  { id: 'qwen2.5-7b', label: 'Qwen2.5 7B', uri: 'hf:bartowski/Qwen2.5-7B-Instruct-GGUF:Q4_K_M',
    file: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf', size: 4683074240, ramGB: 6.0,
    blurb: 'The most capable here. Needs a desktop or laptop with 8 GB+ of memory.' },
];
const AI_DEFAULT_MODEL_ID = 'qwen2.5-0.5b'; // what earlier versions always used
const AI_CONTEXT_SIZE = { min: 1024, max: 4096 }; // plenty for a chat; keeps memory predictable on a Pi

// What kind of machine this is, for the "fits / recommended" hints. A
// Raspberry Pi names itself in the device tree.
function describeAiMachine() {
  let name = `${os.type() === 'Darwin' ? 'Mac' : os.type() === 'Windows_NT' ? 'Windows PC' : 'Linux computer'}`;
  let isPi = false;
  try {
    const model = fs.readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '').trim();
    if (model) { name = model; isPi = /raspberry pi/i.test(model); }
  } catch { /* not a Pi / no device tree */ }
  const ramGB = os.totalmem() / (1024 ** 3);
  return { name, isPi, arch: process.arch, ramGB: Math.round(ramGB * 10) / 10 };
}

// 'good' = fits with room left for the OS and The Shelf itself; 'tight' =
// will load, but expect the machine to bog down; 'too-big' = won't fit.
function aiModelFit(model, machine) {
  if (model.ramGB <= machine.ramGB * 0.8) return 'good';
  if (model.ramGB <= machine.ramGB * 0.95) return 'tight';
  return 'too-big';
}

// Bigger is smarter but slower, so on a low-power ARM board the pick is the
// best balance (1.5B) rather than the biggest that technically fits.
function recommendedAiModelId(machine) {
  const fitting = AI_MODELS.filter(m => aiModelFit(m, machine) === 'good');
  if (!fitting.length) return AI_MODELS[0].id;
  const lowPower = machine.isPi || (machine.arch.startsWith('arm') && machine.ramGB < 9);
  if (lowPower) {
    const balanced = fitting.filter(m => m.ramGB <= 2.0);
    return (balanced[balanced.length - 1] || fitting[0]).id;
  }
  return fitting[fitting.length - 1].id;
}

// Any .gguf someone dropped into data/ai/model by hand also shows up as a
// choice ("your own model file"), so advanced users aren't limited to the list.
function listCustomAiModelFiles() {
  // Files belonging to a list model -- finished, or a half-finished
  // download of one -- aren't "your own".
  const known = new Set(AI_MODELS.map(m => aiCatalogFile(m)).filter(Boolean));
  const listNames = new Map(AI_MODELS.map(m => [normalizeGgufName(m.file), m.size]));
  const partial = (f) => {
    const full = listNames.get(normalizeGgufName(f));
    if (!full) return false;
    try { return fs.statSync(path.join(AI_MODEL_DIR, f)).size < full * 0.99; } catch { return true; }
  };
  try {
    return fs.readdirSync(AI_MODEL_DIR)
      .filter(f => f.toLowerCase().endsWith('.gguf') && !known.has(f) && !partial(f))
      .map(f => ({ id: `file:${f}`, label: f, file: f, custom: true,
        size: fs.statSync(path.join(AI_MODEL_DIR, f)).size, ramGB: null,
        blurb: 'A model file you added yourself.' }));
  } catch { return []; }
}

function findAiModel(id) {
  return AI_MODELS.find(m => m.id === id) || listCustomAiModelFiles().find(m => m.id === id) || null;
}

// Where a list model actually is on disk. The downloader doesn't save under
// the name in AI_MODELS -- it adds its own prefix ("hf_bartowski_...") and
// sometimes a "." before the quant -- so looking only for model.file made
// every finished download look "incomplete". Checked in order:
//   1. the file the downloader itself reported when this model finished
//      (remembered in downloads.json, with its size);
//   2. the plain catalog name, complete (exact size);
//   3. any .gguf here whose name is the catalog name with the downloader's
//      decorations, or whose size is exactly the model's (a finished copy
//      from before this was fixed).
// A half-finished download is smaller, so it never matches.
const AI_DOWNLOADS_FILE = path.join(AI_DIR, 'downloads.json');
function loadAiDownloads() {
  try { return JSON.parse(fs.readFileSync(AI_DOWNLOADS_FILE, 'utf8')) || {}; } catch { return {}; }
}
function normalizeGgufName(f) {
  return f.toLowerCase().replace(/^hf_[^_]+_/, '').replace(/\.(q\d[a-z0-9_]*)\.gguf$/, '-$1.gguf');
}
function aiCatalogFile(model) {
  const sizeOf = (f) => { try { return fs.statSync(path.join(AI_MODEL_DIR, f)).size; } catch { return -1; } };
  const rec = loadAiDownloads()[model.id];
  if (rec && rec.file && sizeOf(rec.file) === rec.size) return rec.file;
  if (sizeOf(model.file) === model.size) return model.file;
  let files = [];
  try { files = fs.readdirSync(AI_MODEL_DIR).filter(f => f.toLowerCase().endsWith('.gguf')); } catch { return null; }
  const want = normalizeGgufName(model.file);
  return files.find(f => sizeOf(f) === model.size)
    || files.find(f => normalizeGgufName(f) === want && Math.abs(sizeOf(f) - model.size) < model.size * 0.01)
    || null;
}
function aiModelFile(model) {
  if (!model) return null;
  if (!model.custom) return aiCatalogFile(model);
  try { return fs.statSync(path.join(AI_MODEL_DIR, model.file)).size > 0 ? model.file : null; } catch { return null; }
}
function isAiModelDownloaded(model) {
  return !!aiModelFile(model);
}

function loadAiSettings() {
  let settings = { enabled: false };
  if (fs.existsSync(AI_SETTINGS_FILE)) {
    try { settings = JSON.parse(fs.readFileSync(AI_SETTINGS_FILE, 'utf8')); } catch { /* corrupt -- defaults */ }
  }
  if (settings.modelId && settings.modelId.startsWith('file:')) {
    const f = settings.modelId.slice(5);
    const owner = AI_MODELS.find(m => aiCatalogFile(m) === f);
    if (owner) settings.modelId = owner.id; // that file turned out to be one of the list's models
  }
  if (!settings.modelId || !findAiModel(settings.modelId)) settings.modelId = AI_DEFAULT_MODEL_ID;
  return settings;
}

function activeAiModel() {
  return findAiModel(loadAiSettings().modelId);
}
function saveAiSettings(settings) {
  fs.writeFileSync(AI_SETTINGS_FILE, JSON.stringify(settings));
}

// Everything below is in-memory only, rebuilt from the settings file and
// whatever model file already exists on disk whenever the server (re)starts.
let aiLlama = null;
let aiModel = null;
let aiContext = null;
let aiSession = null;
let aiDownloading = false;
let aiDownloadProgress = null; // { downloadedSize, totalSize }
let aiLoading = false;
let aiError = null;

let aiDownloadingModelId = null;
let aiLoadedModelId = null; // which model is actually in memory right now

// The chosen model's file, if it's fully downloaded.
function findDownloadedModelFile() {
  const model = activeAiModel();
  const file = aiModelFile(model);
  return file ? path.join(AI_MODEL_DIR, file) : null;
}

// node-llama-cpp ships a different prebuilt binary per OS/CPU/GPU
// combination (Linux/Mac/Windows, x64/arm64, CPU-only/CUDA/Vulkan), which
// on Linux alone comes to several hundred MB across all the variants a
// machine might need. Because of that, it's deliberately NOT bundled into
// this app's own node_modules -- shipping one platform's binaries would
// just be wrong (and huge) for whoever's actual machine this zip lands on.
// Instead, it's installed fresh the first time AI is actually used, right
// here on whatever machine The Shelf is really running on, so npm
// resolves the one variant that machine needs. After that first time it's
// on disk for good, same as the model file itself.
function isAiEngineInstalled() {
  // Not require.resolve('node-llama-cpp/...') -- its package.json restricts
  // subpath exports, so resolving anything other than the bare package
  // specifier throws even when it's correctly installed. Checking the
  // installed folder directly sidesteps that entirely.
  return fs.existsSync(path.join(__dirname, 'node_modules', 'node-llama-cpp', 'package.json'));
}

// node-llama-cpp itself requires Node.js 20+. The rest of The Shelf runs
// fine on an older Node (nothing else here needs anything newer than 18),
// so this is checked only here, right before the one thing that actually
// needs it -- rather than raising the whole app's requirement and forcing
// everyone to upgrade just to use file sharing. This matters in practice:
// Debian/Raspberry Pi OS's own "sudo apt install nodejs" currently gives
// Node 18, which runs The Shelf itself fine but is too old for local AI.
function checkNodeVersionForAi() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    throw new Error(
      `Local AI needs Node.js 20 or newer (this machine has Node ${process.versions.node}). ` +
      `The rest of The Shelf works fine as-is -- only the AI tab needs the upgrade. ` +
      `On Debian/Ubuntu/Raspberry Pi OS, "sudo apt install nodejs" installs an older version; ` +
      `installing a current one from https://deb.nodesource.com/ (or nodejs.org directly) fixes this.`
    );
  }
}

function installAiEngine(onOutput) {
  return new Promise((resolve, reject) => {
    // On Windows, "npm" is actually "npm.cmd" -- a batch file, not a real
    // .exe -- and Windows can't launch a batch file directly the way it
    // launches an executable. Node normally papers over this for
    // child_process.exec(), but execFile() needs to be told explicitly to
    // go through the shell (shell: true) or it fails immediately with
    // "spawn EINVAL", before npm ever runs. Linux/Mac don't have this
    // wrinkle -- plain "npm" is a real executable there -- so this is
    // Windows-only.
    const child = execFile(
      'npm',
      ['install', 'node-llama-cpp@3', '--no-audit', '--no-fund'],
      { cwd: __dirname, maxBuffer: 1024 * 1024 * 50, shell: process.platform === 'win32' },
      (err) => { if (err) reject(new Error('Could not install the AI engine (npm install failed).')); else resolve(); }
    );
    const relay = (d) => {
      const text = d.toString();
      console.log('[AI setup]', text.trim());
      if (onOutput) onOutput(text);
    };
    child.stdout.on('data', relay);
    child.stderr.on('data', relay);
  });
}

async function ensureAiEngineInstalled(onOutput) {
  if (isAiEngineInstalled()) return;
  checkNodeVersionForAi();
  await installAiEngine(onOutput);
}

// A short, plain-text snapshot of what's actually on the shelf, folded
// into the model's system prompt so it can answer basic questions about
// the library ("what should I listen to", "do I have anything by X")
// without needing real search or tool-calling -- which a model this small
// can't do reliably anyway. Deliberately short: a handful of sample names
// per shelf, not the whole library, both to keep the prompt small and
// because a 0.5B model loses the plot if it's handed too much up front.
function buildLibrarySummary() {
  const lines = [];
  for (const category of CATEGORIES) {
    const dir = path.join(SHARED_ROOT, category);
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => !f.startsWith('.')); } catch { /* missing dir -- skip */ }
    if (!files.length) continue;
    const sample = files.slice(0, 12).map(f => path.basename(f, path.extname(f)));
    lines.push(`${category} (${files.length} files): ${sample.join(', ')}${files.length > sample.length ? ', ...' : ''}`);
  }
  return lines.length
    ? `Here is a snapshot of what's currently on the person's home media shelf ("The Shelf"):\n${lines.join('\n')}`
    : `The person's home media shelf ("The Shelf") is currently empty.`;
}

function buildAiSystemPrompt() {
  return [
    'You are a small, friendly, fully local AI assistant built into a self-hosted home media server called "The Shelf".',
    'You run entirely on the user\'s own machine -- nothing about this conversation ever leaves this device.',
    'Keep answers short and conversational. You are a small model, so stay honest about uncertainty rather than inventing details, especially about exact file names.',
    buildLibrarySummary(),
  ].join('\n\n');
}

async function unloadAi() {
  aiSession = null;
  try { if (aiContext) await aiContext.dispose(); } catch { /* already gone */ }
  aiContext = null;
  try { if (aiModel) await aiModel.dispose(); } catch { /* already gone */ }
  aiModel = null;
  aiLoadedModelId = null;
  // The shared llama backend itself (aiLlama) is cheap to keep around and
  // is reused across on/off cycles rather than torn down each time.
}

async function ensureAiLoaded() {
  const wantedId = loadAiSettings().modelId;
  if (aiSession && aiLoadedModelId === wantedId) return aiSession;
  if (aiSession) await unloadAi(); // a different model was picked since this one loaded
  const modelPath = findDownloadedModelFile();
  if (!modelPath) throw new Error('Model not downloaded yet.');

  aiLoading = true;
  aiError = null;
  try {
    await ensureAiEngineInstalled();
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
    if (!aiLlama) aiLlama = await getLlama();
    aiModel = await aiLlama.loadModel({ modelPath });
    // An explicit, modest context size: left on "auto", llama.cpp sizes the
    // conversation memory to whatever the machine has free, which on a
    // 4 GB Pi with a bigger model can push it into swapping.
    aiContext = await aiModel.createContext({ contextSize: AI_CONTEXT_SIZE });
    aiLoadedModelId = wantedId;
    aiSession = new LlamaChatSession({
      contextSequence: aiContext.getSequence(),
      systemPrompt: buildAiSystemPrompt(),
    });
    return aiSession;
  } catch (err) {
    aiError = err.message;
    await unloadAi();
    throw err;
  } finally {
    aiLoading = false;
  }
}

// If AI was already toggled on last time the server ran, and the model
// file is already sitting on disk from before, load it back into memory
// on startup rather than waiting for someone to open the AI tab first. If
// it's on but was never actually downloaded (e.g. a download got
// interrupted last time), this deliberately does NOT start a fresh
// download on its own -- that stays a deliberate action from the AI tab.
(function initAiOnStartup() {
  const settings = loadAiSettings();
  if (settings.enabled && findDownloadedModelFile()) {
    // A model bigger than this machine's memory (say the 7B picked on a
    // 4 GB Pi) would push the whole computer into swapping the moment The
    // Shelf starts, making everything crawl -- so that one waits until
    // someone opens the AI tab and asks for it.
    const model = activeAiModel();
    if (!model.custom && aiModelFit(model, describeAiMachine()) === 'too-big') {
      console.log(`[AI] Not loading ${model.label} at startup -- it needs more memory than this computer has.`);
    } else {
      ensureAiLoaded().catch(err => console.error('[AI] Failed to load model on startup:', err.message));
    }
  }
})();

app.get('/api/ai/status', (req, res) => {
  const settings = loadAiSettings();
  const machine = describeAiMachine();
  const recommendedId = recommendedAiModelId(machine);
  const active = activeAiModel();
  const models = [...AI_MODELS, ...listCustomAiModelFiles()].map(m => ({
    id: m.id, label: m.label, blurb: m.blurb, size: m.size, ramGB: m.ramGB, custom: !!m.custom,
    downloaded: isAiModelDownloaded(m),
    fit: m.custom ? 'unknown' : aiModelFit(m, machine),
    recommended: m.id === recommendedId,
  }));
  res.json({
    enabled: !!settings.enabled,
    modelId: active.id,
    modelLabel: active.label,
    modelSize: active.size,
    models,
    machine,
    downloaded: !!findDownloadedModelFile(),
    downloading: aiDownloading,
    downloadingModelId: aiDownloadingModelId,
    downloadProgress: aiDownloadProgress,
    loading: aiLoading,
    ready: !!aiSession && aiLoadedModelId === active.id,
    error: aiError,
  });
});

// Picks which model the AI tab uses. If it's already downloaded (and AI is
// on), it's loaded right away in place of the old one; otherwise the tab
// offers to download it.
app.post('/api/ai/select', async (req, res) => {
  const model = findAiModel((req.body || {}).modelId);
  if (!model) return res.status(400).json({ error: 'Unknown model.' });
  if (aiDownloading) return res.status(409).json({ error: 'Wait for the current download to finish first.' });
  const settings = loadAiSettings();
  settings.modelId = model.id;
  saveAiSettings(settings);
  aiError = null;
  await unloadAi();
  if (settings.enabled && isAiModelDownloaded(model)) {
    ensureAiLoaded().catch(err => console.error('[AI] Failed to load model:', err.message));
  }
  res.json({ modelId: model.id });
});

// Deletes a downloaded model file to free up disk space.
app.delete('/api/ai/models/:id', async (req, res) => {
  const model = findAiModel(req.params.id);
  if (!model) return res.status(404).json({ error: 'Unknown model.' });
  if (aiDownloadingModelId === model.id) return res.status(409).json({ error: 'That model is still downloading.' });
  if (aiLoadedModelId === model.id) await unloadAi();
  const file = aiModelFile(model);
  if (file) { try { fs.unlinkSync(path.join(AI_MODEL_DIR, file)); } catch { /* already gone */ } }
  res.json({ deleted: model.id });
});

app.post('/api/ai/toggle', async (req, res) => {
  const enabled = !!(req.body || {}).enabled;
  const settings = loadAiSettings();
  settings.enabled = enabled;
  saveAiSettings(settings);
  aiError = null; // a fresh flip of the switch shouldn't carry over a stale error from before

  if (!enabled) {
    await unloadAi();
    return res.json({ enabled: false });
  }

  // Turning on: if the model's already downloaded, load it now so chat is
  // ready the moment the person looks at the tab. If it isn't downloaded
  // yet, that's left to the explicit "Download model" action in the AI
  // tab rather than kicking off a large download from a toggle flip alone.
  if (findDownloadedModelFile()) {
    ensureAiLoaded().catch(err => console.error('[AI] Failed to load model:', err.message));
  }
  res.json({ enabled: true });
});

app.post('/api/ai/download', async (req, res) => {
  const settings = loadAiSettings();
  if (!settings.enabled) {
    return res.status(400).json({ error: 'Turn AI on first.' });
  }
  // Downloading does NOT switch models: whatever's in use keeps working
  // (you can keep chatting) and the download never unloads it. When it
  // finishes, the AI tab asks whether to load the new one now -- and if the
  // download fails partway, nothing about the current setup has changed.
  const requested = (req.body || {}).modelId;
  const model = requested ? findAiModel(requested) : activeAiModel();
  if (!model || model.custom) return res.status(400).json({ error: 'Unknown model.' });
  if (isAiModelDownloaded(model)) {
    return res.status(400).json({ error: 'Model is already downloaded.' });
  }
  if (aiDownloading) {
    return res.status(409).json({ error: 'A download is already in progress.' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  aiDownloading = true;
  aiDownloadingModelId = model.id;
  aiDownloadProgress = { downloadedSize: 0, totalSize: 0 };
  try {
    if (!isAiEngineInstalled()) {
      send({ type: 'installing', message: 'Setting up the AI engine (one-time)…' });
      await ensureAiEngineInstalled((line) => send({ type: 'installing', message: line.trim() }));
    }
    const { createModelDownloader } = await import('node-llama-cpp');
    const downloader = await createModelDownloader({
      modelUri: model.uri,
      dirPath: AI_MODEL_DIR,
      skipExisting: false, // a leftover partial file must be replaced, not trusted
      onProgress: (status) => {
        aiDownloadProgress = status;
        send({ type: 'progress', downloadedSize: status.downloadedSize, totalSize: status.totalSize });
      },
    });
    await downloader.download();
    // Remember exactly which file the downloader wrote (its own naming).
    const savedPath = downloader.entrypointFilePath;
    let savedSize = -1;
    try { savedSize = fs.statSync(savedPath).size; } catch { /* checked below */ }
    if (savedSize > 0 && (!downloader.totalSize || savedSize >= downloader.totalSize)) {
      const recs = loadAiDownloads();
      recs[model.id] = { file: path.basename(savedPath), size: savedSize };
      fs.writeFileSync(AI_DOWNLOADS_FILE, JSON.stringify(recs));
    }
    if (!isAiModelDownloaded(model)) throw new Error('The download finished but the file is incomplete. Try downloading it again.');
    send({ type: 'done', modelId: model.id });
  } catch (err) {
    // Reported to the person who started the download only. Not stored as
    // aiError -- that's for "the model in use won't load", and a failed
    // download leaves the model in use working exactly as before.
    send({ type: 'error', message: err.message });
  } finally {
    aiDownloading = false;
    aiDownloadingModelId = null;
    aiDownloadProgress = null;
    res.end();
  }
});

// Starts a fresh conversation -- a full model reload is the simplest safe
// way to clear a session's context (rather than juggling a second context
// sequence on the same model) and is fast since the model file is already
// warm in the OS's disk cache from the first load.
app.post('/api/ai/reset', async (req, res) => {
  const settings = loadAiSettings();
  if (!settings.enabled) {
    return res.status(400).json({ error: 'AI is turned off.' });
  }
  try {
    await unloadAi();
    await ensureAiLoaded();
    res.json({ reset: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'A message is required.' });
  }
  const settings = loadAiSettings();
  if (!settings.enabled) {
    return res.status(400).json({ error: 'AI is turned off.' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  try {
    const session = await ensureAiLoaded();
    // Speed stats for the reply. "Tokens per second" counts only the
    // writing itself -- from the first token to the last -- so it's
    // comparable between short and long answers. The wait before the first
    // token (the model reading the conversation so far) is reported
    // separately, since it grows as a chat gets longer.
    const startedAt = performance.now();
    let firstAt = null, lastAt = null, tokens = 0, fullText = '';
    await session.prompt(message.trim(), {
      onToken: (chunk) => {
        const now = performance.now();
        if (firstAt === null) firstAt = now;
        lastAt = now;
        tokens += chunk.length;
      },
      onTextChunk: (text) => {
        if (firstAt === null) firstAt = lastAt = performance.now();
        fullText += text;
        send({ type: 'chunk', text, tokens });
      },
    });
    const endAt = performance.now();
    // Fallback if this engine version doesn't report tokens as they're made.
    if (!tokens && aiModel && fullText) {
      try { tokens = aiModel.tokenize(fullText).length; lastAt = endAt; } catch { /* leave as 0 */ }
    }
    const writingSecs = firstAt !== null && lastAt > firstAt ? (lastAt - firstAt) / 1000 : 0;
    send({
      type: 'done',
      stats: {
        tokens,
        tokensPerSec: tokens > 1 && writingSecs > 0 ? (tokens - 1) / writingSecs : null,
        firstTokenSecs: firstAt !== null ? (firstAt - startedAt) / 1000 : null,
        totalSecs: (endAt - startedAt) / 1000,
        model: aiLoadedModelId,
      },
    });
  } catch (err) {
    send({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
});

// ---- Create a picture with Pollinations.ai (Pictures shelf) ----
// Type a description, Pollinations.ai draws it, and you either keep it
// (it's moved into the Pictures shelf) or ask for another take. Unlike the
// AI tab, this is an ONLINE service: the description is sent to
// Pollinations' servers, and the host computer needs internet access.
//
// Pollinations requires an API key (a free account at
// enter.pollinations.ai). It's a secret key meant only for servers, so
// it's entered once on the host computer, stored in data/pollinations.json,
// and never sent to anyone's browser -- every request to Pollinations goes
// through this server. The write-protection gate already covers these
// routes, so a read-only visitor can't spend the host's credits.
const IMAGINE_KEY_FILE = path.join(DATA_ROOT, 'pollinations.json');
const IMAGINE_DIR = path.join(DATA_ROOT, 'imagine'); // previews waiting for keep/discard
fs.mkdirSync(IMAGINE_DIR, { recursive: true });
const IMAGINE_BASE = process.env.POLLINATIONS_BASE || 'https://gen.pollinations.ai';
const IMAGINE_SHAPES = { square: [1024, 1024], wide: [1344, 768], tall: [768, 1344] };
const IMAGINE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

function loadImagineKey() {
  try { return JSON.parse(fs.readFileSync(IMAGINE_KEY_FILE, 'utf8')).key || null; } catch { return null; }
}

// Previews nobody kept or discarded (a closed tab, say) are cleared after an hour.
function cleanOldImaginePreviews() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const f of fs.readdirSync(IMAGINE_DIR)) {
    try { if (fs.statSync(path.join(IMAGINE_DIR, f)).mtimeMs < cutoff) fs.unlinkSync(path.join(IMAGINE_DIR, f)); } catch { /* gone */ }
  }
}

function findImaginePreview(id) {
  if (!/^[a-f0-9]{24}$/.test(String(id))) return null;
  const f = fs.readdirSync(IMAGINE_DIR).find(n => n.startsWith(id + '.'));
  return f ? path.join(IMAGINE_DIR, f) : null;
}

app.get('/api/imagine/status', (req, res) => {
  res.json({ hasKey: !!loadImagineKey(), canManageKey: isLocalRequest(req) });
});

// Only from the host computer: it's the host's account being billed.
app.put('/api/imagine/key', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'The API key can only be set from the host computer.' });
  const key = String((req.body || {}).key || '').trim();
  if (key.length < 10 || key.length > 400 || /\s/.test(key)) {
    return res.status(400).json({ error: "That doesn't look like a Pollinations API key. Copy the whole key from enter.pollinations.ai/keys." });
  }
  fs.writeFileSync(IMAGINE_KEY_FILE, JSON.stringify({ key }));
  res.json({ hasKey: true });
});

app.delete('/api/imagine/key', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'The API key can only be changed from the host computer.' });
  try { fs.unlinkSync(IMAGINE_KEY_FILE); } catch { /* already gone */ }
  res.json({ hasKey: false });
});

app.post('/api/imagine/generate', async (req, res) => {
  const key = loadImagineKey();
  if (!key) return res.status(400).json({ error: 'Set up a Pollinations API key first.' });
  const prompt = String((req.body || {}).prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'Describe the picture you want first.' });
  if (prompt.length > 1000) return res.status(400).json({ error: 'That description is too long — keep it under 1,000 characters.' });
  const [width, height] = IMAGINE_SHAPES[(req.body || {}).shape] || IMAGINE_SHAPES.square;
  const seed = crypto.randomInt(0, 2147483647); // a new seed each time = a different take on the same description
  cleanOldImaginePreviews();

  let upstream;
  try {
    // Slashes become spaces: the description travels as part of the URL
    // path, and some servers treat even an encoded "/" as a path break.
    const pathPrompt = encodeURIComponent(prompt.replace(/[\\/]+/g, ' '));
    const url = `${IMAGINE_BASE}/image/${pathPrompt}?width=${width}&height=${height}&seed=${seed}`;
    upstream = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(180000) });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return res.status(502).json({ error: timedOut
      ? 'Pollinations took too long to respond. Try again in a moment.'
      : "Couldn't reach Pollinations.ai — check that this computer is connected to the internet." });
  }
  if (!upstream.ok) {
    const messages = {
      401: "Pollinations didn't accept the API key. Check it at enter.pollinations.ai/keys and enter it again.",
      402: 'Your Pollinations account is out of credits for now. Check your balance at enter.pollinations.ai.',
      429: 'Pollinations says too many pictures were requested too quickly. Wait a minute and try again.',
    };
    return res.status(502).json({ error: messages[upstream.status] || `Pollinations couldn't make that picture (error ${upstream.status}). Try rewording it, or try again later.` });
  }
  const type = (upstream.headers.get('content-type') || '').split(';')[0].trim();
  const ext = IMAGINE_EXT[type];
  if (!ext) return res.status(502).json({ error: "Pollinations sent back something that isn't a picture. Try again." });
  const buf = Buffer.from(await upstream.arrayBuffer());
  if (!buf.length || buf.length > 25 * 1024 * 1024) return res.status(502).json({ error: 'Pollinations sent back an unusable picture. Try again.' });

  const id = crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(path.join(IMAGINE_DIR, id + ext), buf);
  res.json({ id, url: `/data-files/imagine/${id}${ext}`, seed, width, height });
});

// "Yes": move the preview into the Pictures shelf, named after the description.
app.post('/api/imagine/:id/keep', (req, res) => {
  const src = findImaginePreview(req.params.id);
  if (!src) return res.status(404).json({ error: 'That picture has expired. Create it again.' });
  const prompt = String((req.body || {}).prompt || '').trim();
  const ext = path.extname(src);
  let base = sanitizeFilename(prompt.replace(/[\\/]/g, ' ').replace(/\s+/g, ' ')).slice(0, 60).trim().replace(/[. ]+$/, '') || 'AI picture';
  const dir = path.join(SHARED_ROOT, 'Pictures');
  let name = `${base}${ext}`;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${base} (${n})${ext}`;
  try {
    fs.copyFileSync(src, path.join(dir, name)); // copy+delete rather than rename: data/ and shared/ may be on different drives
    fs.unlinkSync(src);
  } catch {
    return res.status(500).json({ error: 'Could not save the picture to the Pictures shelf.' });
  }
  res.json({ name });
});

// "No": throw the preview away.
app.delete('/api/imagine/:id', (req, res) => {
  const src = findImaginePreview(req.params.id);
  if (src) { try { fs.unlinkSync(src); } catch { /* gone */ } }
  res.json({ discarded: true });
});

// ---- VNC: another computer's desktop, right in a browser tab ----
// Browsers can't speak the VNC protocol themselves, so the in-browser
// viewer (noVNC, in public/vendor/novnc) talks to this server over a
// WebSocket, and this server passes everything straight through to the
// other computer's VNC port and back. Nothing is decoded or stored here --
// the VNC login and the screen data go end to end between the viewer and
// that computer's VNC server.
//
// Because this opens someone's desktop, it's locked down: only people who
// can make changes on this Shelf (the host computer, a logged-in
// write-access account, or "Anyone can edit" switched on) may use it; it
// only connects to computers in the Messages list (other Shelf installs);
// and only to VNC ports (5900-5999).
const VNC_PORT_MIN = 5900, VNC_PORT_MAX = 5999;

function canUseRemoteDesktop(req) {
  if (!appOn) return false;
  if (localhostOnly && !isLocalRequest(req)) return false;
  if (isLocalRequest(req) || openWriteAccess) return true;
  const user = getSessionUser(req);
  return !!(user && user.role === 'write');
}

function vncTarget(peerId, rawPort) {
  if (!isValidId(peerId)) return null;
  const live = onlinePeers.get(peerId);
  const known = loadKnownPeers()[peerId];
  const ip = (live && live.ip) || (known && known.ip);
  const port = Number(rawPort) || VNC_PORT_MIN;
  if (!ip || !Number.isInteger(port) || port < VNC_PORT_MIN || port > VNC_PORT_MAX) return null;
  return { ip, port };
}

// Before connecting, the viewer asks which login methods that computer's
// VNC offers -- some only work on secure (https or same-computer) pages,
// and it's kinder to say so up front than to fail halfway through.
app.get('/api/vnc/:peerId/probe', (req, res) => {
  if (!canUseRemoteDesktop(req)) return res.status(403).json({ error: 'Only the host computer, or someone allowed to make changes on this Shelf, can open a remote desktop.' });
  const target = vncTarget(req.params.peerId, req.query.port);
  if (!target) return res.status(404).json({ error: "That computer isn't in the Messages list, or that isn't a VNC port (5900-5999)." });
  const sock = net.connect(target.port, target.ip);
  let buf = Buffer.alloc(0), stage = 'version', version = null, done = false;
  const finish = (body) => { if (done) return; done = true; sock.destroy(); res.json({ ...body, ip: target.ip, port: target.port }); };
  sock.setTimeout(4000, () => finish({ ok: false, error: 'timeout' }));
  sock.on('error', (err) => finish({ ok: false, error: err.code === 'ECONNREFUSED' ? 'refused' : 'unreachable' }));
  sock.on('close', () => finish({ ok: false, error: 'closed' }));
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    if (stage === 'version' && buf.length >= 12) {
      const m = /^RFB (\d{3})\.(\d{3})\n/.exec(buf.slice(0, 12).toString('latin1'));
      if (!m) return finish({ ok: false, error: 'not-vnc' });
      version = `${Number(m[1])}.${Number(m[2])}`;
      buf = buf.slice(12);
      if (Number(m[1]) === 3 && Number(m[2]) < 7) { stage = 'type33'; }
      else { stage = 'types'; sock.write('RFB 003.008\n'); }
    }
    if (stage === 'types' && buf.length >= 1) {
      const n = buf[0];
      if (n === 0) return finish({ ok: true, version, types: [] });
      if (buf.length >= 1 + n) return finish({ ok: true, version, types: [...buf.slice(1, 1 + n)] });
    }
    if (stage === 'type33' && buf.length >= 4) return finish({ ok: true, version, types: [buf.readUInt32BE(0)] });
  });
});

const vncSockets = new WebSocketServer({ noServer: true });
function handleVncUpgrade(req, socket, head) {
  const url = new URL(req.url, 'http://x');
  const m = /^\/api\/vnc\/([^/]+)\/ws$/.exec(url.pathname);
  if (!m) return false;
  const reject = (code, text) => { socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
  if (!canUseRemoteDesktop(req)) { reject(403, 'Forbidden'); return true; }
  const target = vncTarget(m[1], url.searchParams.get('port'));
  if (!target) { reject(404, 'Not Found'); return true; }
  vncSockets.handleUpgrade(req, socket, head, (ws) => {
    const tcp = net.connect(target.port, target.ip);
    tcp.setNoDelay(true);
    const closeBoth = () => { try { ws.close(); } catch { /* gone */ } tcp.destroy(); };
    tcp.on('data', (d) => { if (ws.readyState === ws.OPEN) ws.send(d); });
    tcp.on('error', closeBoth);
    tcp.on('close', closeBoth);
    ws.on('message', (d) => { if (!tcp.destroyed) tcp.write(Buffer.isBuffer(d) ? d : Buffer.from(d)); });
    ws.on('close', closeBoth);
    ws.on('error', closeBoth);
  });
  return true;
}

const server = app.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('\nThe Shelf is up.');
  console.log(`  On this machine: http://localhost:${PORT}`);
  if (ips.length) {
    ips.forEach(ip => console.log(`  On your network:  http://${ip}:${PORT}`));
  } else {
    console.log('  Could not detect a LAN IP — check your network connection.');
  }
  console.log('');
});

// Node's default request timeout (5 minutes) is meant for ordinary API
// calls, not a 64MB Big Transfer chunk crawling over slow Wi-Fi -- without
// this, a slow-but-still-moving upload gets killed mid-chunk for no reason
// other than taking a while. Disabled entirely rather than just raised,
// since there's no good universal number for "how slow is too slow" here.
server.on('upgrade', (req, socket, head) => {
  if (!handleVncUpgrade(req, socket, head)) socket.destroy();
});
server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;
