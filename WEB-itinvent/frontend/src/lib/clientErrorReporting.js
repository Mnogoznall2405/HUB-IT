// Глобальный сбор клиентских ошибок: window.onerror и unhandledrejection
// складываются в кольцевой буфер sessionStorage, чтобы диагностику можно было
// выгрузить из вкладки поддержки даже без внешней телеметрии (FE-0070).
const STORAGE_KEY = 'hubit:client-errors';
const MAX_ENTRIES = 20;
const MAX_MESSAGE_LENGTH = 500;

const normalizeMessage = (value) => String(value || '').slice(0, MAX_MESSAGE_LENGTH);

const readBuffer = () => {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const getClientErrorLog = () => readBuffer();

export const clearClientErrorLog = () => {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
};

export const reportClientError = (kind, detail = {}) => {
  if (typeof window === 'undefined') return;
  const entry = {
    kind: String(kind || 'error'),
    message: normalizeMessage(detail.message),
    source: normalizeMessage(detail.source),
    line: Number(detail.line || 0) || 0,
    column: Number(detail.column || 0) || 0,
    stack: normalizeMessage(detail.stack),
    at: new Date().toISOString(),
  };
  try {
    const next = [...readBuffer(), entry].slice(-MAX_ENTRIES);
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // sessionStorage может быть недоступен — ошибки просто идут в console.
  }
  // eslint-disable-next-line no-console
  console.error('[client-error]', entry);
};

export const bindGlobalErrorReporting = () => {
  if (typeof window === 'undefined' || window.__hubitGlobalErrorReportingBound) return;
  window.__hubitGlobalErrorReportingBound = true;

  window.addEventListener('error', (event) => {
    // Ресурсные ошибки (img/script/src) приходят без message — фиксируем источник.
    const target = event?.target;
    if (target && target !== window && !event?.message) {
      reportClientError('resource', {
        message: `Failed to load ${String(target.tagName || 'resource').toLowerCase()}`,
        source: target.src || target.href || '',
      });
      return;
    }
    reportClientError('error', {
      message: event?.message,
      source: event?.filename,
      line: event?.lineno,
      column: event?.colno,
      stack: event?.error?.stack,
    });
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    // Чанк-ошибки уже обрабатываются routeChunkRecovery в main.jsx — не дублируем.
    const message = String(reason?.message || reason || '');
    if (message.includes('Failed to fetch dynamically imported module')) return;
    reportClientError('unhandledrejection', {
      message,
      stack: reason?.stack,
    });
  });
};
