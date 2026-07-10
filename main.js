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

// ── Sedentary-reminder strong alert (置顶强提醒窗口) ─────────────────────────
// Pops a frameless, always-on-top window above ALL apps (incl. fullscreen).
let reminderAlertWin = null;

function showReminderAlert(payload) {
  // Replace any existing alert so a new phase doesn't stack windows.
  if (reminderAlertWin && !reminderAlertWin.isDestroyed()) {
    reminderAlertWin.close();
    reminderAlertWin = null;
  }

  const win = new BrowserWindow({
    width: 560,
    height: 340,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    backgroundColor: '#1b1e2b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Raise above fullscreen apps / other always-on-top windows.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.loadFile(path.join('src', 'reminder-alert.html'), {
    query: {
      title: payload.title || '久坐提醒',
      body:  payload.body  || '',
      phase: payload.phase || 'work',
    },
  });

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    win.flashFrame(true);
  });
  win.on('closed', () => { reminderAlertWin = null; });

  reminderAlertWin = win;
}

ipcMain.handle('reminder:alert', (_event, payload) => {
  showReminderAlert(payload || {});
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

// ── Question bank (题库) file access ─────────────────────────────────────────
// Reads *.json banks produced by the exam-question-authoring skill.
// Dev: <project root>/question-bank ; Packaged: <folder beside the .exe> (user-writable).
function questionBankDir() {
  return app.isPackaged
    ? path.join(path.dirname(app.getPath('exe')), 'question-bank')
    : path.join(app.getAppPath(), 'question-bank');
}

ipcMain.handle('quiz:listBanks', () => {
  const dir = questionBankDir();
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'));
  } catch {
    return { success: true, dir, banks: [] }; // 目录不存在 → 空列表
  }
  const banks = files.map((file) => {
    try {
      const bank = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      return {
        file,
        title: bank.title || bank.bankId || file,
        count: Array.isArray(bank.questions) ? bank.questions.length : 0,
      };
    } catch {
      return { file, title: file + '（解析失败）', count: 0 };
    }
  });
  return { success: true, dir, banks };
});

ipcMain.handle('quiz:loadBank', (_event, file) => {
  // 只接受目录内的裸文件名,防止路径穿越。
  if (typeof file !== 'string' || file !== path.basename(file) || !file.toLowerCase().endsWith('.json')) {
    return { success: false, error: '非法文件名' };
  }
  try {
    const bank = JSON.parse(fs.readFileSync(path.join(questionBankDir(), file), 'utf-8'));
    if (!bank || !Array.isArray(bank.questions)) return { success: false, error: '题库格式无效' };
    return { success: true, bank };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
