// Stash — macOS app shell.
// • Main window: the full Stash app (index.html).
// • Menu-bar icon: click for the quick panel (drop files, quick note, ask, recent);
//   drag files straight onto the icon to have Smart Sort file them.
// • Everything is saved to ~/Library/Application Support/Stash/stash-data.json.
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, shell, globalShortcut, Notification, net, screen, session, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const AI = require(path.join(__dirname, 'ai.js'));

const IS_MAC = process.platform === 'darwin', IS_WIN = process.platform === 'win32';
let watcher = null, watcherOK = false;
let win = null, tray = null, pop = null, isl = null, islandKey = '', quitting = false, pendingUpdate = null;

// ---------- self-update from GitHub ----------
// The app checks version.json in the GitHub repo. If it's newer, the new files are
// downloaded into ~/Library/Application Support/Stash/app and used from the next launch.
const REPO = 'charliecurrin/stash';
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
// (boot.js has its own copy of `newer` on purpose: boot.js ships inside the app and is never
// replaced by an update, so it can't rely on code from a newer main.js — keep the two in step.)
const localVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8')).version; } catch (e) { return '0.0.0'; } };
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++){ if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; };
async function fetchBuf(url){ const r = await net.fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()); }
async function checkForUpdates(manual){
  // The GitHub repo ships the Mac build. Auto-updating from it would replace this
  // Windows-patched main.js with the Mac one, so on Windows updates come from re-running
  // install-windows.ps1 instead.
  if (IS_WIN){
    if (manual) dialog.showMessageBox({ message: `Stash ${localVersion()} for Windows`, detail: 'To update, run install-windows.ps1 again from your Stash folder.' });
    return;
  }
  try {
    const remote = JSON.parse((await fetchBuf(`${RAW}/version.json?t=${Date.now()}`)).toString('utf8'));
    if (!newer(remote.version, localVersion())){
      if (manual) dialog.showMessageBox({ message: 'Stash is up to date', detail: `You're on version ${localVersion()}.` });
      return;
    }
    pendingUpdate = remote;
    if (win && !win.isDestroyed()) win.webContents.send('update-available', { version: remote.version, notes: remote.notes || '' });
    if (pop && !pop.isDestroyed()) pop.webContents.send('status', `Update ${remote.version} available — open Stash to install`);
    if (manual) installUpdate();
  } catch (e) { if (manual) dialog.showMessageBox({ type: 'warning', message: "Couldn't check for updates", detail: String(e.message || e) }); }
}
async function installUpdate(){
  const remote = pendingUpdate; if (!remote) return;
  const base = path.join(app.getPath('userData'), 'app'), tmp = base + '.new';
  try {
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    // only plain file names, never paths — a name like "../x" must not write outside the app folder
    const files = Array.isArray(remote.files) ? remote.files : [];
    const bad = files.filter(f => typeof f !== 'string' || !/^[\w@.-]+$/.test(f) || f.startsWith('.'));
    if (!files.length || bad.length) throw new Error('The update lists files Stash refuses to install: ' + (bad.join(', ') || '(none)'));
    for (const f of files) fs.writeFileSync(path.join(tmp, f), await fetchBuf(`${RAW}/${encodeURI(f)}?t=${Date.now()}`));
    fs.writeFileSync(path.join(tmp, 'version.json'), JSON.stringify(remote, null, 2));
    fs.rmSync(base, { recursive: true, force: true }); fs.renameSync(tmp, base);
    quitting = true; app.relaunch(); app.exit(0);
  } catch (e) {
    dialog.showMessageBox({ type: 'warning', message: "The update couldn't be installed", detail: String(e.message || e) });
  }
}
const dataFile = () => path.join(app.getPath('userData'), 'stash-data.json');

