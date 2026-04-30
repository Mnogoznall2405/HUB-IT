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
      args: '-m scan_server',
      interpreter: 'none',
      windowsHide: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        PYTHONUNBUFFERED: '1',
        SCAN_WORKER_ENABLED: '0',
        SCAN_SERVER_WATCHDOG_TIMEOUT_SEC: '10',
        SCAN_SERVER_WATCHDOG_FAILURES: '5',
        SCAN_INGEST_MAX_PENDING_PDF_JOBS: '25000',
        SCAN_INGEST_MAX_CONCURRENCY: '4',
        SCAN_TRANSIENT_MAX_GB: '80',
        SCAN_INGEST_RETRY_AFTER_SEC: '60',
      },
    },
    {
      name: 'itinvent-scan-worker',
      cwd: PROJECT_ROOT,
      script: PYTHON,
      args: '-m scan_server.worker_main',
      interpreter: 'none',
      windowsHide: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        PYTHONUNBUFFERED: '1',
        SCAN_WORKER_INTERVAL_SEC: '1',
        SCAN_JOB_MAX_WORKERS: '12',
        SCAN_OCR_MAX_PROCESSES: '12',
        SCAN_JOB_PROCESSING_TIMEOUT_SEC: '1800',
        SCAN_JOB_MAX_ATTEMPTS: '3',
      },
    },
  ],
};
