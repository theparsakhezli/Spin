const { app, BrowserWindow, dialog, globalShortcut, ipcMain, protocol, screen, shell } = require('electron');
const { execFile, spawn } = require('child_process');
const fsSync = require('fs');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

protocol.registerSchemesAsPrivileged([{
  scheme: 'spin-media',
  privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true },
}]);

const MINI = { width: 360, height: 124 };
const COMPACT = { width: 88, height: 88 };
const FULL_MIN = { width: 420, height: 560 };

let win = null;
let root = null;
let compact = false;
let detector = null;
let foregroundTimer = null;
let settings = { mode: 'mini', mini: null, full: null };
const settingsFile = () => path.join(app.getPath('userData'), 'window.json');

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fsSync.readFileSync(settingsFile(), 'utf8')) };
  } catch {}
}

function saveSettings() {
  rememberBounds();
  try {
    fsSync.writeFileSync(settingsFile(), JSON.stringify(settings));
  } catch {}
}

function rememberBounds() {
  if (!win || compact || win.isMinimized() || win.isFullScreen()) return;
  const bounds = win.getBounds();
  const prev = settings[settings.mode];
  /* Fractional display scaling rounds sizes up a pixel or two; keeping that would grow the window on every toggle. */
  if (prev && Math.abs(bounds.width - prev.width) <= 3 && Math.abs(bounds.height - prev.height) <= 3) {
    bounds.width = prev.width;
    bounds.height = prev.height;
  }
  settings[settings.mode] = bounds;
}

const onScreen = b => b && screen.getAllDisplays().some(({ workArea: a }) =>
  b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height);

function miniBounds() {
  const saved = settings.mini && { ...settings.mini, ...MINI };
  if (onScreen(saved)) return saved;
  const { workArea: a } = screen.getPrimaryDisplay();
  return { ...MINI, x: a.x + a.width - MINI.width - 16, y: a.y + Math.round(a.height * .38) };
}

function fullBounds() {
  if (onScreen(settings.full)) return settings.full;
  const { workArea: a } = screen.getPrimaryDisplay();
  const width = Math.min(1180, a.width), height = Math.min(760, a.height);
  return { width, height, x: a.x + Math.round((a.width - width) / 2), y: a.y + Math.round((a.height - height) / 2) };
}

function compactBounds() {
  const m = miniBounds();
  return { ...COMPACT, x: m.x + m.width - COMPACT.width, y: m.y + Math.round((m.height - COMPACT.height) / 2) };
}

/* Min and max stay equal in mini mode: a non-resizable frameless window loses its rounded Windows 11 corners. */
function applyMode() {
  const mini = settings.mode === 'mini';
  win.setMaximumSize(0, 0);
  win.setMinimumSize(1, 1);
  win.setBounds(!mini ? fullBounds() : compact ? compactBounds() : miniBounds());
  const { width, height } = !mini ? FULL_MIN : compact ? COMPACT : MINI;
  win.setMinimumSize(width, height);
  if (mini) win.setMaximumSize(width, height);
  win.setAlwaysOnTop(mini, 'screen-saver');
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(mini, { visibleOnFullScreen: mini });
}

/* ---------- settings.json: the one file a person edits by hand ---------- */

const configFile = () => path.join(app.getPath('userData'), 'settings.json');
const username = os.userInfo().username;
/* GNOME and KDE use Ctrl+Alt+arrows to switch workspaces, so Linux gets an extra Shift. */
const HOTKEY_PREFIX = process.platform === 'linux' ? 'Ctrl+Alt+Shift+' : 'Ctrl+Alt+';
const DEFAULT_CONFIG = {
  name: username.charAt(0).toUpperCase() + username.slice(1),
  hotkeys: {
    playPause: HOTKEY_PREFIX + 'Space',
    next: HOTKEY_PREFIX + 'Right',
    previous: HOTKEY_PREFIX + 'Left',
    volumeUp: HOTKEY_PREFIX + 'Up',
    volumeDown: HOTKEY_PREFIX + 'Down',
    mark: HOTKEY_PREFIX + 'M',
  },
  gameMode: true,
  games: ['dota2'],
};
let config = DEFAULT_CONFIG;
let failedHotkeys = [];

