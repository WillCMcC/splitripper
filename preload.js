const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectAudioFiles: () => ipcRenderer.invoke('select-audio-files'),
  selectAudioDirectory: () => ipcRenderer.invoke('select-audio-directory'),

  // Taskbar progress
  updateTaskbarProgress: (data) => ipcRenderer.send('update-taskbar-progress', data),

  // Server status
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),

  // Environment info
  platform: process.platform,
  isElectron: true,

  // File searching
  findFile: (name, size) => ipcRenderer.invoke('find-file', name, size),

  // Native file drag-and-drop (for dragging stems to DAW)
  startDrag: (filePath) => ipcRenderer.send('start-drag', filePath)
});