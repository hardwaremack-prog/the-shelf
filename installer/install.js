// The Shelf — Setup
//
// A tiny local installer: it opens a real settings page in your browser
// (with a genuine "start automatically" checkbox), copies the app to a
// proper install location, wires up autostart if asked, and launches it.
//
// This is intentionally NOT a compiled .exe/.dmg — it's a plain Node script,
// so it works unchanged on Windows, Mac, and Linux as long as Node.js is
// installed (the same requirement as running the app itself).

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const PLATFORM = process.platform; // 'win32' | 'darwin' | 'linux'
const NODE_PATH = process.execPath; // absolute path to the Node binary running this script
const APP_SOURCE = path.resolve(__dirname, '..'); // the folder this installer/ lives inside
const INSTALLER_PORT = 39284;

// A crash anywhere in this script should never silently kill the installer
// mid-request (which is what causes a bare "Failed to fetch" in the browser
// with no useful error message). Log it and keep going instead.
process.on('uncaughtException', (err) => {
  console.log('Unexpected error (installer is still running):', err.message);
});
process.on('unhandledRejection', (err) => {
  console.log('Unexpected error (installer is still running):', err && err.message ? err.message : err);
});

function defaultInstallPath() {
  const home = os.homedir();
  if (PLATFORM === 'win32') return path.join(process.env.LOCALAPPDATA || home, 'TheShelf');
  if (PLATFORM === 'darwin') return path.join(home, 'Applications', 'TheShelf');
  return path.join(home, '.local', 'share', 'TheShelf');
}

// Copies the app into installPath. If shared/ or data/ already exist at the
// destination (a previous install), they're left alone so reinstalling to
// update the app code never touches the user's own files/notes/drawings.
function copyApp(installPath) {
  fs.mkdirSync(installPath, { recursive: true });
  const preserve = ['shared', 'data'].filter(name => fs.existsSync(path.join(installPath, name)));

  fs.cpSync(APP_SOURCE, installPath, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(APP_SOURCE, src);
      if (rel === '') return true;
      const segments = rel.split(path.sep);
      if (segments[0] === 'installer') return false;
      if (segments.includes('.bin')) return false; // npm's .bin symlinks trip up fs.cpSync and aren't needed at runtime
      for (const name of preserve) {
        if (rel === name || rel.startsWith(`${name}${path.sep}`)) return false;
      }
      return true;
    }
  });
}

// ---- Autostart: one implementation per OS, each just writes/removes a
// small OS-native config file. No registry hacking, no extra dependencies.

function vbsLauncherContent(installPath) {
  const serverPath = path.join(installPath, 'server.js');
  return (
    'Set WshShell = CreateObject("WScript.Shell")\r\n' +
    `WshShell.CurrentDirectory = "${installPath}"\r\n` +
    `WshShell.Run """${NODE_PATH}"" ""${serverPath}""", 0, False\r\n`
  );
}

function setAutostartWindows(installPath, enabled) {
  const startupDir = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'
  );
  const target = path.join(startupDir, 'TheShelf.vbs');
  if (enabled) {
    fs.mkdirSync(startupDir, { recursive: true });
    fs.writeFileSync(target, vbsLauncherContent(installPath));
  } else {
    fs.rmSync(target, { force: true });
  }
}