const MIME = {png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', heic:'image/heic', svg:'image/svg+xml',
  mp4:'video/mp4', mov:'video/quicktime', m4v:'video/x-m4v', webm:'video/webm', pdf:'application/pdf', txt:'text/plain', md:'text/markdown',
  csv:'text/csv', json:'application/json', html:'text/html', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
const mimeOf = p => MIME[path.extname(p).slice(1).toLowerCase()] || 'application/octet-stream';

// only one copy of the app at a time — a second copy exits immediately, before it makes
// any windows or grabs any shortcuts (app.quit() alone lets startup carry on briefly)
const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.exit(0);
app.on('second-instance', () => showMain());

// ---------- safety: Stash's windows only ever show Stash's own pages ----------
// Links open in the real browser, and only web/mail links. Nothing can load a website
// *inside* a Stash window, because those windows have the stashNative bridge (your whole
// library, saving, the AI) and a website must never get that.
const isWebLink = u => { try { return ['http:', 'https:', 'mailto:'].includes(new URL(u).protocol); } catch (e) { return false; } };
const openLink = u => { if (isWebLink(u)) shell.openExternal(u); };
app.on('web-contents-created', (e, wc) => {
  wc.setWindowOpenHandler(({ url }) => { openLink(url); return { action: 'deny' }; });
  wc.on('will-navigate', (ev, url) => { if (!url.startsWith('file:')){ ev.preventDefault(); openLink(url); } });
  wc.on('will-redirect', (ev, url) => { if (!url.startsWith('file:')){ ev.preventDefault(); } });
  wc.on('will-attach-webview', ev => ev.preventDefault());
});

function createWindow(){
  // Mac: traffic lights inset into Stash's own toolbar. Windows: hide the title bar and
  // draw the native minimise / maximise / close buttons over the right end of the toolbar.
  const chrome = IS_MAC
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }
    : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#141416', symbolColor: '#d8d8dc', height: 45 }, icon: path.join(__dirname, 'icon.png') };
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 760, minHeight: 520, show: false,
    title: 'Stash', ...chrome,
    backgroundColor: '#141416',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  if (!IS_MAC){
    // no traffic-light gap on the left; keep toolbar buttons clear of the window controls on the right
    win.webContents.on('did-finish-load', () => win.webContents.insertCSS('body.native .lights{display:none} body.native .bar{padding-right:150px}'));
  }
  win.once('ready-to-show', () => win.show());
  // closing the window keeps Stash running in the menu bar
  win.on('close', e => { if (!quitting){ e.preventDefault(); win.hide(); } });
}

