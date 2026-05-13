const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  onUpdate: (callback) => {
    ipcRenderer.on('overlay-update', (_event, data) => callback(data));
  },
  onSettings: (callback) => {
    ipcRenderer.on('overlay-settings', (_event, data) => callback(data));
  },
  showMain: () => {
    ipcRenderer.send('overlay-show-main');
  },
  removeListeners: () => {
    ipcRenderer.removeAllListeners('overlay-update');
    ipcRenderer.removeAllListeners('overlay-settings');
  }
});
