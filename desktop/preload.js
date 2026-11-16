const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  onHotkey: (fn) => ipcRenderer.on('hotkey', (_e, k) => fn(k)),
  setState: (s) => ipcRenderer.send('state', s),
  startHost: () => ipcRenderer.invoke('host:start'),
  stopHost: () => ipcRenderer.invoke('host:stop'),
  onHostStatus: (fn) => ipcRenderer.on('host:status', (_e, s) => fn(s)),
});
