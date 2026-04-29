const path = require('path');
const { resolvePython } = require('./python-path');

const PROJECT_ROOT = 'C:\\Project\\Image_scan';
const WEB_ROOT = path.join(PROJECT_ROOT, 'WEB-itinvent');
const PYTHON = resolvePython(PROJECT_ROOT);

function buildBackendInstance(name, port, nodeId) {
  return {
    name,
    cwd: WEB_ROOT,
    script: PYTHON,
    args: 'start_server.py',
    interpreter: 'none',
    windowsHide: true,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    env: {
      BACKEND_HOST: '127.0.0.1',
      BACKEND_PORT: String(port),
      CHAT_REALTIME_NODE_ID: String(nodeId),
      CHAT_REDIS_CHANNEL: 'itinvent:chat:events',
      CHAT_PRESENCE_TTL_SEC: '75',
      CHAT_PRESENCE_TOUCH_THROTTLE_SEC: '15',
      CHAT_PRESENCE_WATCH_LIMIT: '50',
      CHAT_WS_COMMANDS_PER_SEC: '20',
      CHAT_WS_COMMAND_BURST: '40',
      CHAT_WS_OUTBOUND_QUEUE_SIZE: '256',
      CHAT_TYPING_STARTED_THROTTLE_SEC: '2',
      CHAT_TYPING_STATE_TTL_SEC: '5',
      CHAT_OUTBOX_CONCURRENCY: '4',
      ANYIO_THREAD_TOKENS: '120',
      LDAP_SYNC_BACKGROUND_ENABLED: '0',
      MFU_RUNTIME_MONITOR_ENABLED: '1',
      MAIL_NOTIFICATION_BACKGROUND_ENABLED: '0',
      PYTHONUNBUFFERED: '1',
    },
  };
}

module.exports = {
  apps: [
    buildBackendInstance('itinvent-backend-a', 8001, 'backend-a'),
    buildBackendInstance('itinvent-backend-b', 8002, 'backend-b'),
    {
      name: 'itinvent-chat-push-worker',
      cwd: WEB_ROOT,
      script: PYTHON,
      args: 'start_chat_push_worker.py',
      interpreter: 'none',
      windowsHide: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        CHAT_PUSH_OUTBOX_ENABLED: '1',
        CHAT_PUSH_OUTBOX_POLL_INTERVAL_SEC: '2',
        CHAT_PUSH_OUTBOX_BATCH_SIZE: '25',
        CHAT_PUSH_OUTBOX_MAX_CONCURRENCY: '4',
        CHAT_PUSH_OUTBOX_MAX_ATTEMPTS: '8',
        CHAT_PUSH_OUTBOX_RETRY_BASE_SEC: '15',
        CHAT_PUSH_OUTBOX_PROCESSING_TIMEOUT_SEC: '300',
        CHAT_PUSH_OUTBOX_HEARTBEAT_SEC: '60',
        PYTHONUNBUFFERED: '1',
      },
    },
    {
      name: 'itinvent-ai-chat-worker',
      cwd: WEB_ROOT,
      script: PYTHON,
      args: 'start_ai_chat_worker.py',
      interpreter: 'none',
      windowsHide: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        AI_CHAT_WORKER_CONCURRENCY: '2',
        AI_KB_INDEX_FRESHNESS_TTL_SEC: '30',
        PYTHONUNBUFFERED: '1',
      },
    },
  ],
};
