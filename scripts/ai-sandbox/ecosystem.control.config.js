// Explicitly started only during the approved sandbox rollout.
const path = require('path');
const { resolvePython } = require('../pm2/python-path');
const root = path.resolve(__dirname, '../..');
module.exports = {
  apps: [{
    name: 'itinvent-ai-sandbox-control',
    cwd: path.join(root, 'WEB-itinvent'),
    script: resolvePython(root),
    args: path.join(__dirname, 'start_control.py'),
    interpreter: 'none', windowsHide: true,
    autorestart: true, max_restarts: 10, min_uptime: 30000,
    restart_delay: 10000, kill_timeout: 15000,
    env: {
      HUBIT_RUNTIME_ROLE: 'ai-sandbox-control',
      APP_DB_POOL_SIZE: '2', APP_DB_MAX_OVERFLOW: '0',
      CHAT_DB_POOL_SIZE: '2', CHAT_DB_MAX_OVERFLOW: '0',
      CHAT_DB_READ_POOL_SIZE: '1', CHAT_DB_READ_MAX_OVERFLOW: '0',
      LDAP_SYNC_BACKGROUND_ENABLED: '0', MFU_RUNTIME_MONITOR_ENABLED: '0',
      MAIL_MODULE_ENABLED: '0', PYTHONDONTWRITEBYTECODE: '1',
    },
  }],
};
