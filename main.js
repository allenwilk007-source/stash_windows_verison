// Stash — macOS app shell.
// • Main window: the full Stash app (index.html).
// • Menu-bar icon: click for the quick panel (drop files, quick note, ask, recent);
//   drag files straight onto the icon to have Smart Sort file them.
// • Everything is saved to ~/Library/Application Support/Stash/stash-data.json.
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, shell, globalShortcut, Notification, net } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null, tray = null, pop = null, quitting = false, pendingUpdate = null;

// ---------- self-update from GitHub ----------
// The app checks version.json in the GitHub repo. If it's newer, the new files are
// downloaded into ~/Library/Application Support/Stash/app and used from the next launch.
const REPO = 'charliecurrin/stash';
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
const localVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8')).version; } catch (e) { return '0.0.0'; } };
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++){ if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; };
async function fetchBuf(url){ const r = await net.fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()); }
async function checkForUpdates(manual){
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
    for (const f of remote.files) fs.writeFileSync(path.join(tmp, f), await fetchBuf(`${RAW}/${encodeURI(f)}?t=${Date.now()}`));
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

// only one copy of the app at a time
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showMain());

function createWindow(){
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 760, minHeight: 520, show: false,
    title: 'Stash', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#141416',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());
  // closing the window keeps Stash running in the menu bar
  win.on('close', e => { if (!quitting){ e.preventDefault(); win.hide(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function createPopover(){
  pop = new BrowserWindow({
    width: 340, height: 590, show: false, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, transparent: true, hasShadow: true, alwaysOnTop: true,
    vibrancy: 'popover', visualEffectState: 'active', roundedCorners: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  pop.loadFile('quick.html');
  pop.on('blur', () => { if (!pop.webContents.isDevToolsOpened()) pop.hide(); });
}

function togglePopover(){
  if (pop.isVisible()) return pop.hide();
  const b = tray.getBounds(), w = pop.getBounds().width;
  pop.setPosition(Math.round(b.x + b.width / 2 - w / 2), Math.round(b.y + b.height + 4), false);
  pop.show(); pop.focus();
  pop.webContents.send('refresh');
}

function showMain(){ if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

function sendFiles(paths){
  const files = [];
  for (const p of paths){
    try {
      if (!fs.statSync(p).isFile()) continue;
      files.push({ name: path.basename(p), type: mimeOf(p), data: fs.readFileSync(p).toString('base64') });
    } catch (e) { /* unreadable file — skip */ }
  }
  if (!files.length) return;
  win.webContents.send('intake', files);
  status(`Sorting ${files.length} file${files.length > 1 ? 's' : ''}…`);
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

app.whenReady().then(() => {
  createWindow();
  createPopover();

  const icon = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Stash — click for quick actions, or drop files here');
  tray.on('click', togglePopover);
  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()));
  tray.on('drop-files', (e, files) => sendFiles(files));       // drag files onto the menu-bar icon

  globalShortcut.register('CommandOrControl+Shift+S', togglePopover);

  // ---- storage ----
  ipcMain.handle('store:load', () => { try { return fs.readFileSync(dataFile(), 'utf8'); } catch (e) { return null; } });
  ipcMain.on('store:save', (e, json) => {
    const tmp = dataFile() + '.tmp';
    fs.writeFile(tmp, json, err => { if (!err) fs.rename(tmp, dataFile(), () => {}); });
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
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', e => e.preventDefault()); // keep living in the menu bar