function createPopover(){
  pop = new BrowserWindow({
    width: 340, height: 590, show: false, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, transparent: true, hasShadow: true, alwaysOnTop: true,
    vibrancy: 'popover', visualEffectState: 'active', roundedCorners: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  pop.loadFile(path.join(__dirname, 'quick.html'));
  pop.on('blur', () => { if (!pop.webContents.isDevToolsOpened()) pop.hide(); });
  if (!IS_MAC){
    // show Ctrl / Shift instead of the Mac ⌘ / ⇧ key symbols
    pop.webContents.on('did-finish-load', () => pop.webContents.executeJavaScript(
      `document.querySelectorAll('kbd').forEach(k => { const m = { '⌘': 'Ctrl', '⇧': 'Shift', '⌥': 'Alt' }[k.textContent]; if (m) k.textContent = m; })`).catch(() => {}));
  }
}

// ---------- the island: ⌘⌥ voice / type bar that drops out of the notch ----------
const ISL_W = 640, ISL_H = 520;
function createIsland(){
  isl = new BrowserWindow({
    width: ISL_W, height: ISL_H, show: false, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
    roundedCorners: false, enableLargerThanScreen: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  isl.setAlwaysOnTop(true, 'screen-saver');
  isl.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  isl.setIgnoreMouseEvents(true, { forward: true });
  isl.loadFile(path.join(__dirname, 'island.html'));
  isl.on('blur', () => isl.webContents.send('island:blur'));
}
async function toggleIsland(){
  if (isl.isVisible()){ isl.webContents.send('island:hotkey'); return; }
  if (pop && pop.isVisible()) pop.hide();
  // sit centred on the top edge of the screen the mouse is on (over the notch / menu bar)
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
  isl.setBounds({ x: Math.round(d.x + d.width / 2 - ISL_W / 2), y: d.y, width: ISL_W, height: ISL_H });
  try { if (systemPreferences.getMediaAccessStatus('microphone') === 'not-determined') await systemPreferences.askForMediaAccess('microphone'); } catch (e) {}
  await AI.preCapture();            // grab the screen *before* the island covers any of it
  AI.reset();                       // each time you open the island is a fresh conversation
  isl.show(); isl.focus();
  isl.webContents.send('island:open');
}

// ---------- tap ⌘⌥ (just the two keys) to open the island ----------
// macOS apps can't register a shortcut that's only modifier keys, so a tiny built-in
// macOS script watches the ⌘ and ⌥ keys (no extra permissions needed). A quick tap of
// ⌘⌥ together — with no other key pressed — opens the island. ⌘⌥ + another key is ignored,
// so normal shortcuts like ⌘⌥Esc keep working.
const WATCH = `
ObjC.import('Cocoa'); ObjC.import('CoreGraphics');
var CMD = 1 << 20, OPT = 1 << 19, SH = 1 << 17, CTL = 1 << 18;
var out = $.NSFileHandle.fileHandleWithStandardOutput;
function say(s){ out.writeData($(s + '\\n').dataUsingEncoding($.NSUTF8StringEncoding)); }
function sinceKey(){ try { return $.CGEventSourceSecondsSinceLastEventType(0, 10); } catch (e) { return 999; } }
say('ready');
var down = false, t0 = 0;
while (true){
  var f = $.NSEvent.modifierFlags;
  var both = (f & CMD) && (f & OPT) && !(f & SH) && !(f & CTL);
  if (both && !down){ down = true; t0 = Date.now(); }
  else if (!both && down){
    down = false;
    var held = (Date.now() - t0) / 1000;
    if (held > 0.05 && held < 1.5 && sinceKey() > held - 0.03) say('tap');
  }
  delay(0.05);   // 20 checks a second is plenty to catch a tap (was 33/s — less battery use)
}`;
function startModifierWatcher(){
  if (process.platform !== 'darwin' || quitting) return;
  try {
    watcher = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', WATCH], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    watcher.stdout.on('data', d => {
      buf += d.toString(); let i;
      while ((i = buf.indexOf('\n')) >= 0){
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line === 'ready') watcherOK = true;
        if (line === 'tap') toggleIsland();
      }
    });
    watcher.stderr.on('data', d => console.warn('modifier watcher:', d.toString()));
    watcher.on('exit', () => { watcherOK = false; watcher = null; if (!quitting) setTimeout(startModifierWatcher, 3000); });
  } catch (e) { console.warn('modifier watcher failed', e); }
}

function togglePopover(){
  if (pop.isVisible()) return pop.hide();
  const b = tray.getBounds(), { width: w, height: h } = pop.getBounds();
  const wa = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
  // Mac menu bar is at the top → open below the icon; Windows taskbar is usually at the
  // bottom → open above it. Either way keep the panel fully on screen.
  const below = b.y + b.height / 2 < wa.y + wa.height / 2;
  let x = Math.round(b.x + b.width / 2 - w / 2), y = below ? Math.round(b.y + b.height + 4) : Math.round(b.y - h - 4);
  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - w - 8));
  y = Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - h - 8));
  pop.setPosition(x, y, false);
  pop.show(); pop.focus();
  pop.webContents.send('refresh');
}

