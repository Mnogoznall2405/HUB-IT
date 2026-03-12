const path = require('path');
const { resolvePython } = require('./python-path');

const PROJECT_ROOT = 'C:\\Project\\Image_scan';
const PYTHON = resolvePython(PROJECT_ROOT);

module.exports = {
  apps: [
    {
      name: 'itinvent-scan',
      cwd: PROJECT_ROOT,
      script: PYTHON,
      args: '-m uvicorn scan_server.app:app --host 127.0.0.1 --port 8011 --app-dir C:\\Project\\Image_scan',
      interpreter: 'none',
      windowsHide: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        PYTHONUNBUFFERED: '1',
      },
    },
  ],
};
