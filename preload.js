// Safe bridge between the Stash pages and the Mac app.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('stashNative', {
  // main window
  load: () => ipcRenderer.invoke('store:load'),
  save: json => ipcRenderer.send('store:save', json),
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
  onStatus: cb => ipcRenderer.on('status', (e, msg) => cb(msg))
});
