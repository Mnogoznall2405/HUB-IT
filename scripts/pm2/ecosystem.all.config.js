const fs = require('fs');
const path = require('path');
const backend = require('./ecosystem.backend.config');
const inventory = require('./ecosystem.inventory.config');
const scan = require('./ecosystem.scan.config');
const voice = require('./ecosystem.voice.config');
const bot = require('./ecosystem.bot.config');
const chatScale = require('./ecosystem.chat.scale.config');

// The chat tier runs either as the single `itinvent-chat` process or as the
// dual PostgreSQL-realtime pair `itinvent-chat-a`/`itinvent-chat-b`. Detection
// mirrors scripts/pm2/chat-runtime-mode.ps1: an explicit env override wins,
// otherwise the repo .env CHAT_REALTIME_TRANSPORT decides.
function chatDualMode() {
  const override = process.env.HUBIT_CHAT_MODE || process.env.CHAT_REALTIME_TRANSPORT;
  if (override) {
    const normalized = String(override).trim().toLowerCase();
    if (normalized === 'dual' || normalized === 'postgres') return true;
    if (normalized === 'single' || normalized === 'local') return false;
  }
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    const text = fs.readFileSync(envPath, 'utf8');
    const line = text.split(/\r?\n/).find((row) => /^\s*CHAT_REALTIME_TRANSPORT\s*=/.test(row));
    if (!line) return false;
    const value = line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '').toLowerCase();
    return value === 'postgres';
  } catch {
    return false;
  }
}

// Dual mode swaps `itinvent-chat` for the scale pair. The shared workers stay
// with the backend config so they are never duplicated from both files.
function chatApps() {
  const backendApps = backend.apps || [];
  if (!chatDualMode()) return backendApps;
  const scaledNodes = (chatScale.apps || []).filter((app) => /^itinvent-chat-[ab]$/.test(app.name));
  return backendApps.filter((app) => app.name !== 'itinvent-chat').concat(scaledNodes);
}

module.exports = {
  apps: [
    ...chatApps(),
    ...(inventory.apps || []),
    ...(scan.apps || []),
    ...(voice.apps || []),
    ...(bot.apps || []),
  ],
};
