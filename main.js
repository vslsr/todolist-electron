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
