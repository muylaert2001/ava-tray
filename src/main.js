require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const log = require('electron-log/main');
log.initialize();
// Patch console so every console.log/warn/error across all main-process modules
// (including poller.js) writes to %APPDATA%\AVA\logs\main.log
Object.assign(console, log.functions);
const fs = require("fs");
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, shell, session } = require('electron');
const computer = require('./computer');
const poller = require('./poller');
const path = require('path');
const { exec, spawn } = require('child_process');

let tray = null;
let mainWindow = null;
let overlayWindow = null;
let trayWakeOn = false;
let trayWakeProc = null;
let listenProc = null;
let isListening = false;
let visionProc = null;

// ── ava-vision.py process ──
function startVisionProcess() {
  const scriptPath = 'C:/NOVA/ava-vision.py';
  if (!fs.existsSync(scriptPath)) {
    console.warn('ava-vision.py not found at', scriptPath, '- skipping vision process');
    return;
  }
  const proc = spawn('python', [scriptPath], { detached: false });
  visionProc = proc;

  proc.stdout?.on('data', (data) => console.log('[vision]', data.toString().trim()));
  proc.stderr?.on('data', (data) => console.error('[vision]', data.toString().trim()));

  proc.on('error', (err) => {
    console.error('Failed to start ava-vision.py (is python installed and on PATH?):', err.message);
    visionProc = null;
  });

  proc.on('exit', (code) => {
    console.log('ava-vision.py exited with code', code);
    if (visionProc === proc) visionProc = null;
  });
}

function stopVisionProcess() {
  if (visionProc) {
    try { visionProc.kill(); } catch (e) {}
    visionProc = null;
  }
}

// ── PowerShell speech recognition script ──
const PS_LISTEN = `
Add-Type -AssemblyName System.Speech
$r = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$r.SetInputToDefaultAudioDevice()
$r.BabbleTimeout = [System.TimeSpan]::FromSeconds(10)
$r.EndSilenceTimeout = [System.TimeSpan]::FromSeconds(2.5)
$r.EndSilenceTimeoutAmbiguous = [System.TimeSpan]::FromSeconds(2.5)
$gb = New-Object System.Speech.Recognition.GrammarBuilder
$gb.AppendDictation()
$g = New-Object System.Speech.Recognition.Grammar($gb)
$r.LoadGrammar($g)
Write-Output "READY"
$result = $r.Recognize([System.TimeSpan]::FromSeconds(30))
if($result){ Write-Output ("RESULT:" + $result.Text) }
else { Write-Output "TIMEOUT" }
`;

const PS_WAKE = `
Add-Type -AssemblyName System.Speech
$r = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$r.SetInputToDefaultAudioDevice()
$choices = New-Object System.Speech.Recognition.Choices
$choices.Add('hey ava')
$choices.Add('ok ava')
$choices.Add('okay ava')
$choices.Add('ava')
$gb = New-Object System.Speech.Recognition.GrammarBuilder($choices)
$g = New-Object System.Speech.Recognition.Grammar($gb)
$r.LoadGrammar($g)
$result = $r.Recognize([System.TimeSpan]::FromSeconds(30))
if($result){ Write-Output ("WAKE:" + $result.Text) }
`;