function loadConfig() {
  try {
    const saved = JSON.parse(fsSync.readFileSync(configFile(), 'utf8'));
    config = { ...DEFAULT_CONFIG, ...saved, hotkeys: { ...DEFAULT_CONFIG.hotkeys, ...saved.hotkeys } };
    return null;
  } catch (err) {
    if (err.code === 'ENOENT') {
      fsSync.writeFileSync(configFile(), JSON.stringify(DEFAULT_CONFIG, null, 2));
      return null;
    }
    return err.message;
  }
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  failedHotkeys = [];
  for (const accelerator of Object.values(config.hotkeys)) {
    if (!accelerator) continue;
    const command = Object.keys(config.hotkeys).find(k => config.hotkeys[k] === accelerator);
    let ok = false;
    try {
      ok = globalShortcut.register(accelerator, () => win && win.webContents.send('command', command));
    } catch {}
    if (!ok) failedHotkeys.push(accelerator);
  }
}

const publicConfig = () => ({ name: config.name, failedHotkeys });

function applyConfig() {
  const error = loadConfig();
  registerHotkeys();
  startDetector();
  if (win) win.webContents.send('config', { ...publicConfig(), error });
}

function watchConfig() {
  let timer;
  try {
    fsSync.watch(configFile(), () => {
      clearTimeout(timer);
      timer = setTimeout(applyConfig, 300);
    });
  } catch {}
}

/* ---------- game detection: Windows uses a small background PowerShell, macOS and X11 poll system tools ---------- */

const DETECTOR = String.raw`
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MI i);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] struct R { public int L, T, Rt, B; }
  [StructLayout(LayoutKind.Sequential)] struct MI { public int cb; public R m; public R w; public int f; }
  public static bool Shell(IntPtr h) {
    var s = new StringBuilder(64); GetClassName(h, s, 64); var c = s.ToString();
    return c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd";
  }
  public static bool Full(IntPtr h) {
    R r; if (!GetWindowRect(h, out r)) return false;
    var i = new MI(); i.cb = Marshal.SizeOf(i);
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref i)) return false;
    return r.L <= i.m.L && r.T <= i.m.T && r.Rt >= i.m.Rt && r.B >= i.m.B;
  }
}
'@
$last = ''
$lastPid = 0
while ($true) {
  if (-not (Get-Process -Id OWNER -ErrorAction SilentlyContinue)) { exit }
  $h = [W]::GetForegroundWindow()
  if ($h -ne [IntPtr]::Zero) {
    $p = [uint32]0; [void][W]::GetWindowThreadProcessId($h, [ref]$p)
    if ($p -eq OWNER) {
      if ($lastPid -and -not (Get-Process -Id $lastPid -ErrorAction SilentlyContinue)) {
        $lastPid = 0; $line = 'closed|False'
        if ($line -ne $last) { [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $last = $line }
      }
    } else {
      $lastPid = $p
      $shell = [W]::Shell($h)
      $name = (Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName
      $line = "$name|$(-not $shell -and [W]::Full($h))"
      if ($line -ne $last) { [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $last = $line }
    }
  }
  Start-Sleep -Seconds 2
}
`;

function stopDetector() {
  if (detector) detector.kill();
  detector = null;
  clearInterval(foregroundTimer);
  foregroundTimer = null;
}

const run = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, timeout: 1500 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

/* lsappinfo needs no Automation permission, unlike asking System Events. It cannot see fullscreen, so macOS relies on the games list. */
async function foregroundMac() {
  const front = (await run('lsappinfo', ['front'])).trim();
  const info = await run('lsappinfo', ['info', '-only', 'name', front]);
  const match = info.match(/"LSDisplayName"="(.*)"/);
  if (!match || match[1] === app.name) return null;
  return match[1] + '|False';
}

