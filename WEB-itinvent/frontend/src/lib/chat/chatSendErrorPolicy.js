// Классификация ошибок отправки сообщения чата.
//
// Транзитная ошибка — сервер не ответил по существу (нет сети, обрыв, таймаут,
// шлюз 502/503/504, мёртвый WS-транспорт). Такой пузырь остаётся «не отправлено»
// (⚠) и уходит повторно после восстановления связи, поэтому тост ошибки
// только вводит в заблуждение. Отказ сервера по существу (validation_error,
// forbidden, 4xx: 400/403/413/422/429 …) остаётся ошибкой для пользователя.

const TRANSIENT_HTTP_STATUSES = new Set([408, 502, 503, 504]);

const TRANSIENT_ERROR_CODES = new Set([
  'ERR_NETWORK',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NETWORK_CHANGED',
  'ERR_CONNECTION_RESET',
  'ECONNABORTED',
  'ECONNRESET',
  'ETIMEDOUT',
]);

// Сообщения chatSocket о мёртвом транспорте (без chatErrorCode от сервера).
// «access denied» и «is disabled» сюда сознательно не входят.
const DEAD_SOCKET_MESSAGE_RE = /^Chat websocket (disconnected|closed|reconnecting|is not connected|command timed out|send failed|connect timed out|heartbeat timeout)$/;

const readNavigatorOnline = () => (
  typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
    ? navigator.onLine
    : true
);

export function isTransientChatSendError(error, { online = readNavigatorOnline() } = {}) {
  if (online === false) return true;
  if (!error || typeof error !== 'object') return false;

  // Явный ответ chat-сервера по WS — отказ по существу.
  if (String(error.chatErrorCode || '').trim()) return false;

  const status = Number(error.response?.status || 0);
  if (status > 0) return TRANSIENT_HTTP_STATUSES.has(status);

  const code = String(error.code || '').trim();
  if (TRANSIENT_ERROR_CODES.has(code)) return true;

  // axios: запрос ушёл, ответа нет.
  if (error.isAxiosError && error.request && !error.response) return true;

  return DEAD_SOCKET_MESSAGE_RE.test(String(error.message || '').trim());
}
