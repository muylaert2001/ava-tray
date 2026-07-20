const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('avaElectron', {
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  // State
  setState: (state) => ipcRenderer.send('ava-state', state),
  wakeDetected: () => ipcRenderer.send('wake-detected'),
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  platform: process.platform,

  // Wake word
  onWakeWordToggle: (callback) => ipcRenderer.on('wake-word-toggle', (event, active) => callback(active)),
  onWakeFromTray: (callback) => ipcRenderer.on('wake-from-tray', () => callback()),
  onTrayWakeState: (callback) => ipcRenderer.on('tray-wake-state', (event, active) => callback(active)),
  trayWakeToggle: (active) => ipcRenderer.send('tray-wake-toggle', active),

  // PowerShell speech recognition
  startListening: () => ipcRenderer.send('ps-listen-start'),
  stopListening: () => ipcRenderer.send('ps-listen-stop'),
  onListenStart: (cb) => ipcRenderer.on('ps-listen-start', () => cb()),
  onListenReady: (cb) => ipcRenderer.on('ps-listen-ready', () => cb()),
  onListenResult: (cb) => ipcRenderer.on('ps-listen-result', (event, text) => cb(text)),
  onListenEnd: (cb) => ipcRenderer.on('ps-listen-end', () => cb()),

  // Computer control
  onVoiceInput: (cb) => ipcRenderer.on('voice-input', (e, text) => cb(text)),
  onProactiveGreeting: (cb) => ipcRenderer.on('proactive-greeting', (e, text) => cb(text)),
  onVoiceTranscript: (cb) => ipcRenderer.on('voice-transcript', (e, text) => cb(text)),
  sendVoiceResponse: (text) => ipcRenderer.send('voice-response', text),
  computer: async (action, param) => {
    try {
      return await ipcRenderer.invoke('computer-action', action, param);
    } catch(e) {
      return `Error: ${e.message}`;
    }
  }
});