let lastForegroundPid = 0;
async function foregroundX11() {
  const id = (await run('xprop', ['-root', '_NET_ACTIVE_WINDOW'])).match(/0x[0-9a-f]+/i);
  const gone = lastForegroundPid && !fsSync.existsSync(`/proc/${lastForegroundPid}`);
  if (!id || id[0] === '0x0') return gone ? 'closed|False' : null;
  const props = await run('xprop', ['-id', id[0], '_NET_WM_PID', '_NET_WM_STATE']);
  const pid = props.match(/_NET_WM_PID\(CARDINAL\) = (\d+)/);
  if (!pid) return null;
  if (Number(pid[1]) === process.pid) return gone ? 'closed|False' : null;
  lastForegroundPid = Number(pid[1]);
  const name = fsSync.readFileSync(`/proc/${pid[1]}/comm`, 'utf8').trim();
  return name + '|' + (props.includes('_NET_WM_STATE_FULLSCREEN') ? 'True' : 'False');
}

/* Wayland deliberately hides the active window from apps, so there `g` is the way to switch game mode. */
function pollForeground() {
  const read = process.platform === 'darwin' ? foregroundMac : foregroundX11;
  if (process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland') return;
  let last = '';
  foregroundTimer = setInterval(async () => {
    try {
      const line = await read();
      if (line && line !== last) {
        last = line;
        onForeground(line);
      }
    } catch (err) {
      /* The tool is not installed: stop asking. A timeout or a closing window is worth retrying. */
      if (err.code === 'ENOENT') stopDetector();
    }
  }, 2000);
}

function onForeground(line) {
  const [name, full] = line.trim().split('|');
  const plain = s => s.toLowerCase().replace(/\.exe$/, '').replace(/\s+/g, '');
  const listed = config.games.some(g => plain(g) === plain(name));
  const active = listed || full === 'True';
  if (win) win.webContents.send('game', { active, name });
}

function startDetector() {
  stopDetector();
  if (!config.gameMode) return;
  if (process.platform !== 'win32') return pollForeground();
  const script = DETECTOR.replaceAll('OWNER', String(process.pid));
  detector = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  detector.on('error', () => { detector = null; });
  let pending = '';
  detector.stdout.on('data', chunk => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop();
    lines.forEach(onForeground);
  });
}

/* ---------- memory.json: what Spin has learned, only ever stored on this computer ---------- */

const memoryFile = () => path.join(app.getPath('userData'), 'memory.json');

