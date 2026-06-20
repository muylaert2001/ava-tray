const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, shell } = require('electron');
const path = require('path');

let tray = null;
let mainWindow = null;
let overlayWindow = null;
let wakeWordActive = false;
let avaState = 'idle'; // idle | listening | thinking | speaking

// ── Create the main AVA window ──
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 680,
    show: false,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the AVA interface (claude.ai artifact or local file)
  mainWindow.loadFile(path.join(__dirname, 'ava.html'));

  mainWindow.on('blur', () => {
    // Optionally hide when clicking away
    // mainWindow.hide();
  });
}

// ── Create the wake word overlay (small toast) ──
function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 280,
    height: 80,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));

  // Position bottom-right of screen
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  overlayWindow.setPosition(width - 300, height - 100);
}

// ── Tray icon and menu ──
function createTray() {
  // Create a simple colored square icon (replace with real icon file)
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAFeSURBVFiF7ZexSgNBEIa/XS+JkJCAgpWFjYWFD+ALWPgCFj6ChZWVtYWFYGFhYSEIgk8ggoiIiIiIiIiIiIiIiIiI+A8HuRxJLrnsXS4XyA8Ly+7O/N/szO4uZCSTJEnSRER+C5IkSWqapmmapiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJ0r8nyzIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4AV4wBmMd0XTpAAAAAElFTkSuQmCC'
  );

  tray = new Tray(icon);

  const updateMenu = () => {
    const menu = Menu.buildFromTemplate([
      { label: 'AVA', enabled: false },
      { type: 'separator' },
      {
        label: wakeWordActive ? '🟣 Wake Word: ON' : '⚫ Wake Word: OFF',
        click: toggleWakeWord
      },
      { label: 'Open AVA', click: toggleWindow },
      { type: 'separator' },
      { label: 'Open in Browser', click: () => shell.openExternal('https://claude.ai') },
      { type: 'separator' },
      { label: 'Quit AVA', click: () => app.quit() }
    ]);
    tray.setContextMenu(menu);
  };

  tray.setToolTip('AVA — Autonomous Virtual Assistant');
  tray.on('click', toggleWindow);
  updateMenu();

  // Keep menu updated
  global.updateTrayMenu = updateMenu;
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ── Wake word detection via renderer process ──
function toggleWakeWord() {
  wakeWordActive = !wakeWordActive;
  if (mainWindow) {
    mainWindow.webContents.send('wake-word-toggle', wakeWordActive);
  }
  if (global.updateTrayMenu) global.updateTrayMenu();

  new Notification({
    title: 'AVA',
    body: wakeWordActive ? 'Wake word active — say "Hey AVA"' : 'Wake word disabled',
    silent: true
  }).show();
}

// ── IPC: renderer tells main process about state changes ──
ipcMain.on('ava-state', (event, state) => {
  avaState = state;
  // Update tray icon to reflect state (could swap icons here)
  tray?.setToolTip(`AVA — ${state.toUpperCase()}`);
});

ipcMain.on('wake-detected', () => {
  // Show overlay toast
  if (overlayWindow) {
    overlayWindow.show();
    setTimeout(() => overlayWindow.hide(), 2000);
  }
  // Bring main window to front
  if (mainWindow && !mainWindow.isVisible()) {
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.on('show-notification', (event, { title, body }) => {
  new Notification({ title, body }).show();
});

// ── App lifecycle ──
app.whenReady().then(() => {
  createMainWindow();
  createOverlayWindow();
  createTray();

  // Start hidden — lives in tray
  app.setActivationPolicy?.('accessory'); // macOS: no dock icon
});

app.on('window-all-closed', (e) => {
  // Prevent quit when window closes — keep tray running
  e.preventDefault();
});

app.on('before-quit', () => {
  mainWindow?.destroy();
  overlayWindow?.destroy();
});
