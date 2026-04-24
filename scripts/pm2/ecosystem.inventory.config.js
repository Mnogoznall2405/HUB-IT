const { resolvePython } = require('./python-path');

const PROJECT_ROOT = 'C:\\Project\\Image_scan';
const PYTHON = resolvePython(PROJECT_ROOT);

module.exports = {
  apps: [
    {
      name: 'itinvent-inventory',
      cwd: PROJECT_ROOT,
      script: PYTHON,
      args: '-m inventory_server',
      interpreter: 'none',
      windowsHide: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        INVENTORY_SERVER_HOST: '127.0.0.1',
        INVENTORY_SERVER_PORT: '8012',
        PYTHONUNBUFFERED: '1',
      },
    },
  ],
};
