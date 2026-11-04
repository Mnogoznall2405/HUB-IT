/*
 * Единственное место, где задаются размеры пулов PostgreSQL для процессов PM2.
 *
 * Менять числа нужно только здесь: ecosystem.*.config.js подключают их через dbPool(name),
 * а postgres_connection_budget.js и scripts/check_postgres_connection_budget.py считают по ним потолок.
 * Это значения по умолчанию для процесса без явного env; .env их не переопределяет (PM2 env сильнее).
 *
 * Ограничение сервера: max_connections задаётся на PostgreSQL-сервере (DB-06), а не в репозитории.
 * Факт сейчас 300 (conf.d/hubit.conf перекрывает 100 из postgresql.conf); живое значение читает
 * `python scripts/check_postgres_connection_budget.py`. После изменения чисел запускать его:
 * projected_ok должен остаться True (запас RESERVE свободных соединений).
 *
 * Ключи:
 *   APP_DB_POOL_SIZE / APP_DB_MAX_OVERFLOW        основной пул app-схемы (burst — только overflow);
 *   APP_DB_DEDICATED_CONNECTIONS                  отдельные долгоживущие соединения (advisory lock);
 *   CHAT_DB_*_POOL_SIZE / *_MAX_OVERFLOW          пулы записи/чтения чата (POOL_SIZE — алиас записи);
 *   CHAT_DB_CONNECTION_BUDGET                     лимит чата на процесс; при превышении процесс не стартует.
 */

// Свободных соединений, которые должны оставаться у сервера при расчётном пике всех процессов.
const RESERVE = 20;