function plistContent(installPath) {
  const serverPath = path.join(installPath, 'server.js');
  const logPath = path.join(installPath, 'theshelf.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.theshelf.app</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${serverPath}</string>
  </array>
  <key>WorkingDirectory</key><string>${installPath}</string>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict>
</plist>
`;
}

function setAutostartMac(installPath, enabled) {
  const dir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'com.theshelf.app.plist');
  try { execSync(`launchctl unload "${target}"`, { stdio: 'ignore', timeout: 5000 }); } catch { /* not loaded, that's fine */ }
  if (enabled) {
    fs.writeFileSync(target, plistContent(installPath));
    try { execSync(`launchctl load -w "${target}"`, { stdio: 'ignore', timeout: 5000 }); } catch { /* best effort */ }
  } else {
    fs.rmSync(target, { force: true });
  }
}

function desktopEntryContent(installPath) {
  const serverPath = path.join(installPath, 'server.js');
  return `[Desktop Entry]
Type=Application
Name=The Shelf
Comment=Local network media & tools hub
Exec=${NODE_PATH} ${serverPath}
Path=${installPath}
X-GNOME-Autostart-enabled=true
Terminal=false
`;
}

function setAutostartLinux(installPath, enabled) {
  const dir = path.join(os.homedir(), '.config', 'autostart');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'theshelf.desktop');
  if (enabled) {
    fs.writeFileSync(target, desktopEntryContent(installPath));
  } else {
    fs.rmSync(target, { force: true });
  }
}

function setAutostart(installPath, enabled) {
  if (PLATFORM === 'win32') return setAutostartWindows(installPath, enabled);
  if (PLATFORM === 'darwin') return setAutostartMac(installPath, enabled);
  return setAutostartLinux(installPath, enabled);
}

const APP_PORT = Number(process.env.PORT) || 8080;

// Checks what's on a port without touching anything: 'ours' (an old copy of
// this app — safe to replace), 'other' (something else entirely — never
// touch it), or 'free' (nothing listening).
function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/categories', timeout: 1500, agent: false }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const looksLikeShelf = Array.isArray(data) && data.every(c => typeof c.name === 'string' && typeof c.count === 'number');
          resolve(looksLikeShelf ? 'ours' : 'other');
        } catch {
          resolve('other');
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve('other'); });
    req.on('error', (err) => { resolve(err.code === 'ECONNREFUSED' ? 'free' : 'other'); });
  });
}

// Finds the process LISTENING on the port -- i.e. the old server itself.
// The earlier version asked "which processes have any connection on this
// port?", which also matches anything connected TO it: this installer (it
// has just checked the port, and Node keeps that connection open) and any
// browser tab with The Shelf open. Killing those is what made a reinstall
// die halfway through and need a second click -- and could close the
// browser showing this very setup page.
function listeningPids(port) {
  const pids = new Set();
  const add = (p) => { const n = Number(p); if (Number.isInteger(n) && n > 0 && n !== process.pid) pids.add(n); };
  if (PLATFORM === 'win32') {
    try {
      const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000 });
      out.split('\n').forEach(line => {
        const cols = line.trim().split(/\s+/);
        // Expected columns: Proto, Local Address, Foreign Address, State, PID
        if (cols.length < 5 || cols[0].toUpperCase() !== 'TCP' || cols[3].toUpperCase() !== 'LISTENING') return;
        if (cols[1].endsWith(`:${port}`)) add(cols[4]);
      });
    } catch { /* netstat unavailable -- nothing found */ }
    return [...pids];
  }
  // lsof (Mac, most Linux), then ss (iproute2, on every modern Linux
  // including Raspberry Pi OS), then fuser -- whichever is installed.
  try {
    execSync(`lsof -nP -t -iTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8', timeout: 5000 }).split('\n').forEach(add);
  } catch { /* not installed, or nothing listening */ }
  if (!pids.size) {
    try {
      const out = execSync(`ss -ltnpH "sport = :${port}"`, { encoding: 'utf8', timeout: 5000 });
      for (const m of out.matchAll(/pid=(\d+)/g)) add(m[1]);
    } catch { /* not installed */ }
  }
  if (!pids.size) {
    try {
      // "<port>/tcp" means the LOCAL port, so clients of the server aren't matched.
      execSync(`fuser -n tcp ${port} 2>/dev/null`, { encoding: 'utf8', timeout: 5000 }).trim().split(/\s+/).forEach(add);
    } catch { /* not installed, or nothing listening */ }
  }
  return [...pids];
}

// Only ever stops a process we've confirmed is answering like an old copy
// of this exact app -- never anything unrecognized. Asks it to close first
// (SIGTERM), and only forces it (SIGKILL) if it hasn't gone after a few
// seconds. Resolves true once the port is actually free.
async function freePort(port) {
  const pids = listeningPids(port);
  const signal = (pid, sig) => {
    try {
      if (PLATFORM === 'win32') execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', timeout: 5000 });
      else process.kill(pid, sig);
    } catch { /* already gone, or not ours to stop */ }
  };
  pids.forEach(pid => signal(pid, 'SIGTERM'));
  for (let waited = 0; waited < 4000; waited += 250) {
    if (await checkPort(port) === 'free') return true;
    await new Promise(r => setTimeout(r, 250));
  }
  listeningPids(port).forEach(pid => signal(pid, 'SIGKILL'));
  for (let waited = 0; waited < 3000; waited += 250) {
    if (await checkPort(port) === 'free') return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

function waitForServer(port, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/categories', timeout: 1000, agent: false }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('timeout', () => { req.destroy(); if (Date.now() > deadline) resolve(false); else setTimeout(attempt, 300); });
      req.on('error', () => { if (Date.now() > deadline) resolve(false); else setTimeout(attempt, 300); });
    };
    attempt();
  });
}

