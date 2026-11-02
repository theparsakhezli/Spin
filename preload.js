const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spinNative', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  scan: folder => ipcRenderer.invoke('scan', folder),
  readRange: (file, start, length) => ipcRenderer.invoke('read-range', file, start, length),
  saveFile: (name, bytes) => ipcRenderer.invoke('save-file', name, bytes),
  setMode: mode => ipcRenderer.invoke('set-mode', mode),
  cursorInside: () => ipcRenderer.invoke('cursor-inside'),
  setCompact: on => ipcRenderer.invoke('set-compact', on),
  config: () => ipcRenderer.invoke('config'),
  openConfig: () => ipcRenderer.invoke('open-config'),
  loadMemory: () => ipcRenderer.invoke('memory-load'),
  saveMemory: text => ipcRenderer.sendSync('memory-save', text),
  onCommand: run => ipcRenderer.on('command', (_e, command) => run(command)),
  onGame: run => ipcRenderer.on('game', (_e, game) => run(game)),
  onConfig: run => ipcRenderer.on('config', (_e, config) => run(config)),
  setBackground: colour => ipcRenderer.send('window-background', colour),
  close: () => ipcRenderer.send('window', 'close'),
  minimize: () => ipcRenderer.send('window', 'minimize'),
});