// Заметки по размерам:
//  - itinvent-chat-a/b: auth-пул 10+5 нужен, потому что каждый запрос читает auth-таблицы; пул 2 был
//    занят целиком при скачках задержки БД (наблюдалось 2026-10-06). Чат на узел: запись 6+1 + чтение 5
//    + три выделенных соединения realtime (publisher/LISTEN/presence), два узла — не больше 30.
//  - itinvent-preview-worker: 3 app + 3 запись + 1 чтение = 7 максимум на задачи превью.
//  - itinvent-backend: обсуждения задач идут через chat write-движок API-процесса; read-движок имеет
//    собственные значения по умолчанию, поэтому его размер тоже задан явно.
//  - itinvent-monitoring-worker: до 12 ICMP + 4 SNMP опросов держат по соединению (lease), плюс владелец
//    цикла и обращения к хранилищу — пик около 22, поэтому 20+5.
const POOLS = {
  'itinvent-backend': { APP_DB_POOL_SIZE: '20', APP_DB_MAX_OVERFLOW: '5', CHAT_DB_POOL_SIZE: '2', CHAT_DB_MAX_OVERFLOW: '1', CHAT_DB_READ_POOL_SIZE: '1', CHAT_DB_READ_MAX_OVERFLOW: '0', CHAT_DB_CONNECTION_BUDGET: '4' },
  'itinvent-chat': { APP_DB_POOL_SIZE: '5', APP_DB_MAX_OVERFLOW: '3', CHAT_DB_POOL_SIZE: '12', CHAT_DB_MAX_OVERFLOW: '2', CHAT_DB_WRITE_POOL_SIZE: '12', CHAT_DB_WRITE_MAX_OVERFLOW: '2', CHAT_DB_READ_POOL_SIZE: '12', CHAT_DB_READ_MAX_OVERFLOW: '4', CHAT_DB_CONNECTION_BUDGET: '40' },
  'itinvent-preview-worker': { APP_DB_POOL_SIZE: '3', APP_DB_MAX_OVERFLOW: '0', CHAT_DB_POOL_SIZE: '2', CHAT_DB_MAX_OVERFLOW: '1', CHAT_DB_WRITE_POOL_SIZE: '2', CHAT_DB_WRITE_MAX_OVERFLOW: '1', CHAT_DB_READ_POOL_SIZE: '1', CHAT_DB_READ_MAX_OVERFLOW: '0', CHAT_DB_CONNECTION_BUDGET: '4' },
  'itinvent-monitoring-worker': { APP_DB_POOL_SIZE: '20', APP_DB_MAX_OVERFLOW: '5' },
  'itinvent-mail-notification-worker': { APP_DB_POOL_SIZE: '1', APP_DB_MAX_OVERFLOW: '0', CHAT_DB_POOL_SIZE: '2', CHAT_DB_MAX_OVERFLOW: '1', CHAT_DB_READ_POOL_SIZE: '1', CHAT_DB_READ_MAX_OVERFLOW: '0', CHAT_DB_CONNECTION_BUDGET: '4' },
  'itinvent-chat-push-worker': { APP_DB_POOL_SIZE: '1', APP_DB_MAX_OVERFLOW: '0', CHAT_DB_POOL_SIZE: '2', CHAT_DB_MAX_OVERFLOW: '1', CHAT_DB_READ_POOL_SIZE: '1', CHAT_DB_READ_MAX_OVERFLOW: '0', CHAT_DB_CONNECTION_BUDGET: '4' },
  'itinvent-ai-chat-worker': { APP_DB_POOL_SIZE: '1', APP_DB_MAX_OVERFLOW: '0', CHAT_DB_POOL_SIZE: '2', CHAT_DB_MAX_OVERFLOW: '1', CHAT_DB_READ_POOL_SIZE: '1', CHAT_DB_READ_MAX_OVERFLOW: '0', CHAT_DB_CONNECTION_BUDGET: '4' },
  'itinvent-my-files-worker': { APP_DB_POOL_SIZE: '4', APP_DB_MAX_OVERFLOW: '2', APP_DB_DEDICATED_CONNECTIONS: '1' },
  'itinvent-hub-notifications-retention-worker': { APP_DB_POOL_SIZE: '1', APP_DB_MAX_OVERFLOW: '0' },
  'itinvent-chat-push-outbox-retention-worker': { APP_DB_POOL_SIZE: '1', APP_DB_MAX_OVERFLOW: '0', CHAT_DB_POOL_SIZE: '2', CHAT_DB_MAX_OVERFLOW: '1', CHAT_DB_READ_POOL_SIZE: '1', CHAT_DB_READ_MAX_OVERFLOW: '0', CHAT_DB_CONNECTION_BUDGET: '4' },
  'itinvent-backend-a': { APP_DB_POOL_SIZE: '10', APP_DB_MAX_OVERFLOW: '20' },
  'itinvent-backend-b': { APP_DB_POOL_SIZE: '10', APP_DB_MAX_OVERFLOW: '20' },
  'itinvent-chat-a': { APP_DB_POOL_SIZE: '10', APP_DB_MAX_OVERFLOW: '5', CHAT_DB_POOL_SIZE: '6', CHAT_DB_MAX_OVERFLOW: '1', CHAT_DB_WRITE_POOL_SIZE: '6', CHAT_DB_WRITE_MAX_OVERFLOW: '1', CHAT_DB_READ_POOL_SIZE: '5', CHAT_DB_READ_MAX_OVERFLOW: '0', CHAT_DB_CONNECTION_BUDGET: '30' },
  'itinvent-chat-b': { APP_DB_POOL_SIZE: '10', APP_DB_MAX_OVERFLOW: '5', CHAT_DB_POOL_SIZE: '6', CHAT_DB_MAX_OVERFLOW: '1', CHAT_DB_WRITE_POOL_SIZE: '6', CHAT_DB_WRITE_MAX_OVERFLOW: '1', CHAT_DB_READ_POOL_SIZE: '5', CHAT_DB_READ_MAX_OVERFLOW: '0', CHAT_DB_CONNECTION_BUDGET: '30' },
};

function dbPool(name) {
  const pool = POOLS[name];
  if (!pool) throw new Error(`db-pools.js: нет записи для процесса ${name}`);
  return { ...pool };
}

module.exports = { RESERVE, POOLS, dbPool };
