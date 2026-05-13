const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, ipcMain } = require('electron');
const path = require('path');
const log = require('electron-log');

// 配置日志
log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024;
log.info('应用程序启动');

// 全局变量
let mainWindow = null;
let overlayWindow = null;
let tray = null;
let isQuitting = false;

// 创建主窗口
function createWindow() {
  log.info('创建主窗口');
  
  mainWindow = new BrowserWindow({
    width: 420,
    height: 580,
    minWidth: 380,
    minHeight: 520,
    resizable: true,
    frame: true,
    show: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile('index.html');

  // 窗口准备好后显示，避免闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    log.info('窗口已显示');
  });

  // 关闭窗口时隐藏到托盘
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      log.info('窗口隐藏到托盘');
    }
  });

  mainWindow.on('hide', () => {
    createOverlay();
  });

  mainWindow.on('show', () => {
    destroyOverlay();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 创建桌面悬浮窗
function createOverlay() {
  if (overlayWindow) return;

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 240,
    height: 50,
    x: screenW - 260,
    y: screenH - 80,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  overlayWindow.loadFile('overlay.html');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  overlayWindow.once('ready-to-show', () => {
    overlayWindow.show();
  });

  overlayWindow.on('closed', () => {
    ipcMain.removeAllListeners('overlay-show-main');
    overlayWindow = null;
  });

  // 双击悬浮窗恢复主窗口
  ipcMain.on('overlay-show-main', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function destroyOverlay() {
  if (overlayWindow) {
    ipcMain.removeAllListeners('overlay-show-main');
    overlayWindow.close();
    overlayWindow = null;
  }
}

// 创建系统托盘
function createTray() {
  log.info('创建系统托盘');
  
  // 尝试加载 SVG 图标作为托盘（Electron 支持）
  const iconPath = path.join(__dirname, 'assets', 'icon.svg');
  let trayIcon;
  
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      trayIcon = createDefaultIcon();
    }
  } catch (e) {
    log.warn('无法加载图标，使用默认图标');
    trayIcon = createDefaultIcon();
  }

  // 托盘图标调整为 16x16
  const resizedIcon = trayIcon.resize({ width: 16, height: 16 });
  tray = new Tray(resizedIcon);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: '开始/暂停',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('tray-toggle');
        }
      }
    },
    {
      label: '重置',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('tray-reset');
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('番茄时钟 - Pomodoro Timer');
  tray.setContextMenu(contextMenu);

  // 点击托盘图标显示窗口
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// 创建默认图标
function createDefaultIcon() {
  // 创建一个 32x32 的空白图标
  const size = 32;
  const canvas = Buffer.alloc(size * size * 4);
  
  // 填充红色背景
  for (let i = 0; i < size * size; i++) {
    canvas[i * 4] = 255;     // R
    canvas[i * 4 + 1] = 0;   // G
    canvas[i * 4 + 2] = 0;   // B
    canvas[i * 4 + 3] = 255; // A
  }
  
  return nativeImage.createFromBuffer(canvas, {
    width: size,
    height: size
  });
}

// 注册全局快捷键
function registerShortcuts() {
  // Ctrl+Shift+P: 显示/隐藏窗口
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
  
  // Ctrl+Shift+S: 开始/暂停
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (mainWindow) {
      mainWindow.webContents.send('tray-toggle');
    }
  });
  
  log.info('全局快捷键已注册');
}

// IPC 事件处理
ipcMain.on('update-tooltip', (event, text) => {
  if (tray) {
    tray.setToolTip(text);
  }
});

ipcMain.on('show-notification', (event, { title, body }) => {
  const { Notification } = require('electron');
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

ipcMain.on('update-overlay', (event, data) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay-update', data);
  }
});

ipcMain.on('update-overlay-settings', (event, data) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay-settings', data);
  }
});

// 应用就绪
app.whenReady().then(() => {
  log.info('应用就绪');
  createWindow();
  createTray();
  registerShortcuts();
});

// 所有窗口关闭
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// macOS 激活
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 退出前清理
app.on('will-quit', () => {
  destroyOverlay();
  globalShortcut.unregisterAll();
  log.info('应用程序退出');
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  log.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason) => {
  log.error('未处理的 Promise 拒绝:', reason);
});
