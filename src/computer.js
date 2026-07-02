const { exec, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fsp = require('fs/promises');

// ── Escape a value for interpolation into a PowerShell double-quoted string ──
function psQuote(str) {
  return String(str).replace(/"/g, '`"');
}

// ── Execute a PowerShell command (captures output, process must exit) ──
function ps(command) {
  return new Promise((resolve, reject) => {
    exec(`powershell -Command "${command}"`, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

// ── Execute a shell command that produces output and exits promptly ──
function shell(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

// ── Fire-and-forget launcher for GUI apps/URLs.
// Uses detached + stdio:ignore so Node never holds the child's pipes open,
// which would cause exec() to hang until the GUI window is closed.
function launch(command) {
  return new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/c', command], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    child.once('error', reject);
    child.once('spawn', resolve);
  });
}

const computer = {

  // ── Apps ──
  async openApp(appName) {
    const apps = {
      'spotify': 'start spotify:',
      'chrome': 'start chrome',
      'edge': 'start msedge',
      'firefox': 'start firefox',
      'notepad': 'start notepad',
      'calculator': 'start calc',
      'word': 'start winword',
      'excel': 'start excel',
      'powerpoint': 'start powerpnt',
      'outlook': 'start outlook',
      'file explorer': 'start explorer',
      'explorer': 'start explorer',
      'settings': 'start ms-settings:',
      'task manager': 'start taskmgr',
      'control panel': 'start control',
      'paint': 'start mspaint',
      'snipping tool': 'start snippingtool',
      'discord': 'start discord:',
      'teams': 'start msteams:',
      'zoom': 'start zoommtg:',
      'vs code': 'start code',
      'vscode': 'start code',
'brave': 'start brave',
'brave browser': 'start brave',
    };
    const lower = appName.toLowerCase();
    const cmd = apps[lower] || `start ${lower}`;
    await launch(cmd);
    return `Opening ${appName}`;
  },

  async closeApp(appName) {
    const q = psQuote(appName);
    // Ask windows to close nicely first, then force-kill anything left after a grace period.
    await ps(`$p = Get-Process -Name "${q}" -ErrorAction SilentlyContinue; if ($p) { $p | ForEach-Object { $_.CloseMainWindow() | Out-Null }; Start-Sleep -Milliseconds 1500; Get-Process -Name "${q}" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }`);
    return `Closing ${appName}`;
  },

  async killProcess(processName) {
    const q = psQuote(processName);
    await ps(`Stop-Process -Name "${q}" -Force -ErrorAction SilentlyContinue`);
    return `Killed process ${processName}`;
  },

  async listProcesses() {
    const result = await ps(`Get-Process | Sort-Object -Property CPU -Descending | Select-Object -First 25 Name, Id, CPU | ConvertTo-Json`);
    return result || 'No processes found';
  },

  // ── Files & Folders ──
  async openFile(filePath) {
    await launch(`start "" "${filePath}"`);
    return `Opening ${filePath}`;
  },

  async readFile(filePath) {
    const content = await fsp.readFile(filePath, 'utf8');
    return content.length > 4000 ? content.slice(0, 4000) + '\n... (truncated)' : content;
  },

  async writeFile(payload) {
    const { filePath, content } = typeof payload === 'string' ? JSON.parse(payload) : payload;
    await fsp.writeFile(filePath, content, 'utf8');
    return `Wrote to ${filePath}`;
  },

  async listFiles(folderPath) {
    const entries = await fsp.readdir(folderPath, { withFileTypes: true });
    if (!entries.length) return 'Folder is empty';
    return entries.map(e => (e.isDirectory() ? '[DIR] ' : '') + e.name).join('\n');
  },

  async deleteFile(filePath) {
    await fsp.unlink(filePath);
    return `Deleted ${filePath}`;
  },

  async openFolder(folderPath) {
    await launch(`start explorer "${folderPath}"`);
    return `Opening folder ${folderPath}`;
  },

  async searchFiles(query) {
    const result = await ps(`Get-ChildItem -Path $env:USERPROFILE -Recurse -Filter "*${query}*" -ErrorAction SilentlyContinue | Select-Object -First 10 FullName | ConvertTo-Json`);
    return result || 'No files found';
  },

  async openDownloads() {
    await launch(`start explorer "${os.homedir()}\\Downloads"`);
    return 'Opening Downloads folder';
  },

  async openDocuments() {
    await launch(`start explorer "${os.homedir()}\\Documents"`);
    return 'Opening Documents folder';
  },

  async openDesktop() {
    await launch(`start explorer "${os.homedir()}\\Desktop"`);
    return 'Opening Desktop';
  },

  async emptyRecycleBin() {
    await ps(`Clear-RecycleBin -Force -ErrorAction SilentlyContinue`);
    return 'Recycle bin emptied';
  },

  // ── Volume ──
  async setVolume(level) {
    await ps(`$wshShell = New-Object -ComObject WScript.Shell; $vol = ${Math.round(level / 2)}; for($i=0;$i -lt 50;$i++){$wshShell.SendKeys([char]174)}; for($i=0;$i -lt $vol;$i++){$wshShell.SendKeys([char]175)}`);
    return `Volume set to ${level}%`;
  },

  async volumeUp() {
    await ps(`$wshShell = New-Object -ComObject WScript.Shell; for($i=0;$i -lt 5;$i++){$wshShell.SendKeys([char]175)}`);
    return 'Volume increased';
  },

  async volumeDown() {
    await ps(`$wshShell = New-Object -ComObject WScript.Shell; for($i=0;$i -lt 5;$i++){$wshShell.SendKeys([char]174)}`);
    return 'Volume decreased';
  },

  async mute() {
    await ps(`$wshShell = New-Object -ComObject WScript.Shell; $wshShell.SendKeys([char]173)`);
    return 'Audio muted/unmuted';
  },

  // ── System ──
async screenshot() {
  // Use the Windows shell folder API so OneDrive-redirected Desktops work correctly.
  // Join-Path + single-quoted filename avoids double-quote conflicts with ps() wrapper.
  const result = await ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $desktop = [Environment]::GetFolderPath('Desktop'); $file = Join-Path $desktop 'AVA_screenshot_${Date.now()}.png'; $b = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0,0,0,0,$b.Size); $b.Save($file); $g.Dispose(); $b.Dispose(); Write-Output $file`);
  return `Screenshot saved to your Desktop! (${result})`;
},

  async takeScreenshot() { return this.screenshot(); },

  async lockScreen() {
    await ps(`rundll32.exe user32.dll,LockWorkStation`);
    return 'Screen locked';
  },

  async sleep() {
    await ps(`Add-Type -Assembly System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)`);
    return 'Going to sleep';
  },

  async shutdown() {
    await shell('shutdown /s /t 30');
    return 'Shutting down in 30 seconds. Say cancel shutdown to abort.';
  },

  async cancelShutdown() {
    await shell('shutdown /a');
    return 'Shutdown cancelled';
  },

  async restart() {
    await shell('shutdown /r /t 30');
    return 'Restarting in 30 seconds';
  },

  // ── System Info ──
async getSystemInfo() {
  try {
    const cpu = await shell('wmic cpu get loadpercentage /value');
    const mem = await shell('wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /value');
    const disk = await shell('wmic logicaldisk where "DeviceID=\'C:\'" get FreeSpace,Size /value');
    
    const cpuVal = cpu.match(/LoadPercentage=(\d+)/)?.[1] || 'N/A';
    const freeRam = mem.match(/FreePhysicalMemory=(\d+)/)?.[1];
    const totalRam = mem.match(/TotalVisibleMemorySize=(\d+)/)?.[1];
    const ramPct = freeRam && totalRam ? Math.round((1 - freeRam/totalRam)*100) : 'N/A';
    const freeSpace = disk.match(/FreeSpace=(\d+)/)?.[1];
    const totalSpace = disk.match(/Size=(\d+)/)?.[1];
    const diskFree = freeSpace ? Math.round(freeSpace/1073741824*10)/10 : 'N/A';
    const diskTotal = totalSpace ? Math.round(totalSpace/1073741824*10)/10 : 'N/A';
    
    return `CPU: ${cpuVal}% | RAM: ${ramPct}% used | Disk C: ${diskFree}GB free of ${diskTotal}GB`;
  } catch(e) { 
    return `Error getting system info: ${e.message}`; 
  }
},
  async getBatteryStatus() {
    const result = await ps(`Get-WmiObject Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json`);
    return result || 'No battery detected (desktop PC)';
  },

  async getIPAddress() {
    const result = await ps(`(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -notlike '*Loopback*'} | Select-Object -First 1).IPAddress`);
    return `Your IP address is ${result}`;
  },

  // ── Clipboard ──
  async getClipboard() {
    const result = await ps(`Get-Clipboard`);
    return result || 'Clipboard is empty';
  },

  async setClipboard(text) {
    await ps(`Set-Clipboard -Value "${text.replace(/"/g, '\\"')}"`);
    return 'Text copied to clipboard';
  },

  // ── Browser ──
  async openUrl(url) {
    if (!url.startsWith('http')) url = 'https://' + url;
    await launch(`start ${url}`);
    return `Opening ${url}`;
  },

  async googleSearch(query) {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    await launch(`start ${url}`);
    return `Searching Google for "${query}"`;
  },

  async openYoutube(query) {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    await launch(`start ${url}`);
    return `Opening YouTube search for "${query}"`;
  },

  // ── Windows Settings ──
  async openWifi() {
    await launch('start ms-settings:network-wifi');
    return 'Opening WiFi settings';
  },

  async openBluetooth() {
    await launch('start ms-settings:bluetooth');
    return 'Opening Bluetooth settings';
  },

  async openDisplay() {
    await launch('start ms-settings:display');
    return 'Opening Display settings';
  },

  async openSound() {
    await launch('start ms-settings:sound');
    return 'Opening Sound settings';
  },

  async checkUpdates() {
    await launch('start ms-settings:windowsupdate');
    return 'Opening Windows Update';
  },

  // ── Typing ──
  async typeText(text) {
    await ps(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''")}')`);
    return `Typed: ${text}`;
  },
};

module.exports = computer;