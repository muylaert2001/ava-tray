# AVA — Autonomous Virtual Assistant

A desktop tray app powered by Claude AI. AVA lives in your system tray, listens for a wake word, and gives you an always-on AI assistant with voice input, Spotify control, computer automation, and a multi-agent chat interface.

## Features

- **Wake word** — say "Hey AVA" or "Ok AVA" to activate hands-free
- **Voice input** — mic button or PowerShell speech recognition
- **Multi-agent chat** — switch between AVA, Research, Tasks, Code, and System agents
- **Computer control** — open apps, take screenshots, control volume, search the web
- **Spotify integration** — play, pause, skip, and search tracks
- **Gmail integration** — via Railway backend
- **Always-on tray** — runs silently in the background, no dock icon

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/muylaert2001/ava-tray.git
cd ava-tray
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure your API key

```bash
cp .env.example .env
```

Edit `.env` and add your [Anthropic API key](https://console.anthropic.com):

```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

### 4. Run

```bash
npm start
```

AVA will appear in your system tray. Click the icon to open the main window.

## Voice Engine (Python)

For native wake word detection via Python instead of the browser's Web Speech API:

```bash
pip install sounddevice numpy requests pyttsx3
python ava_voice.py
```

## Project Structure

```
ava-tray/
├── src/
│   ├── main.js          # Main Electron process (full version with PS speech)
│   ├── preload.js       # IPC bridge exposed as window.avaElectron
│   ├── computer.js      # Windows computer-control actions
│   └── overlay.html     # Wake word toast notification
├── ava.html             # Main UI (orb, chat, agents, tasks)
├── ava_voice.py         # Python voice engine
├── main.js              # Simplified Electron entry point
├── overlay.html         # Wake word overlay
├── .env.example         # API key template
└── package.json
```

## Tech Stack

- **Electron** — desktop shell
- **Claude API** (claude-sonnet-4-6) — AI with web search tool
- **Web Speech API** — browser-side voice recognition
- **PowerShell** — native Windows speech recognition
- **pyttsx3** — text-to-speech
- **Express** — local API server on port 7878
- **Railway + Redis** — backend for Spotify/Gmail OAuth
