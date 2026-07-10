const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
  },
  exportJson: (data) => ipcRenderer.invoke('dialog:exportJson', data),
  importJson: () => ipcRenderer.invoke('dialog:importJson'),
  openTool: (tool) => ipcRenderer.invoke('tool:open', tool),
  showReminderAlert: (payload) => ipcRenderer.invoke('reminder:alert', payload),
  quiz: {
    listBanks: () => ipcRenderer.invoke('quiz:listBanks'),
    loadBank: (file) => ipcRenderer.invoke('quiz:loadBank', file),
  },
});
