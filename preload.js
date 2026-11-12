// Safe bridge between the Stash pages and the desktop app.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('stashNative', {
  // main window
  load: () => ipcRenderer.invoke('store:load'),
  save: json => ipcRenderer.send('store:save', json),
  saveNow: json => ipcRenderer.sendSync('store:save-now', json),   // blocking: used only while closing
  status: (msg, attention) => ipcRenderer.send('status', msg, !!attention),
  onIntake: cb => ipcRenderer.on('intake', (e, files) => cb(files)),
  onQuickNote: cb => ipcRenderer.on('quick-note', (e, text) => cb(text)),
  onAsk: cb => ipcRenderer.on('ask', (e, q) => cb(q)),
  onOpen: cb => ipcRenderer.on('open', (e, target) => cb(target)),
  onUpdate: cb => ipcRenderer.on('update-available', (e, info) => cb(info)),
  installUpdate: () => ipcRenderer.send('update:install'),
  checkUpdates: () => ipcRenderer.send('update:check'),

  // menu-bar quick panel
  dropFiles: files => ipcRenderer.send('quick:files', [...files].map(f => webUtils.getPathForFile(f)).filter(Boolean)),
  pickFiles: () => ipcRenderer.send('quick:pick'),
  quickNote: text => ipcRenderer.send('quick:note', text),
  ask: q => ipcRenderer.send('quick:ask', q),
  open: target => ipcRenderer.send('quick:open', target),
  recent: () => ipcRenderer.invoke('quick:recent'),
  hide: () => ipcRenderer.send('quick:hide'),
  quit: () => ipcRenderer.send('quick:quit'),
  onRefresh: cb => ipcRenderer.on('refresh', () => cb()),

  // the ⌘⌥ island
  onIslandOpen: cb => ipcRenderer.on('island:open', () => cb()),
  onIslandHotkey: cb => ipcRenderer.on('island:hotkey', () => cb()),
  onIslandBlur: cb => ipcRenderer.on('island:blur', () => cb()),
  islandClose: () => ipcRenderer.send('island:close'),
  islandMouse: over => ipcRenderer.send('island:mouse', !!over),
  islandCommand: q => ipcRenderer.invoke('island:command', q),
  islandOpenItem: target => ipcRenderer.send('island:open-item', target),
  islandKey: () => ipcRenderer.invoke('island:key'),
  islandToggle: () => ipcRenderer.send('island:toggle'),
  onIslandStatus: cb => ipcRenderer.on('island:status', (e, m) => cb(m)),
  aiAsk: q => ipcRenderer.invoke('ai:ask', q),
  aiSetKey: (key, model) => ipcRenderer.invoke('ai:setKey', key, model),
  aiCreds: () => ipcRenderer.invoke('ai:creds'),
  // Claude requests go through the app, which adds the saved key (the page never sees it)
  claude: body => ipcRenderer.invoke('ai:claude', body),
  claudeStream: async (body, onText) => {
    const id = Math.random().toString(36).slice(2);
    const fn = (e, rid, text) => { if (rid === id) onText(text); };
    ipcRenderer.on('ai:claude-delta', fn);
    try { return await ipcRenderer.invoke('ai:claude-stream', id, body); }
    finally { ipcRenderer.removeListener('ai:claude-delta', fn); }
  },
  onAICreds: cb => ipcRenderer.on('ai-creds', (e, c) => cb(c)),
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  authListen: () => ipcRenderer.invoke('auth:listen'),
  onAuthTokens: cb => ipcRenderer.on('auth-tokens', (e, t) => cb(t)),
  // copy an uploaded file into Stash's own files folder → returns a file:// URL
  storeFile: async file => {
    let p = ''; try { p = webUtils.getPathForFile(file); } catch (e) {}
    if (p) return ipcRenderer.invoke('files:copy', p, file.name);
    return ipcRenderer.invoke('files:write', file.name, new Uint8Array(await file.arrayBuffer()));
  },
  savePDF: name => ipcRenderer.invoke('pdf:save', name),
  setTheme: t => ipcRenderer.send('theme:set', t),
  aiSetupLocal: () => ipcRenderer.invoke('ai:setupLocal'),
  onAISetup: cb => ipcRenderer.on('ai:setup', (e, p) => cb(p)),
  onAIStatus: cb => ipcRenderer.on('ai-status', (e, s) => cb(s)),
  onStatus: cb => ipcRenderer.on('status', (e, msg) => cb(msg))
});
