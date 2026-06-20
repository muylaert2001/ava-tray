const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC bridge to the renderer (AVA web UI)
contextBridge.exposeInMainWorld('avaElectron', {
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  // Tell main process about state changes
  setState: (state) => ipcRenderer.send('ava-state', state),
  wakeDetected: () => ipcRenderer.send('wake-detected'),
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),

  // Listen for wake word toggle from tray menu
  onWakeWordToggle: (callback) => ipcRenderer.on('wake-word-toggle', (event, active) => callback(active)),

  // Platform info
  platform: process.platform
});
