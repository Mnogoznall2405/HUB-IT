const fs = require('fs');
const path = require('path');
const { resolvePython } = require('./python-path');

const PROJECT_ROOT = 'C:\\Project\\Image_scan';
const PYTHON = resolvePython(PROJECT_ROOT);

function readDotEnvValue(key) {
  try {
    const text = fs.readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf8');
    const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
    if (!match) return '';
    return String(match[1] || '').trim().replace(/^['"]|['"]$/g, '');
  } catch (_err) {
    return '';
  }
}

const VOICE_DATABASE_URL =
  String(process.env.VOICE_DATABASE_URL || '').trim() ||
  readDotEnvValue('VOICE_DATABASE_URL') ||
  readDotEnvValue('APP_DATABASE_URL');

module.exports = {
  apps: [
    {
      name: 'itinvent-voice',
      cwd: PROJECT_ROOT,
      script: PYTHON,
      args: '-m voice_server',
      interpreter: 'none',
      windowsHide: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 15000,
      max_memory_restart: '1G',
      env: {
        PYTHONUNBUFFERED: '1',
        VOICE_DATABASE_URL: VOICE_DATABASE_URL,
        VOICE_SERVER_PORT: '8013',
      },
    },
    {
      name: 'itinvent-voice-worker',
      cwd: PROJECT_ROOT,
      script: PYTHON,
      args: '-m voice_server.worker_main',
      interpreter: 'none',
      windowsHide: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 30000,
      // Pipeline runs are GPU-heavy child processes; give headroom.
      max_memory_restart: '4G',
      env: {
        PYTHONUNBUFFERED: '1',
        VOICE_DATABASE_URL: VOICE_DATABASE_URL,
        VOICE_WORKER_CONCURRENCY: '1',
      },
    },
    {
      name: 'itinvent-voice-archiver',
      cwd: PROJECT_ROOT,
      script: PYTHON,
      args: '-m voice_server.archiver',
      interpreter: 'none',
      windowsHide: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 10000,
      max_memory_restart: '512M',
      env: {
        PYTHONUNBUFFERED: '1',
        VOICE_DATABASE_URL: VOICE_DATABASE_URL,
        // Warm storage on the file server; dry-run until verified live.
        VOICEVIDEO_ARCHIVE_DIR: '\\\\10.103.0.229\\hubit\\voice',
        VOICEVIDEO_SOURCE_TTL_DAYS: '7',
        VOICE_ARCHIVE_ENABLED: '1',
        VOICE_ARCHIVE_DRY_RUN: '1',
      },
    },
  ],
};
