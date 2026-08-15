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

const SCAN_DATABASE_URL =
  String(process.env.SCAN_DATABASE_URL || '').trim() || readDotEnvValue('SCAN_DATABASE_URL');

const SCAN_PERF_TIMING_HEADERS_ENABLED =
  String(process.env.SCAN_PERF_TIMING_HEADERS_ENABLED || '').trim() ||
  readDotEnvValue('SCAN_PERF_TIMING_HEADERS_ENABLED') ||
  'false';

const sharedDbEnv = SCAN_DATABASE_URL ? { SCAN_DATABASE_URL } : {};

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
      // Windows: give PM2 time to win32-kill before spawning a replacement.
      kill_timeout: 15000,
      max_memory_restart: '4G',
      env: {
        PYTHONUNBUFFERED: '1',
        SCAN_WORKER_ENABLED: '0',
        SCAN_SERVER_LOCK_WAIT_SEC: '30',
        SCAN_SERVER_WATCHDOG_TIMEOUT_SEC: '10',
        SCAN_SERVER_WATCHDOG_FAILURES: '5',
        SCAN_INGEST_MAX_PENDING_PDF_JOBS: '4000',
        SCAN_INGEST_MAX_PENDING_JOBS: '4000',
        SCAN_INGEST_MAX_CONCURRENCY: '2',
        SCAN_TRANSIENT_MAX_GB: '5',
        SCAN_INGEST_RETRY_AFTER_SEC: '60',
        SCAN_DASHBOARD_CACHE_TTL_SEC: '60',
        SCAN_SYSTEM_METRICS_SAMPLE_INTERVAL_SECONDS: '30',
        // Ops toggle via root .env (S1a load-gate). Default false; never pair with NullLock on prod.
        SCAN_PERF_TIMING_HEADERS_ENABLED,
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
        // Mirror worker capacity/tuning so /health reports the deployed worker profile.
        SCAN_JOB_MAX_WORKERS: '6',
        SCAN_OCR_MAX_PROCESSES: '6',
        SCAN_OCR_DPI: '250',
        SCAN_OCR_LANG: 'rus',
        SCAN_OCR_FOCUSED_DPI: '300',
        SCAN_OCR_FULL_PAGE_MAX_PIXELS: '20000000',
        SCAN_OCR_FOCUSED_REGION_MAX_PIXELS: '12000000',
        SCAN_PDF_MAX_BYTES: String(50 * 1024 * 1024),
        ...sharedDbEnv,
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
      kill_timeout: 15000,
      max_memory_restart: '8G',
      env: {
        PYTHONUNBUFFERED: '1',
        SCAN_WORKER_LOCK_WAIT_SEC: '30',
        SCAN_WORKER_INTERVAL_SEC: '3',
        SCAN_JOB_MAX_WORKERS: '6',
        SCAN_OCR_MAX_PROCESSES: '6',
        SCAN_WORKER_MEMORY_LIMIT_MB: '6144',
        SCAN_OCR_DPI: '250',
        SCAN_OCR_LANG: 'rus',
        SCAN_OCR_FOCUSED_DPI: '300',
        SCAN_OCR_FULL_PAGE_MAX_PIXELS: '20000000',
        SCAN_OCR_FOCUSED_REGION_MAX_PIXELS: '12000000',
        SCAN_JOB_PROCESSING_TIMEOUT_SEC: '1800',
        SCAN_JOB_MAX_ATTEMPTS: '3',
        SCAN_SQLITE_BUSY_TIMEOUT_MS: '2000',
        SCAN_SQLITE_BUSY_RETRY_ATTEMPTS: '5',
        SCAN_SQLITE_BUSY_RETRY_BASE_MS: '100',
        SCAN_CLEAN_JOB_RETENTION_DAYS: '14',
        SCAN_FAILED_JOB_RETENTION_DAYS: '30',
        SCAN_INCIDENT_RETENTION_DAYS: '90',
        SCAN_PDF_MAX_BYTES: String(50 * 1024 * 1024),
        ...sharedDbEnv,
      },
    },
    {
      // Dedicated system-metrics retention (24h). Independent of itinvent-scan-worker restart storm.
      name: 'itinvent-scan-system-metrics-retention-worker',
      cwd: PROJECT_ROOT,
      script: PYTHON,
      args: '-m scan_server.system_metrics_retention_main',
      interpreter: 'none',
      windowsHide: true,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 10000,
      max_memory_restart: '512M',
      instances: 1,
      env: {
        PYTHONUNBUFFERED: '1',
        SCAN_SYSTEM_METRICS_RETENTION_ENABLED: 'true',
        SCAN_SYSTEM_METRICS_RETENTION_DRY_RUN: 'false',
        SCAN_SYSTEM_METRICS_RETENTION_HOURS: '24',
        SCAN_SYSTEM_METRICS_RETENTION_DAYS: '3',
        SCAN_SYSTEM_METRICS_RETENTION_BATCH_SIZE: '5000',
        SCAN_SYSTEM_METRICS_RETENTION_PAUSE_MS: '500',
        SCAN_SYSTEM_METRICS_RETENTION_INTERVAL_SECONDS: '3600',
        SCAN_SYSTEM_METRICS_RETENTION_MAX_RUNTIME_SECONDS: '300',
        SCAN_SYSTEM_METRICS_RETENTION_STATEMENT_TIMEOUT_MS: '15000',
        SCAN_SYSTEM_METRICS_RETENTION_LOCK_TIMEOUT_MS: '1000',
        ...sharedDbEnv,
      },
    },
  ],
};