async function walk(dir, out, seen = new Set()) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    /* Hidden entries are never music: .Trash, and the ._song.mp3 files macOS leaves on shared drives. */
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    let kind = entry;
    if (entry.isSymbolicLink()) {
      try {
        kind = await fs.stat(full);
      } catch {
        continue;
      }
    }
    if (kind.isDirectory()) {
      const real = await fs.realpath(full).catch(() => null);
      if (real && !seen.has(real)) {
        seen.add(real);
        await walk(full, out, seen);
      }
    } else if (kind.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function createWindow() {
  win = new BrowserWindow({
    ...MINI,
    show: false,
    frame: false,
    backgroundColor: '#0a0a0b',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });
  if (process.platform !== 'darwin') win.removeMenu();
  applyMode();
  win.loadFile('index.html', { query: { mode: settings.mode } });
  win.once('ready-to-show', () => win.show());
  win.on('close', saveSettings);
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('config', () => publicConfig());
ipcMain.handle('cursor-inside', () => {
  const { x, y } = screen.getCursorScreenPoint();
  const b = win.getBounds();
  return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
});
ipcMain.handle('open-config', () => shell.openPath(configFile()));

ipcMain.handle('memory-load', () => {
  let text;
  try {
    text = fsSync.readFileSync(memoryFile(), 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    /* Never overwrite history we failed to read. */
    fsSync.copyFileSync(memoryFile(), memoryFile() + '.bad');
    return null;
  }
});

ipcMain.on('memory-save', (e, text) => {
  try {
    const temp = memoryFile() + '.tmp';
    fsSync.writeFileSync(temp, text);
    fsSync.renameSync(temp, memoryFile());
  } catch {}
  e.returnValue = true;
});

ipcMain.handle('set-compact', (_e, on) => {
  if (settings.mode !== 'mini' || on === compact) return compact;
  rememberBounds();
  compact = !!on;
  applyMode();
  return compact;
});

ipcMain.handle('set-mode', (_e, mode) => {
  if (mode !== 'mini' && mode !== 'full') return settings.mode;
  if (win.isFullScreen()) win.setFullScreen(false);
  rememberBounds();
  compact = false;
  settings.mode = mode;
  applyMode();
  saveSettings();
  return mode;
});

ipcMain.on('window-background', (_e, colour) => {
  if (win && /^#[0-9a-f]{6}$/i.test(colour)) win.setBackgroundColor(colour);
});

ipcMain.on('window', (_e, action) => {
  if (action === 'close') win.close();
  if (action === 'minimize') win.minimize();
});

/* Writes only where the person just chose in the system dialog. */
ipcMain.handle('save-file', async (_e, name, bytes) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save',
    defaultPath: path.join(app.getPath('downloads'), path.basename(String(name))),
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, Buffer.from(bytes));
  return filePath;
});

ipcMain.handle('pick-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open music folder',
    defaultPath: app.getPath('music'),
    properties: ['openDirectory'],
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('scan', async (_e, folder) => {
  await fs.access(folder);
  root = path.resolve(folder);
  /* Seeded with the folder itself, so a symlink pointing back at it cannot list every song twice. */
  const files = await walk(root, [], new Set([await fs.realpath(root)]));
  return {
    name: path.basename(root) || root,
    files: await Promise.all(files.map(async full => ({
      full,
      path: path.relative(root, full).split(path.sep).join('/'),
      size: (await fs.stat(full).catch(() => ({ size: 0 }))).size,
      url: 'spin-media://track/' + encodeURIComponent(full),
    }))),
  };
});

/* The renderer can only read inside the folder the user opened. */
function checkedPath(file) {
  const full = path.resolve(file);
  const inside = root && path.relative(root, full);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('outside the open folder');
  return full;
}

ipcMain.handle('read-range', async (_e, file, start, length) => {
  const handle = await fs.open(checkedPath(file), 'r');
  try {
    const buffer = Buffer.alloc(Math.min(length, 64 * 1024 * 1024));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
});

const MEDIA_TYPES = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.weba': 'audio/webm', '.webm': 'audio/webm',
};

/* Tracks stream from disk with range requests, so a song starts at once and file size stops mattering. */
async function serveTrack(request) {
  const headers = { 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
  let full;
  try {
    full = checkedPath(decodeURIComponent(new URL(request.url).pathname.slice(1)));
  } catch {
    return new Response(null, { status: 403 });
  }
  let size;
  try {
    ({ size } = await fs.stat(full));
  } catch {
    return new Response(null, { status: 404 });
  }
  headers['Content-Type'] = MEDIA_TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream';
  if (!size) return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } });
  const range = (request.headers.get('range') || '').match(/^bytes=(\d*)-(\d*)$/);
  let start = 0, end = size - 1, status = 200;
  if (range && (range[1] || range[2])) {
    status = 206;
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), end);
    } else {
      start = Math.max(0, size - Number(range[2]));
    }
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  return new Response(Readable.toWeb(fsSync.createReadStream(full, { start, end })), { status, headers });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(() => {
    protocol.handle('spin-media', serveTrack);
    loadSettings();
    loadConfig();
    createWindow();
    registerHotkeys();
    startDetector();
    watchConfig();
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopDetector();
  });
  app.on('window-all-closed', () => app.quit());
}