async function launchServer(installPath) {
  try {
    const existing = await checkPort(APP_PORT);

    if (existing === 'other') {
      // Something unrelated is using this port — never touch it. The spawn
      // below will fail to bind and we'll report that honestly.
      return { started: false, port: APP_PORT, reason: 'port-taken-by-other' };
    }

    if (existing === 'ours') {
      console.log('Stopping the copy of The Shelf that is already running...');
      const freed = await freePort(APP_PORT);
      if (!freed) {
        // Typically started as a system service (systemd, as root) -- this
        // installer, running as an ordinary user, isn't allowed to stop it.
        // Starting the new copy now would just fail to get the port, while
        // the OLD version kept answering and looked like success.
        return { started: false, port: APP_PORT, reason: 'old-still-running' };
      }
    }

    let child;
    try {
      child = spawn(NODE_PATH, ['server.js'], {
        cwd: installPath,
        detached: true,
        stdio: 'ignore'
      });
    } catch (spawnErr) {
      // spawn() can throw synchronously for a handful of edge cases, not
      // just emit an async 'error' — cover both so neither can escape.
      console.log('Could not launch the app process:', spawnErr.message);
      return { started: false, port: APP_PORT, reason: 'start-failed' };
    }
    child.on('error', (err) => {
      // Without this handler, a failed spawn (bad path, permissions, etc.)
      // would throw an unhandled 'error' event and crash this entire
      // installer process mid-request — which is exactly what caused the
      // "Failed to fetch" bug. Logging it here keeps the installer alive so
      // it can report the failure properly instead.
      console.log('Could not launch the app process:', err.message);
    });
    child.unref();

    // Generous: a Raspberry Pi reading freshly copied files off an SD card
    // can take well over 8 seconds to start the first time.
    const started = await waitForServer(APP_PORT, 30000);
    return { started, port: APP_PORT, reason: started ? null : 'start-failed' };
  } catch (err) {
    // Last-resort net: whatever went wrong, report it as a normal failed
    // result instead of letting it escape as a rejected promise.
    console.log('Unexpected error while starting the app:', err.message);
    return { started: false, port: APP_PORT, reason: 'start-failed' };
  }
}

function openBrowser(url) {
  const cmd = PLATFORM === 'win32' ? `start "" "${url}"`
    : PLATFORM === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  try {
    execSync(cmd, { timeout: 5000, stdio: 'ignore' });
  } catch {
    console.log(`Could not open a browser automatically — open this URL yourself: ${url}`);
  }
}

module.exports = {
  defaultInstallPath, copyApp, setAutostart, launchServer,
  vbsLauncherContent, plistContent, desktopEntryContent
};

// Only run the installer server when this file is executed directly
// (so it can also be required for testing the pure functions above).
if (require.main === module) {
  const PAGE = fs.readFileSync(path.join(__dirname, 'setup-page.html'), 'utf8');

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PAGE.replace('__DEFAULT_PATH__', defaultInstallPath()).replace('__PLATFORM__', PLATFORM));
      return;
    }

    if (req.method === 'POST' && req.url === '/do-install') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const { installPath, autostart } = JSON.parse(body || '{}');
          const finalPath = (installPath && installPath.trim()) || defaultInstallPath();

          console.log(`Installing to ${finalPath} ...`);
          console.log('Copying app files (this is the slowest step — antivirus scanning can make it take a minute or two on Windows)...');
          copyApp(finalPath);
          console.log('Files copied.');

          setAutostart(finalPath, !!autostart);
          console.log('Checking for a previous version and starting the app...');
          const launch = await launchServer(finalPath);
          console.log(launch.started ? 'Started successfully.' : `Did not confirm startup (reason: ${launch.reason}).`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            installPath: finalPath,
            serverStarted: launch.started,
            appPort: launch.port,
            reason: launch.reason
          }));
          setTimeout(() => process.exit(0), 1500);
        } catch (err) {
          console.log('Install failed:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.on('error', (err) => {
    console.log(`Could not start the setup server: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${INSTALLER_PORT} is already in use — another copy of this setup may already be running.`);
      console.log(`If a setup window is already open, use that one. Otherwise, wait a few seconds and try again.`);
    }
    setTimeout(() => process.exit(1), 100);
  });

  server.listen(INSTALLER_PORT, '127.0.0.1', () => {
    const url = `http://localhost:${INSTALLER_PORT}`;
    console.log(`\nThe Shelf — Setup\nOpening ${url} in your browser...\n(If it doesn't open, visit that address manually.)\n`);
    openBrowser(url);
  });
}