// ── Main AVA window ──
function createMainWindow(startHidden = false) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    frame: false,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.loadFile(path.join(__dirname, '../ava.html'));
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') mainWindow.webContents.toggleDevTools();
  });
  mainWindow.once('ready-to-show', () => {
    if (!startHidden) {
      mainWindow.center();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

// ── Wake word overlay ──
function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 280, height: 80,
    show: false, frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true, resizable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  overlayWindow.loadFile(path.join(__dirname, '../overlay.html'));
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  overlayWindow.setPosition(width - 300, height - 100);
}

// ── Tray ──
function createTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAeklEQVRYhe2SMQqAMAxFX6WH8BS5RS8QfyG0kKFDFy8goigOgiAiHkIX8Q5deutiD9BSKHTeQMhLQl4+NNaZMR5DwAkf4fGrYQVkyqBzBWQCoHMFZAqgcwVkAqBzBWQKoHMFZAqgcwVkCqBzBWQKoHMFZAqgcwVkAvABuaEFozS0qRIAAAAASUVORK5CYII='
  );
  tray = new Tray(icon);

  const updateMenu = () => {
    const menu = Menu.buildFromTemplate([
      { label: 'A V A', enabled: false },
      { type: 'separator' },
      { label: trayWakeOn ? '🟣 Wake Word: ON' : '⚫ Wake Word: OFF', click: toggleTrayWake },
      { label: 'Open AVA', click: showWindow },
      { label: 'DevTools', click: () => mainWindow?.webContents.toggleDevTools() },
      { type: 'separator' },
      { label: 'Quit AVA', click: () => app.quit() }
    ]);
    tray.setContextMenu(menu);
  };

  tray.setToolTip('AVA — Autonomous Virtual Assistant');
  tray.on('click', showWindow);
  updateMenu();
  global.updateTrayMenu = updateMenu;
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

// ── PowerShell wake word ──
function startTrayWake() {
  function wakeLoop() {
    if (!trayWakeOn) return;
    console.log("Starting wake listener..."); const wakeFile = require('os').tmpdir() + '/ava_wake.ps1';
      console.log("Wake file:", wakeFile); fs.writeFileSync(wakeFile, PS_WAKE); console.log("Wake file written");
      const ps = exec('powershell -NoProfile -NonInteractive -File "' + wakeFile + '"');
    trayWakeProc = ps;
    ps.stdout.on('data', (data) => {
      const t = data.toString().trim();
      if (t.startsWith('WAKE:')) {
        global.wakeDetected = true; onTrayWakeDetected();
      }
    });
    ps.on('exit', () => {
      trayWakeProc = null;
      if (trayWakeOn) setTimeout(wakeLoop, 300);
    });
    ps.on('error', () => {
      trayWakeProc = null;
      if (trayWakeOn) setTimeout(wakeLoop, 2000);
    });
  }
  wakeLoop();
}

function stopTrayWake() {
  trayWakeOn = false;
  if (trayWakeProc) { try { trayWakeProc.kill(); } catch(e) {} trayWakeProc = null; }
}

function onTrayWakeDetected() {
  // Show overlay toast only
  if (overlayWindow) {
    overlayWindow.show();
    setTimeout(() => overlayWindow.hide(), 2000);
  }
  // Edge will pick up wake via polling
}

function toggleTrayWake() {
  trayWakeOn = !trayWakeOn;
  if (trayWakeOn) startTrayWake();
  else stopTrayWake();
  if (mainWindow) mainWindow.webContents.send('tray-wake-state', trayWakeOn);
  if (global.updateTrayMenu) global.updateTrayMenu();
  new Notification({
    title: 'AVA',
    body: trayWakeOn ? 'Wake word active — say "Hey AVA"' : 'Wake word disabled',
    silent: true
  }).show();
}

// ── PowerShell active listening ──
function startPSListen() { console.log("startPSListen called, isListening:", isListening);
  if (isListening) return;
  isListening = true;
  startPSListen();

  console.log("Creating listen file..."); const listenFile = require('os').tmpdir() + '/ava_listen.ps1';
      fs.writeFileSync(listenFile, PS_LISTEN); console.log("Listen file written:", listenFile);
      console.log('Starting PS listen process...'); const ps = exec('powershell -NoProfile -NonInteractive -File "' + listenFile + '"');
  listenProc = ps;

  ps.stdout.on('data', (data) => {
    const t = data.toString().trim();
    console.log('PS output:', t);
    if (t === 'READY') {
      if (mainWindow) mainWindow.webContents.send('ps-listen-ready');
    } else if (t.startsWith('RESULT:')) {
      const text = t.replace('RESULT:', '').trim();
      undefined
    } else if (t === 'TIMEOUT') {
      if (mainWindow) mainWindow.webContents.send('ps-listen-end');
    }
  });

  ps.on('exit', () => {
    isListening = false;
    listenProc = null;
    if (mainWindow) mainWindow.webContents.send('ps-listen-end');
    // Resume wake word after listening ends
    if (trayWakeOn) setTimeout(startTrayWake, 500);
  });

  ps.on('error', (e) => {
    isListening = false;
    listenProc = null;
    if (mainWindow) mainWindow.webContents.send('ps-listen-end');
  });
}

function stopPSListen() {
  if (listenProc) { try { listenProc.kill(); } catch(e) {} listenProc = null; }
  isListening = false;
}

// ── IPC handlers ──
ipcMain.on('ava-state', (event, state) => {
  tray?.setToolTip(`AVA — ${state.toUpperCase()}`);
});

ipcMain.on('wake-detected', () => {
  if (overlayWindow) { overlayWindow.show(); setTimeout(() => overlayWindow.hide(), 2000); }
});

ipcMain.on('show-notification', (event, { title, body }) => {
  new Notification({ title, body }).show();
});

ipcMain.on('tray-wake-toggle', (event, active) => {
  trayWakeOn = active;
  if (active) startTrayWake();
  else stopTrayWake();
  if (global.updateTrayMenu) global.updateTrayMenu();
});

ipcMain.on('ps-listen-start', () => startPSListen());
ipcMain.on('voice-response', (event, text) => {
  global.pendingVoiceResponse = text;
});
ipcMain.on('ps-listen-stop', () => stopPSListen());

ipcMain.handle('computer-action', async (event, action, param) => {
  try {
    return param !== undefined ? await computer[action](param) : await computer[action]();
  } catch(e) { return `Error: ${e.message}`; }
});

// ── App lifecycle ──
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  const startHidden = app.getLoginItemSettings().wasOpenedAtLogin;

  createMainWindow(startHidden);
  createOverlayWindow();
  createTray();
// Auto-enable wake word on startup
  setTimeout(() => {
    trayWakeOn = true;
    startTrayWake();
    if (global.updateTrayMenu) global.updateTrayMenu();
    console.log('Wake word auto-enabled');
  }, 3000);

  // Start polling the backend for remote commands
  poller.start();

  startVisionProcess();

  app.setActivationPolicy?.('accessory');
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => {
  poller.stop();
  stopTrayWake();
  stopPSListen();
  stopVisionProcess();
  mainWindow?.destroy();
  overlayWindow?.destroy();
});
