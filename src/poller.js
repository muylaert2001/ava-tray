require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios = require('axios');
const os = require('os');
const computer = require('./computer');

const BACKEND = process.env.BACKEND_URL || 'https://ava-assistant.com';
// Backend holds the connection open up to this many ms before returning empty.
// Keeps traffic low vs. tight short-polling.
const SERVER_HOLD_MS = 20000;

const ALLOWED_ACTIONS = new Set(Object.keys(computer));

class TrayPoller {
  constructor() {
    this.token    = process.env.TRAY_TOKEN;
    this.deviceId = process.env.DEVICE_ID || os.hostname();
    this.running  = false;

    this.http = axios.create({
      baseURL: BACKEND,
      headers: {
        Authorization:  `Bearer ${this.token}`,
        'X-Device-Id':  this.deviceId,
        'Content-Type': 'application/json',
      },
      // Slightly longer than the server hold so axios doesn't time out first
      timeout: SERVER_HOLD_MS + 8000,
    });
  }

  async register() {
    try {
      await this.http.post('/api/tray/register', {
        deviceId: this.deviceId,
        platform: process.platform,
        hostname: os.hostname(),
      });
      console.log(`[poller] Registered device "${this.deviceId}" with ${BACKEND}`);
    } catch (e) {
      console.warn('[poller] Registration failed (will retry next start):', e.message);
    }
  }

  // Long-poll: backend blocks until a command is ready or SERVER_HOLD_MS elapses
  async pollOnce() {
    const res = await this.http.get('/api/tray/poll', {
      params: { timeout: SERVER_HOLD_MS },
    });
    return res.data; // { commandId, action, param } | { commandId: null }
  }

  async sendResult(commandId, result, error = null) {
    try {
      await this.http.post('/api/tray/result', { commandId, result, error });
    } catch (e) {
      console.warn('[poller] Failed to send result:', e.message);
    }
  }

  async execute({ commandId, action, param }) {
    if (!ALLOWED_ACTIONS.has(action)) {
      console.warn(`[poller] Rejected unknown action: ${action}`);
      await this.sendResult(commandId, null, `Unknown action: ${action}`);
      return;
    }
    console.log(`[poller] Executing: ${action}(${param ?? ''})`);
    try {
      const result = param !== undefined
        ? await computer[action](param)
        : await computer[action]();
      await this.sendResult(commandId, result);
    } catch (e) {
      await this.sendResult(commandId, null, e.message);
    }
  }

  start() {
    if (!this.token) {
      console.error('[poller] TRAY_TOKEN missing in .env — remote commands disabled');
      return;
    }
    this.running = true;
    console.log(`[poller] Starting — backend: ${BACKEND}`);
    this.register().then(() => this.loop());
  }

  stop() {
    this.running = false;
  }

  async loop() {
    while (this.running) {
      try {
        const cmd = await this.pollOnce();
        if (cmd?.commandId) {
          // Don't await — execute in background so the next poll starts immediately,
          // closing the window where a queued command would wait out the browser timeout.
          this.execute(cmd);
        }
        // If commandId is null the server hold elapsed with no command — loop immediately
      } catch (e) {
        if (!this.running) break;
        console.warn('[poller] Poll error, retrying in 5s:', e.message);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
    console.log('[poller] Stopped');
  }
}

module.exports = new TrayPoller();
