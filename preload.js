const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('autofile', {
  pathsFromDrop: (files) => Array.from(files, (f) => webUtils.getPathForFile(f)).filter(Boolean),
  addPaths: (paths) => ipcRenderer.invoke('addPaths', paths),
  addSample: () => ipcRenderer.invoke('addSample'),
  onProposals: (cb) => ipcRenderer.on('proposals', (_e, list) => cb(list)),
  onError: (cb) => ipcRenderer.on('error', (_e, msg) => cb(msg)),
  approve: (id, edits) => ipcRenderer.invoke('approve', id, edits),
  answer: (id, destDir) => ipcRenderer.invoke('answer', id, destDir),
  skip: (id) => ipcRenderer.invoke('skip', id),
  undo: (id) => ipcRenderer.invoke('undo', id),
  pickFolder: (defaultPath) => ipcRenderer.invoke('pickFolder', defaultPath),
  destinations: () => ipcRenderer.invoke('destinations'),
  info: () => ipcRenderer.invoke('info'),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  clearDone: () => ipcRenderer.invoke('clearDone'),
});
