const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const store = new Store();

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 600,
    minHeight: 480,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,   // allow WebSocket connections to LAN addresses
    },
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    titleBarStyle: 'default',
    show: false,
    backgroundColor: '#f5f5f5',
  });

  mainWindow.loadFile('src/index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.todolist.app'); // required for Windows 10 system notifications
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Tool windows (切换板小工具) ─────────────────────────────────────────────
// Each tool opens in its own BrowserWindow loading src/tools/<id>.html.
const toolWindows = new Map();

function openToolWindow(tool) {
  const { id, title, width, height } = tool;

  // Focus existing window instead of opening a duplicate.
  const existing = toolWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return;
  }

  const win = new BrowserWindow({
    width: width || 480,
    height: height || 420,
    minWidth: 320,
    minHeight: 260,
    parent: mainWindow,
    title: title || '工具',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    show: false,
    backgroundColor: '#f5f5f5',
    autoHideMenuBar: true,
  });

  win.loadFile(path.join('src', 'tools', `${id}.html`));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => toolWindows.delete(id));

  toolWindows.set(id, win);
}

ipcMain.handle('tool:open', (_event, tool) => {
  if (!tool || !tool.id) return { success: false };
  openToolWindow(tool);
  return { success: true };
});

// IPC handlers for data persistence
ipcMain.handle('store:get', (_event, key) => {
  return store.get(key);
});

ipcMain.handle('store:set', (_event, key, value) => {
  store.set(key, value);
});

ipcMain.handle('dialog:exportJson', async (_event, data) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '导出 TODO 数据',
    defaultPath: `todos-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON 文件', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { success: false };
  fs.writeFileSync(filePath, data, 'utf-8');
  return { success: true };
});

ipcMain.handle('dialog:importJson', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '导入 TODO 数据',
    filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return { success: false };
  const data = fs.readFileSync(filePaths[0], 'utf-8');
  return { success: true, data };
});
