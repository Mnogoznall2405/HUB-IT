/*
 * Source of truth for the PostgreSQL connection envelope in dual-chat mode.
 * It deliberately excludes the legacy single `itinvent-chat` process.
 */
const backend = require('./ecosystem.backend.config.js');
const chatScale = require('./ecosystem.chat.scale.config.js');

function asNonNegativeInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function envInt(env, name, fallback = 0) {
  return asNonNegativeInt(env?.[name], fallback);
}

function poolCapacity(env, sizeName, overflowName) {
  return envInt(env, sizeName) + envInt(env, overflowName);
}

function processBudget(app) {
  const env = app.env || {};
  const appCapacity = poolCapacity(env, 'APP_DB_POOL_SIZE', 'APP_DB_MAX_OVERFLOW');
  const hasWritePool = Object.prototype.hasOwnProperty.call(env, 'CHAT_DB_WRITE_POOL_SIZE');
  const hasReadPool = Object.prototype.hasOwnProperty.call(env, 'CHAT_DB_READ_POOL_SIZE');
  // A read engine has defaults independent of the legacy write alias.  Count both
  // explicitly whenever a process configures a read pool.
  const writeCapacity = hasWritePool
    ? poolCapacity(env, 'CHAT_DB_WRITE_POOL_SIZE', 'CHAT_DB_WRITE_MAX_OVERFLOW')
    : poolCapacity(env, 'CHAT_DB_POOL_SIZE', 'CHAT_DB_MAX_OVERFLOW');
  const readCapacity = hasReadPool
    ? poolCapacity(env, 'CHAT_DB_READ_POOL_SIZE', 'CHAT_DB_READ_MAX_OVERFLOW')
    : 0;
  const chatCapacity = writeCapacity + readCapacity;
  const appDedicatedCapacity = envInt(env, 'APP_DB_DEDICATED_CONNECTIONS', 0);
  const realtimeDedicatedCapacity = String(env.CHAT_REALTIME_TRANSPORT || '').toLowerCase() === 'postgres'
    ? envInt(env, 'CHAT_POSTGRES_REALTIME_DEDICATED_CONNECTIONS', 3)
    : 0;
  const dedicatedCapacity = appDedicatedCapacity + realtimeDedicatedCapacity;
  const instances = Math.max(1, envInt(app, 'instances', 1));
  const applicationNames = new Set();
  applicationNames.add(String(env.APP_DB_APPLICATION_NAME || app.name));
  if (appDedicatedCapacity > 0) {
    applicationNames.add(String(env.APP_DB_DEDICATED_APPLICATION_NAME || `${app.name}-dedicated`));
  }
  if (chatCapacity > 0) {
    applicationNames.add(String(env.CHAT_DB_APPLICATION_NAME || `${app.name}-write`));
    if (hasReadPool) {
      applicationNames.add(String(env.CHAT_DB_READ_APPLICATION_NAME || 'itinvent-backend-chat-read'));
    }
  }
  return {
    name: app.name,
    instances,
    app_db_capacity: appCapacity * instances,
    chat_db_capacity: chatCapacity * instances,
    dedicated_pg_capacity: dedicatedCapacity * instances,
    total_capacity: (appCapacity + chatCapacity + dedicatedCapacity) * instances,
    application_names: [...applicationNames].filter(Boolean),
  };
}

function buildBudget() {
  const backendApps = backend.apps.filter((app) => ![
    'itinvent-chat',
    'itinvent-preview-worker',
    'itinvent-chat-push-worker',
  ].includes(app.name));
  const selected = [...backendApps, ...chatScale.apps];
  const processes = selected.map(processBudget);
  const names = new Set(processes.flatMap((item) => item.application_names));
  // PostgreSQL realtime keeps these three long-lived connections per Chat API node.
  for (const name of [
    'itinvent-chat-realtime-listener',
    'itinvent-chat-realtime-publisher',
    'itinvent-chat-realtime-presence',
  ]) {
    names.add(name);
  }
  return {
    mode: 'dual_chat_postgres',
    reserve_target: 20,
    configured_managed_capacity: processes.reduce((total, item) => total + item.total_capacity, 0),
    managed_application_names: [...names].sort(),
    processes,
  };
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(buildBudget())}\n`);
}

module.exports = { buildBudget, processBudget };
