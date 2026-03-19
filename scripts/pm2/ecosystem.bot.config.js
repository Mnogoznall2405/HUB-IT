const path = require('path');
const { resolvePython } = require('./python-path');

const PROJECT_ROOT = 'C:\\Project\\Image_scan';
const PYTHON = resolvePython(PROJECT_ROOT);

module.exports = {
  apps: [
    {
      name: 'itinvent-bot',
      cwd: PROJECT_ROOT,
      script: PYTHON,
      args: '-m bot.main',
      interpreter: 'none',
      windowsHide: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    },
  ],
};
