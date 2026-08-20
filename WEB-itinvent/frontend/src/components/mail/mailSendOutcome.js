import { getMailErrorCode, getMailErrorDetail } from './mailErrorModel';

const DEFAULT_MAIL_SEND_TIMEOUT_MS = 115_000;

const parseMailSendTimeoutMs = (raw) => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1000) return DEFAULT_MAIL_SEND_TIMEOUT_MS;
  return Math.floor(value);
};

export const MAIL_SEND_TIMEOUT_MS = parseMailSendTimeoutMs(
  typeof import.meta !== 'undefined' ? import.meta.env?.VITE_MAIL_SEND_TIMEOUT_MS : undefined,
);

export const MAIL_SEND_OUTCOME = {
  SENT: 'sent',
  NOT_SENT: 'not_sent',
  MAYBE_SENT: 'maybe_sent',
};

export const MAIL_SEND_NOT_SENT_MESSAGE = 'Письмо не отправлено.';
export const MAIL_SEND_MAYBE_SENT_MESSAGE = (
  'Письмо могло быть отправлено. Проверьте папку «Отправленные» и не отправляйте его повторно сразу.'
);

const MAYBE_SENT_CODES = new Set([
  'MAIL_SEND_TIMEOUT',
  'MAIL_SEND_UNKNOWN',
  'MAIL_SEND_IN_FLIGHT',
  'MAIL_SEND_FAILED',
]);

const NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ETIMEDOUT',
  'ERR_NETWORK',
  'ECONNRESET',
  'EAI_AGAIN',
]);

const isTimeoutLikeMessage = (value) => {
  const text = String(value || '').trim().toLowerCase();
  return text.includes('timeout')
    || text.includes('timed out')
    || text.includes('превышено время')
    || text.includes('заняла слишком много времени');
};

export const classifyMailSendError = (requestError) => {
  const headerCode = String(getMailErrorCode(requestError) || '').trim().toUpperCase();
  if (MAYBE_SENT_CODES.has(headerCode)) return MAIL_SEND_OUTCOME.MAYBE_SENT;
  if (
    headerCode === 'MAIL_AUTH_INVALID'
    || headerCode === 'MAIL_PASSWORD_REQUIRED'
    || headerCode === 'MAIL_RELOGIN_REQUIRED'
    || headerCode === 'MAIL_IDEMPOTENCY_CONFLICT'
    || headerCode === 'MAIL_IDEMPOTENCY_KEY_INVALID'
    || headerCode === 'MAIL_COMPOSE_INVALID'
  ) {
    return MAIL_SEND_OUTCOME.NOT_SENT;
  }

  const statusCode = Number(requestError?.response?.status || 0);
  if ([408, 502, 503, 504].includes(statusCode)) return MAIL_SEND_OUTCOME.MAYBE_SENT;
  if (statusCode === 500) return MAIL_SEND_OUTCOME.MAYBE_SENT;
  if (statusCode && statusCode >= 400 && statusCode < 500) return MAIL_SEND_OUTCOME.NOT_SENT;

  const axiosCode = String(requestError?.code || '').trim().toUpperCase();
  if (axiosCode === 'ERR_CANCELED') return MAIL_SEND_OUTCOME.NOT_SENT;
  if (NETWORK_ERROR_CODES.has(axiosCode)) return MAIL_SEND_OUTCOME.MAYBE_SENT;
  if (isTimeoutLikeMessage(requestError?.message) || isTimeoutLikeMessage(requestError?.response?.data?.detail)) {
    return MAIL_SEND_OUTCOME.MAYBE_SENT;
  }
  if (!statusCode) return MAIL_SEND_OUTCOME.MAYBE_SENT;
  return MAIL_SEND_OUTCOME.NOT_SENT;
};

export const getMailSendErrorMessage = (requestError, fallbackMessage = '') => {
  const outcome = classifyMailSendError(requestError);
  if (outcome === MAIL_SEND_OUTCOME.MAYBE_SENT) {
    return MAIL_SEND_MAYBE_SENT_MESSAGE;
  }
  const detail = getMailErrorDetail(requestError, '');
  if (detail) return detail;
  return String(fallbackMessage || MAIL_SEND_NOT_SENT_MESSAGE).trim() || MAIL_SEND_NOT_SENT_MESSAGE;
};

export const withMailSendTimeout = (config = {}) => ({
  timeout: MAIL_SEND_TIMEOUT_MS,
  ...config,
});
