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
      max_memory_restart: '4G',
      env: {
        PYTHONUNBUFFERED: '1',
        SCAN_WORKER_ENABLED: '0',
        SCAN_SERVER_LOCK_WAIT_SEC: '30',
        SCAN_SERVER_WATCHDOG_TIMEOUT_SEC: '10',
        SCAN_SERVER_WATCHDOG_FAILURES: '5',
        SCAN_INGEST_MAX_PENDING_PDF_JOBS: '1000',
        SCAN_INGEST_MAX_CONCURRENCY: '2',
        SCAN_TRANSIENT_MAX_GB: '5',
        SCAN_INGEST_RETRY_AFTER_SEC: '60',
        SCAN_DASHBOARD_CACHE_TTL_SEC: '15',
        // Kept short deliberately: this is the SQLite-internal busy wait, and it runs
        // while the process-wide DB lock is held, so a large value here head-of-line
        // blocks every other request (reads included) behind one contended write.
        // See scan_server/config.py for the full rationale.
        SCAN_SQLITE_BUSY_TIMEOUT_MS: '2000',
        SCAN_SQLITE_BUSY_RETRY_ATTEMPTS: '5',
        SCAN_SQLITE_BUSY_RETRY_BASE_MS: '100',
        SCAN_CLEAN_JOB_RETENTION_DAYS: '14',
        SCAN_FAILED_JOB_RETENTION_DAYS: '30',
        SCAN_INCIDENT_RETENTION_DAYS: '90',
        SCAN_PDF_MAX_BYTES: String(25 * 1024 * 1024),
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
      max_memory_restart: '8G',
      env: {
        PYTHONUNBUFFERED: '1',
        SCAN_WORKER_LOCK_WAIT_SEC: '30',
        SCAN_WORKER_INTERVAL_SEC: '3',
        SCAN_JOB_MAX_WORKERS: '1',
        SCAN_OCR_MAX_PROCESSES: '1',
        SCAN_WORKER_MEMORY_LIMIT_MB: '6144',
        SCAN_OCR_DPI: '200',
        SCAN_JOB_PROCESSING_TIMEOUT_SEC: '1800',
        SCAN_JOB_MAX_ATTEMPTS: '3',
        SCAN_SQLITE_BUSY_TIMEOUT_MS: '2000',
        SCAN_SQLITE_BUSY_RETRY_ATTEMPTS: '5',
        SCAN_SQLITE_BUSY_RETRY_BASE_MS: '100',
        SCAN_CLEAN_JOB_RETENTION_DAYS: '14',
        SCAN_FAILED_JOB_RETENTION_DAYS: '30',
        SCAN_INCIDENT_RETENTION_DAYS: '90',
        SCAN_PDF_MAX_BYTES: String(25 * 1024 * 1024),
      },
    },
  ],
};
