const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectAudioFiles: () => ipcRenderer.invoke('select-audio-files'),
  selectAudioDirectory: () => ipcRenderer.invoke('select-audio-directory'),
  
  // Add other APIs as needed
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // For future features
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  
  // Taskbar progress
  updateTaskbarProgress: (data) => ipcRenderer.send('update-taskbar-progress', data),
  
  // Environment info
  platform: process.platform,
  isElectron: true,
  
  // File searching
  findFile: (name, size) => ipcRenderer.invoke('find-file', name, size)
});