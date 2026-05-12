const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 更新托盘提示
  updateTooltip: (text) => ipcRenderer.send('update-tooltip', text),
  
  // 显示系统通知
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  
  // 监听托盘控制事件
  onTrayToggle: (callback) => ipcRenderer.on('tray-toggle', callback),
  onTrayReset: (callback) => ipcRenderer.on('tray-reset', callback),
  
  // 移除监听器
  removeTrayListeners: () => {
    ipcRenderer.removeAllListeners('tray-toggle');
    ipcRenderer.removeAllListeners('tray-reset');
  }
});