function showMain(){ if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

// Files dropped on the tray icon / picked from the menu are sent to the main window one at a
// time as raw bytes. (Before, every file was read at once and turned into base64 text — a
// third bigger — so a few large videos could use gigabytes of memory.)
const MAX_INTAKE = 2 * 1024 ** 3;   // 2 GB per file
async function sendFiles(paths){
  let sent = 0, skipped = 0;
  for (const p of paths){
    try {
      const st = await fs.promises.stat(p);
      if (!st.isFile()) continue;
      if (st.size > MAX_INTAKE){ skipped++; continue; }
      const bytes = await fs.promises.readFile(p);
      win.webContents.send('intake', [{ name: path.basename(p), type: mimeOf(p), bytes }]);
      sent++;
    } catch (e) { /* unreadable file — skip */ }
  }
  if (skipped) status(`Skipped ${skipped} file${skipped > 1 ? 's' : ''} over 2 GB`, true);
  if (sent) status(`Sorting ${sent} file${sent > 1 ? 's' : ''}…`);
}

function status(msg, needsAttention){
  if (pop && !pop.isDestroyed()) pop.webContents.send('status', msg);
  // when neither window is in front, tell the user with a notification
  const away = !(pop && pop.isVisible()) && !(win && win.isFocused());
  if (away && Notification.isSupported() && /Filed|needs|Saved/.test(msg)){
    const n = new Notification({ title: 'Stash', body: msg, silent: !needsAttention });
    n.on('click', showMain); n.show();
  }
}

function buildTrayMenu(){
  return Menu.buildFromTemplate([
    { label: 'Open Stash', click: showMain },
    { label: 'Quick Panel', accelerator: 'CommandOrControl+Shift+S', click: togglePopover },
    { label: `Talk to Stash   ${watcherOK ? 'tap ⌘⌥' : ''}${watcherOK && islandKey ? '  or  ' : ''}${islandKey}`, click: toggleIsland },
    { label: 'Add Files to Sort…', click: pickFiles },
    { type: 'separator' },
    pendingUpdate ? { label: `Install Update ${pendingUpdate.version}…`, click: installUpdate } : { label: 'Check for Updates…', click: () => checkForUpdates(true) },
    { label: `Stash ${localVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit Stash', role: 'quit' }
  ]);
}

async function pickFiles(){
  const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], title: 'Add files to Stash' });
  if (!r.canceled) sendFiles(r.filePaths);
}

// Windows notifications need an app ID that matches a Start Menu shortcut
if (IS_WIN) app.setAppUserModelId('com.charlie.stash');

app.whenReady().then(() => {
  if (!firstInstance) return;
  if (IS_WIN){
    try {
      const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Stash.lnk');
      shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', { target: process.execPath, appUserModelId: 'com.charlie.stash', icon: path.join(path.dirname(process.execPath), 'stash.ico'), iconIndex: 0, description: 'Stash' });
    } catch (e) { console.warn('start menu shortcut failed', e); }
  }
  createWindow();
  createPopover();
  createIsland();
  // allow the microphone for Stash's own pages (file://) only
  const micPerm = (perm, url) => (perm === 'media' || perm === 'microphone' || perm === 'audioCapture') && String(url || '').startsWith('file:');
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(micPerm(perm, details?.requestingUrl || wc?.getURL())));
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin, details) => micPerm(perm, details?.requestingUrl || wc?.getURL() || origin));

  let icon;
  if (IS_MAC){ icon = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png')); icon.setTemplateImage(true); }
  else icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16, quality: 'best' });  // the black template icon is invisible on a dark taskbar
  tray = new Tray(icon);
  tray.setToolTip('Stash — click for quick actions, or drop files here');
  tray.on('click', togglePopover);
  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()));
  tray.on('drop-files', (e, files) => sendFiles(files));       // drag files onto the menu-bar icon

  globalShortcut.register('CommandOrControl+Shift+S', togglePopover);
  // ⌘⌥ + Space opens the island (falls back to ⌘⌥ + Return if Space is taken by the system)
  // backup keyboard shortcut (⌘⌥Space is often Finder search, so try ⌘⌥Return first)
  const islandKeys = IS_MAC
    ? [['Command+Alt+Return', '⌘⌥Return'], ['Command+Alt+Space', '⌘⌥Space'], ['Command+Alt+K', '⌘⌥K']]
    : [['Control+Alt+Space', 'Ctrl+Alt+Space'], ['Control+Alt+Return', 'Ctrl+Alt+Enter'], ['Control+Alt+K', 'Ctrl+Alt+K']];
  for (const [acc, label] of islandKeys){
    try { if (globalShortcut.register(acc, toggleIsland) && globalShortcut.isRegistered(acc)){ islandKey = label; break; } } catch (e) {}
  }
  startModifierWatcher();
  ipcMain.on('island:toggle', () => toggleIsland());
  ipcMain.on('island:close', () => { isl.hide(); isl.setIgnoreMouseEvents(true, { forward: true }); });
  ipcMain.on('island:mouse', (e, over) => isl.setIgnoreMouseEvents(!over, { forward: true }));
  // ---- the AI ----
  const execInMain = js => win.webContents.executeJavaScript(js);
  ipcMain.handle('ai:ask', async (e, q) => {
    const status = msg => { try { e.sender.send('island:status', msg); } catch (err) {} };
    try {
      const r = await AI.ask(String(q), { exec: execInMain, status });
      if (r) return r;
      // no AI set up yet: do simple Stash commands, and offer the free AI for everything else
      const c = await execInMain(`window.Stash.command(${JSON.stringify(String(q))})`);
      if (!c.done && !(c.sources || []).length) c.text = "Connect Claude below and I can answer that (and read your screen).";
      return { ...c, needsAI: !c.done, setup: await AI.status() };
    } catch (err) { return { text: 'Something went wrong: ' + (err.message || err) }; }
  });
  ipcMain.handle('ai:setKey', async (e, key, model) => {
    const r = await AI.setKey(key, model);
    if (r.ok) [win, isl].forEach(w => { if (w && !w.isDestroyed()) w.webContents.send('ai-creds', AI.creds()); });
    return r;
  });
  ipcMain.handle('ai:creds', () => AI.creds());
  // The Claude key never goes to the pages: they send the request body here and the main
  // process adds the key. claudeStream sends text as it arrives via 'ai:claude-delta'.
  ipcMain.handle('ai:claude', (e, body) => AI.claudeRequest(body));
  ipcMain.handle('ai:claude-stream', (e, id, body) => AI.claudeStream(body, text => { try { e.sender.send('ai:claude-delta', id, text); } catch (err) {} }));
  // ---- sign-in links: the email link opens http://127.0.0.1:51789/auth, which hands the session to Stash ----
  let authServer = null;
  ipcMain.handle('auth:listen', () => {
    if (authServer) return true;
    const http = require('http');
    authServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/token'){
        // Only the sign-in page this server serves may hand over tokens. Browsers always send
        // an Origin header on a cross-site POST, so a random website trying to sign Stash into
        // *its* account is refused here.
        if (req.headers.origin !== 'http://127.0.0.1:51789'){ res.writeHead(403); res.end(); return; }
        let b = ''; req.on('data', d => { b += d; if (b.length > 20000) req.destroy(); });
        req.on('end', () => {
          try { const t = JSON.parse(b); if (t.access_token && t.refresh_token){ win.webContents.send('auth-tokens', t); showMain(); } } catch (e) {}
          res.writeHead(204); res.end();
        });
        return;
      }
      if (req.url.startsWith('/auth')){
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Stash</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#141416;color:#f2f2f3;font:15px -apple-system,system-ui,sans-serif"><div style="text-align:center"><div style="width:46px;height:46px;border-radius:50%;margin:0 auto 14px;background:radial-gradient(circle at 32% 28%,#fff6d8,#f3dca0 18%,#7fa8f0 46%,#2c58c8 72%,#14204a)"></div><h2 id="h" style="margin:0 0 6px">Signing you in…</h2><p id="p" style="color:#999;margin:0">One moment.</p></div>
<script>const q=new URLSearchParams(location.hash.slice(1)+'&'+location.search.slice(1));const at=q.get('access_token'),rt=q.get('refresh_token'),er=q.get('error_description');
if(at&&rt){fetch('/token',{method:'POST',body:JSON.stringify({access_token:at,refresh_token:rt})}).then(()=>{h.textContent="You're signed in";p.textContent='Head back to Stash — you can close this tab.';history.replaceState(null,'','/auth')})}
else{h.textContent="That link didn't work";p.textContent=er||'It may have expired. Go back to Stash and send a new code.'}</script></body>`);
        return;
      }
      res.writeHead(404); res.end();
    });
    authServer.on('error', () => { authServer = null; });
    authServer.listen(51789, '127.0.0.1');
    return true;
  });
  // ---- uploaded videos/docs live as real files on disk ----
  const filesDir = () => { const d = path.join(app.getPath('userData'), 'files'); fs.mkdirSync(d, { recursive: true }); return d; };
  const destFor = name => path.join(filesDir(), Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '-' + String(name || 'file').replace(/[^\w.\- ]+/g, '_').slice(-80));
  ipcMain.handle('pdf:save', async (e, name) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(w, { defaultPath: path.join(app.getPath('documents'), String(name || 'Note').replace(/[\/:*?"<>|]+/g, '-').slice(0, 80) + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (canceled || !filePath) return false;
    const data = await e.sender.printToPDF({ printBackground: true, pageSize: 'Letter', margins: { marginType: 'default' } });
    fs.writeFileSync(filePath, data); shell.showItemInFolder(filePath); return true;
  });
  ipcMain.handle('files:copy', (e, src, name) => { const d = destFor(name || path.basename(src)); fs.copyFileSync(src, d); return require('url').pathToFileURL(d).href; });
  ipcMain.handle('files:write', (e, name, bytes) => { const d = destFor(name); fs.writeFileSync(d, Buffer.from(bytes)); return require('url').pathToFileURL(d).href; });
  ipcMain.handle('ai:status', () => AI.status());
  // the free on-device AI (Ollama) was switched off; its download/start-up code has been removed
  ipcMain.handle('ai:setupLocal', () => ({ ok: false, error: 'The free on-device AI is no longer available — connect Claude instead.' }));
  ipcMain.handle('island:command', async (e, q) => {
    try { return await win.webContents.executeJavaScript(`window.Stash && window.Stash.command ? window.Stash.command(${JSON.stringify(String(q))}) : null`); }
    catch (err) { return { text: 'Something went wrong: ' + (err.message || err) }; }
  });
  ipcMain.on('island:open-item', (e, target) => { showMain(); win.webContents.send('open', target); });
  ipcMain.handle('island:key', () => watcherOK ? '⌘⌥' : islandKey);

  // ---- storage ----
  ipcMain.handle('store:load', () => { try { return fs.readFileSync(dataFile(), 'utf8'); } catch (e) { return null; } });
  // One save at a time: if a new snapshot arrives while one is being written, it waits and
  // only the newest waiting snapshot is written next (older ones are already out of date).
  // Each write goes to its own temp file and is then swapped in, so a crash mid-write never
  // leaves a half-written library. Failures are reported instead of silently ignored.
  let writing = false, queued = null, saveSeq = 0, saveFailed = false;
  const reportSave = err => {
    if (err && !saveFailed){ saveFailed = true; dialog.showMessageBox({ type: 'warning', message: "Stash couldn't save your changes", detail: String(err.message || err) + '\n\nStash will keep trying. Check that your disk isn\'t full.' }); }
    if (!err) saveFailed = false;
  };
  let finalSaved = false;   // once the closing save is on disk, no older background save may replace it
  async function writeStore(json){
    if (finalSaved) return;
    if (writing){ queued = json; return; }
    writing = true;
    const tmp = `${dataFile()}.${process.pid}.${++saveSeq}.tmp`;
    try {
      await fs.promises.writeFile(tmp, json);
      if (finalSaved) await fs.promises.rm(tmp, { force: true });
      else { await fs.promises.rename(tmp, dataFile()); reportSave(null); }
    }
    catch (err) { reportSave(err); fs.promises.rm(tmp, { force: true }).catch(() => {}); }
    writing = false;
    if (queued !== null){ const next = queued; queued = null; writeStore(next); }
  }
  ipcMain.on('store:save', (e, json) => writeStore(json));
  // final save when the window is closing: written synchronously so it's on disk before the app exits
  ipcMain.on('store:save-now', (e, json) => {
    queued = null;
    const tmp = `${dataFile()}.${process.pid}.final.tmp`;
    try { fs.writeFileSync(tmp, json); fs.renameSync(tmp, dataFile()); finalSaved = quitting; e.returnValue = true; }
    catch (err) { console.warn('final save failed', err); e.returnValue = false; }
  });

  // ---- main window → menu bar ----
  ipcMain.on('status', (e, msg, attention) => status(msg, attention));

  // ---- quick panel actions ----
  ipcMain.on('quick:files', (e, paths) => sendFiles(paths));
  ipcMain.on('quick:pick', () => { pop.hide(); pickFiles(); });
  ipcMain.on('quick:note', (e, text) => win.webContents.send('quick-note', text));
  ipcMain.on('quick:ask', (e, q) => { pop.hide(); showMain(); win.webContents.send('ask', q); });
  ipcMain.on('quick:open', (e, target) => { pop.hide(); showMain(); win.webContents.send('open', target); });
  ipcMain.on('quick:hide', () => pop.hide());
  ipcMain.on('quick:quit', () => { quitting = true; app.quit(); });
  ipcMain.on('update:install', installUpdate);
  ipcMain.on('update:check', () => checkForUpdates(true));
  setTimeout(() => checkForUpdates(false), 4000);
  setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000);
  ipcMain.handle('quick:recent', async () => {
    try { return await win.webContents.executeJavaScript('window.Stash ? {items: window.Stash.recent(), count: window.Stash.count()} : null'); }
    catch (e) { return null; }
  });
});

app.on('activate', showMain);                 // clicking the Dock icon
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); try { watcher && watcher.kill(); } catch (e) {} AI.stop(); });
app.on('window-all-closed', e => e.preventDefault()); // keep living in the menu bar
