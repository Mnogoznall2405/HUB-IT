const fs = require('fs');
const path = require('path');

// Звонки чата: self-hosted SFU LiveKit (documentation/technical/CHAT_CALLS_LIVEKIT.md).
// Пути относительны корню репозитория; tools/ в .gitignore, бинарник кладётся на сервер отдельно.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const LIVEKIT_BIN = path.join(PROJECT_ROOT, 'tools', 'livekit', 'livekit-server.exe');
const LIVEKIT_CONFIG = 'scripts/livekit/livekit.yaml';

// Процесс описывается только если на хосте есть и бинарник, и боевой конфиг (livekit.yaml gitignored,
// создаётся из livekit.example.yaml). Иначе ecosystem.all.config.js (start-all.ps1, boot-resurrect)
// не будет поднимать crash-loop и считать «ожидаемым» процесс, который заведомо не стартует.
function livekitApps() {
  const present =
    fs.existsSync(LIVEKIT_BIN) &&
    fs.existsSync(path.join(PROJECT_ROOT, LIVEKIT_CONFIG));
  if (!present) return [];
  return [
    {
      name: 'itinvent-livekit',
      cwd: PROJECT_ROOT,
      script: LIVEKIT_BIN,
      args: `--config ${LIVEKIT_CONFIG}`,
      interpreter: 'none',
      windowsHide: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 15000,
      // Ключ и секрет читаются только из livekit.yaml; в env процесса секретов нет.
      env: {},
    },
  ];
}

module.exports = {
  apps: livekitApps(),
};
