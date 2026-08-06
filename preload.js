const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
  },
  exportJson: (data) => ipcRenderer.invoke('dialog:exportJson', data),
  exportMd: (data, defaultName) => ipcRenderer.invoke('dialog:exportMd', data, defaultName),
  exportWikiJson: (data) => ipcRenderer.invoke('dialog:exportWikiJson', data),
  importJson: () => ipcRenderer.invoke('dialog:importJson'),
  openTool: (tool) => ipcRenderer.invoke('tool:open', tool),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  listUdk: (dir) => ipcRenderer.invoke('fs:listUdk', dir),
  showReminderAlert: (payload) => ipcRenderer.invoke('reminder:alert', payload),
  quiz: {
    listBanks: () => ipcRenderer.invoke('quiz:listBanks'),
    loadBank: (file) => ipcRenderer.invoke('quiz:loadBank', file),
    importBank: () => ipcRenderer.invoke('quiz:importBank'),
  },
  wiki: {
    saveImageData: (base64Data, mimeType) => ipcRenderer.invoke('wiki:saveImageData', base64Data, mimeType),
    deleteImages:  (filenames)            => ipcRenderer.invoke('wiki:deleteImages', filenames),
  },
});
