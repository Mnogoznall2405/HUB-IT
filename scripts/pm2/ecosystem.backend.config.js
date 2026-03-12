const path = require('path');
const { resolvePython } = require('./python-path');

const PROJECT_ROOT = 'C:\\Project\\Image_scan';
const WEB_ROOT = path.join(PROJECT_ROOT, 'WEB-itinvent');
const PYTHON = resolvePython(PROJECT_ROOT);

module.exports = {
  apps: [
    {
      name: 'itinvent-backend',
      cwd: WEB_ROOT,
      script: PYTHON,
      args: '-m uvicorn backend.main:app --host 127.0.0.1 --port 8001 --app-dir C:\\Project\\Image_scan\\WEB-itinvent',
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
