import { Box, Stack } from '@mui/material';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ToastViewport from '../components/feedback/ToastViewport';
import { normalizeToastAction } from '../components/feedback/toastActions';
import {
  normalizeNotificationItem,
  normalizeNotificationText,
} from '../lib/notificationUtils';
import { getBrowserAccount, BROWSER_ACCOUNT_EVENT } from '../lib/browserAccountSession';

const NotificationContext = createContext(null);
// Toast history lives in a separate context: it changes on every pushToast and
// would otherwise re-render all ~30 useNotification consumers for data that
// only the (optional) history list reads.
const NotificationHistoryContext = createContext([]);

const TOAST_HISTORY_KEY = 'itinvent_toast_history';
const HUB_SEEN_KEY = 'itinvent_hub_seen_ids';
const MAX_HISTORY_ITEMS = 50;
const MAX_SEEN_IDS = 300;
const MAX_ACTIVE_TOASTS = 4;
// Chat toasts drain one per CHAT_TOAST_VISIBLE_MS; past this backlog the oldest
// queued toasts are dropped — the newest ones stay, and history keeps all.
const MAX_CHAT_SERIAL_QUEUE = 8;
const CHAT_TOAST_VISIBLE_MS = 5_200;
const DEDUPE_WINDOW_MS = 15_000;
const EXPIRY_GRACE_MS = 20;

function safeParseArray(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadToastHistory() {
  if (!getBrowserAccount()) return [];
  try {
    return safeParseArray(window.localStorage.getItem(TOAST_HISTORY_KEY))
      .map(normalizeNotificationItem);
  } catch {
    return [];
  }
}

function loadSeenHubIds() {
  if (!getBrowserAccount()) return [];
  try {
    return safeParseArray(window.localStorage.getItem(HUB_SEEN_KEY))
      .map((value) => String(value || '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function persistToastHistory(items) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TOAST_HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS)));
  } catch {
    // Storage quota/private mode must not break toasts.
  }
}

function persistSeenHubIds(ids) {
  if (typeof window === 'undefined') return;
  try {
    // Union при записи: у localStorage нет транзакций, иначе read-then-write
    // из двух вкладок терял бы чужие маркеры.
    const merged = [...new Set([...loadSeenHubIds(), ...ids])];
    window.localStorage.setItem(HUB_SEEN_KEY, JSON.stringify(merged.slice(-MAX_SEEN_IDS)));
  } catch {
    // Storage quota/private mode must not break toasts.
  }
}

function createToastId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function extractApiDetail(error) {
  const response = error?.response;
  const data = response?.data;
  if (typeof data?.detail === 'string' && data.detail.trim()) return data.detail.trim();
  if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
  if (Array.isArray(data?.detail)) {
    return data.detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item?.msg === 'string') return item.msg;
        return '';
      })
      .filter(Boolean)
      .join('; ');
  }
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim();
  return '';
}

function buildToastPayload(severity, message, options = {}) {
  const nowIso = new Date().toISOString();
  const normalizedMessage = normalizeNotificationText(message).trim() || 'Событие';
  const normalizedTitle = normalizeNotificationText(options.title).trim();
  const source = String(options.source || 'system').trim() || 'system';
  const statusCode = Number(options.statusCode || 0) || undefined;
  const durationMs = Math.max(1, Number(options.durationMs || 5000) || 5000);
  const action = normalizeToastAction(options.action);
  const dedupeKey = String(
    options.dedupeKey || `${severity}:${source}:${normalizedTitle}:${normalizedMessage}:${statusCode || ''}`,
  );

  return {
    id: createToastId(),
    severity,
    source,
    channel: String(options.channel || 'system'),
    title: normalizedTitle || normalizedMessage,
    message: normalizedMessage,
    statusCode,
    createdAt: nowIso,
    lastSeenAt: nowIso,
    repeatCount: 1,
    suppressedCount: 0,
    durationMs,
    remainingMs: durationMs,
    expiresAt: null,
    paused: false,
    hiddenPaused: false,
    persist: Boolean(options.persist),
    actionLabel: normalizeNotificationText(options.actionLabel).trim(),
    onAction: typeof options.onAction === 'function' ? options.onAction : undefined,
    action,
    dedupeMode: options.dedupeMode === 'recent' ? 'recent' : 'none',
    dedupeKey,
  };
}

function updateHistoryItem(current, next) {
  return {
    ...current,
    severity: next.severity || current.severity,
    source: next.source || current.source,
    channel: next.channel || current.channel,
    title: next.title,
    message: next.message,
    statusCode: next.statusCode || current.statusCode,
    lastSeenAt: next.lastSeenAt,
    repeatCount: Number(current?.repeatCount || 1) + 1,
    suppressedCount: Number(current?.suppressedCount || 0) + 1,
    action: next.action || current.action || null,
  };
}

function updateActiveToast(current, next) {
  const durationMs = Math.max(1, Number(next.durationMs || current.durationMs || 5000) || 5000);
  const persist = Boolean(next.persist);
  return {
    ...current,
    severity: next.severity || current.severity,
    source: next.source || current.source,
    channel: next.channel || current.channel,
    title: next.title,
    message: next.message,
    statusCode: next.statusCode || current.statusCode,
    lastSeenAt: next.lastSeenAt,
    repeatCount: Number(current?.repeatCount || 1) + 1,
    suppressedCount: Number(current?.suppressedCount || 0) + 1,
    durationMs,
    remainingMs: durationMs,
    paused: Boolean(current.paused),
    expiresAt: current.paused ? current.expiresAt : Date.now() + durationMs,
    persist,
    actionLabel: next.actionLabel || current.actionLabel || '',
    onAction: next.onAction || current.onAction,
    action: next.action || current.action || null,
  };
}

export function NotificationProvider({ children }) {
  const [toastHistory, setToastHistory] = useState(() => loadToastHistory());
  const [activeToasts, setActiveToasts] = useState([]);
  const [seenHubNotificationIds, setSeenHubNotificationIds] = useState(() => loadSeenHubIds());
  const chatSerialQueueRef = useRef([]);
  const chatActiveRef = useRef(false);
  const seenHubNotificationIdsRef = useRef(seenHubNotificationIds);
  const accountKeyRef = useRef(getBrowserAccount());
  const accountEpochRef = useRef(0);
  const [accountEpoch, setAccountEpoch] = useState(0);

  useEffect(() => {
    const onAccountChanged = (event) => {
      const key = event.detail?.key || '';
      if (!event.detail?.reset && accountKeyRef.current === key) return;
      accountKeyRef.current = key;
      accountEpochRef.current += 1;
      setAccountEpoch(accountEpochRef.current);
      chatSerialQueueRef.current = [];
      chatActiveRef.current = false;
      setActiveToasts([]);
      setToastHistory([]);
      setSeenHubNotificationIds([]);
    };
    window.addEventListener(BROWSER_ACCOUNT_EVENT, onAccountChanged);
    return () => window.removeEventListener(BROWSER_ACCOUNT_EVENT, onAccountChanged);
  }, []);

  useEffect(() => {
    if (accountEpoch !== accountEpochRef.current || !accountKeyRef.current || accountKeyRef.current !== getBrowserAccount()) return;
    persistToastHistory(toastHistory);
  }, [toastHistory, accountEpoch]);

  useEffect(() => {
    seenHubNotificationIdsRef.current = seenHubNotificationIds;
    if (accountEpoch !== accountEpochRef.current || !accountKeyRef.current || accountKeyRef.current !== getBrowserAccount()) return;
    persistSeenHubIds(seenHubNotificationIds);
  }, [seenHubNotificationIds, accountEpoch]);

  // Соседние вкладки дублировали уведомления: seen-маркеры читались один раз
  // на маунте. storage-событие приходит только в другие вкладки — подхватываем
  // их маркеры (сравнение без учёта порядка гасит эхо-циклы записи).
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== HUB_SEEN_KEY || event.storageArea !== window.localStorage) return;
      const loaded = loadSeenHubIds();
      const current = seenHubNotificationIdsRef.current;
      if (loaded.length === current.length && loaded.every((value) => current.includes(value))) return;
      setSeenHubNotificationIds(loaded);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const nextExpiry = activeToasts.reduce((min, item) => (
      !item.persist && !item.paused && item.expiresAt
        ? Math.min(min, item.expiresAt)
        : min
    ), Infinity);
    if (!Number.isFinite(nextExpiry)) return undefined;

    const timeoutId = window.setTimeout(() => {
      setActiveToasts((prev) => {
        const now = Date.now();
        const next = prev.filter((item) => (
          item.persist || item.paused || !item.expiresAt || item.expiresAt > now
        ));
        return next.length === prev.length ? prev : next;
      });
    }, Math.max(0, nextExpiry - Date.now()) + EXPIRY_GRACE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [activeToasts]);

  useEffect(() => {
    const onVisibilityChange = () => {
      const now = Date.now();
      if (document.hidden) {
        setActiveToasts((prev) => prev.map((item) => (
          !item.persist && !item.paused
            ? {
                ...item,
                paused: true,
                hiddenPaused: true,
                remainingMs: Math.max(0, Number(item.expiresAt || 0) - now),
              }
            : item
        )));
      } else {
        setActiveToasts((prev) => prev.map((item) => (
          item.hiddenPaused
            ? {
                ...item,
                paused: false,
                hiddenPaused: false,
                expiresAt: now + Math.max(1, Number(item.remainingMs || item.durationMs || 0)),
              }
            : item
        )));
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    const hasActiveChatToast = activeToasts.some((item) => String(item?.source || '').trim() === 'chat');
    chatActiveRef.current = hasActiveChatToast;
    if (hasActiveChatToast) return;
    const queue = chatSerialQueueRef.current;
    if (!Array.isArray(queue) || queue.length === 0) return;
    const [nextChatToast, ...rest] = queue;
    chatSerialQueueRef.current = rest;
    chatActiveRef.current = true;
    const promoted = nextChatToast.persist
      ? nextChatToast
      : { ...nextChatToast, expiresAt: Date.now() + nextChatToast.durationMs };
    setActiveToasts((prev) => [...prev, promoted]);
  }, [activeToasts]);

  const dismissToast = useCallback((id) => {
    setActiveToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pauseToast = useCallback((id) => {
    const now = Date.now();
    setActiveToasts((prev) => prev.map((item) => (
      item.id === id && !item.persist && !item.paused
        ? { ...item, paused: true, remainingMs: Math.max(0, Number(item.expiresAt || 0) - now) }
        : item
    )));
  }, []);

  const resumeToast = useCallback((id) => {
    const now = Date.now();
    setActiveToasts((prev) => prev.map((item) => (
      item.id === id && !item.persist && item.paused && !item.hiddenPaused
        ? {
            ...item,
            paused: false,
            expiresAt: now + Math.max(1, Number(item.remainingMs || item.durationMs || 0)),
          }
        : item
    )));
  }, []);

  const pushToast = useCallback((severity, message, options = {}) => {
    if (accountEpoch !== accountEpochRef.current) return null;
    const isChatSerialToast = String(options.source || '').trim() === 'chat';
    const next = buildToastPayload(severity, message, {
      ...options,
      durationMs: isChatSerialToast
        ? Math.max(1, Number(options.durationMs || CHAT_TOAST_VISIBLE_MS) || CHAT_TOAST_VISIBLE_MS)
        : options.durationMs,
    });
    next.expiresAt = next.persist ? null : Date.now() + next.durationMs;

    setToastHistory((prev) => {
      if (next.dedupeMode === 'recent') {
        const nowMs = Date.now();
        const matchIndex = prev.findIndex((item) =>
          item?.dedupeKey === next.dedupeKey
          && (nowMs - Date.parse(item?.lastSeenAt || item?.createdAt || 0)) <= DEDUPE_WINDOW_MS,
        );

        if (matchIndex >= 0) {
          const updated = [...prev];
          updated[matchIndex] = updateHistoryItem(updated[matchIndex], next);
          return updated.sort((a, b) => String(b?.lastSeenAt || '').localeCompare(String(a?.lastSeenAt || '')));
        }
      }

      return [next, ...prev].slice(0, MAX_HISTORY_ITEMS);
    });

    // Чат-очередь живёт в рефах и обновляется синхронно: updater'ы setState
    // обязаны быть чистыми (StrictMode вызывает их дважды), а мутация
    // chatSerialQueueRef внутри updater'а дублировала бы элементы очереди.
    if (isChatSerialToast) {
      const queue = chatSerialQueueRef.current;
      if (next.dedupeMode === 'recent') {
        const queueMatchIndex = queue.findIndex((item) => item.dedupeKey === next.dedupeKey);
        if (queueMatchIndex >= 0) {
          chatSerialQueueRef.current = [
            ...queue.slice(0, queueMatchIndex),
            updateActiveToast(queue[queueMatchIndex], next),
            ...queue.slice(queueMatchIndex + 1),
          ];
          return next.id;
        }
        if (chatActiveRef.current) {
          setActiveToasts((prev) => prev.map((item) => (
            String(item?.source || '').trim() === 'chat' && item.dedupeKey === next.dedupeKey
              ? updateActiveToast(item, next)
              : item
          )));
          return next.id;
        }
      }
      const appended = [...queue, next].slice(-MAX_CHAT_SERIAL_QUEUE);
      if (!chatActiveRef.current && appended.length > 0) {
        const [queued, ...rest] = appended;
        chatSerialQueueRef.current = rest;
        chatActiveRef.current = true;
        const promoted = queued.persist ? queued : { ...queued, expiresAt: Date.now() + queued.durationMs };
        setActiveToasts((prev) => [...prev, promoted]);
        return next.id;
      }
      chatSerialQueueRef.current = appended;
      return next.id;
    }

    setActiveToasts((prev) => {
      if (next.dedupeMode === 'recent') {
        const match = prev.find((item) => item.dedupeKey === next.dedupeKey);
        if (match) {
          return prev.map((item) => (
            item.id === match.id
              ? updateActiveToast(item, next)
              : item
          ));
        }
      }

      return [...prev, next].slice(-MAX_ACTIVE_TOASTS);
    });

    return next.id;
  }, [accountEpoch]);

  const notifySuccess = useCallback((message, options = {}) => (
    pushToast('success', message, options)
  ), [pushToast]);

  const notifyInfo = useCallback((message, options = {}) => (
    pushToast('info', message, options)
  ), [pushToast]);

  const notifyWarning = useCallback((message, options = {}) => (
    pushToast('warning', message, options)
  ), [pushToast]);

  const notifyError = useCallback((message, options = {}) => (
    pushToast('error', message, options)
  ), [pushToast]);

  const notifyApiError = useCallback((error, fallbackMessage = 'Ошибка запроса.', options = {}) => {
    const detail = extractApiDetail(error);
    const title = String(options.title || fallbackMessage || 'Ошибка запроса.').trim();
    const message = detail && detail !== title ? detail : title;
    return pushToast('error', message, {
      ...options,
      title,
      statusCode: options.statusCode || error?.response?.status,
      dedupeMode: options.dedupeMode || 'recent',
    });
  }, [pushToast]);

  const clearToastHistory = useCallback(() => {
    if (accountEpoch !== accountEpochRef.current) return;
    setToastHistory([]);
  }, [accountEpoch]);

  const markHubNotificationsSeen = useCallback((ids) => {
    if (accountEpoch !== accountEpochRef.current) return;
    const values = (Array.isArray(ids) ? ids : [ids])
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    if (values.length === 0) return;

    setSeenHubNotificationIds((prev) => {
      const next = [...new Set([...prev, ...values])];
      return next.slice(-MAX_SEEN_IDS);
    });
  }, [accountEpoch]);

  const hasSeenHubNotification = useCallback((id) => {
    const normalized = String(id || '').trim();
    return normalized ? seenHubNotificationIdsRef.current.includes(normalized) : false;
  }, []);

  const value = useMemo(() => ({
    clearToastHistory,
    notifySuccess,
    notifyInfo,
    notifyWarning,
    notifyError,
    notifyApiError,
    hasSeenHubNotification,
    markHubNotificationsSeen,
  }), [
    clearToastHistory,
    hasSeenHubNotification,
    markHubNotificationsSeen,
    notifyApiError,
    notifyError,
    notifyInfo,
    notifySuccess,
    notifyWarning,
  ]);

  return (
    <NotificationContext.Provider value={value}>
      <NotificationHistoryContext.Provider value={toastHistory}>
        {children}
      </NotificationHistoryContext.Provider>
      <Box
        data-testid="toast-stack"
        data-toast-position="bottom-right"
        sx={{
          position: 'fixed',
          left: { xs: 12, sm: 'auto' },
          right: { xs: 12, sm: 24 },
          bottom: {
            xs: 'calc(var(--app-shell-mobile-bottom-nav-height, 0px) + 12px)',
            sm: 24,
          },
          zIndex: (theme) => theme.zIndex.snackbar,
          pointerEvents: 'none',
        }}
      >
        <Stack spacing={1}>
          {activeToasts.map((item) => (
            <Box
              key={item.id}
              sx={{
                'pointerEvents': 'auto',
                '@keyframes toast-enter': {
                  from: { opacity: 0, transform: 'translateY(8px)' },
                  to: { opacity: 1, transform: 'none' },
                },
                'animation': 'toast-enter 160ms ease-out',
                '@media (prefers-reduced-motion: reduce)': {
                  animation: 'none',
                },
              }}
            >
              <ToastViewport
                toast={item}
                open
                inline
                onClose={(_, reason) => {
                  if (reason === 'clickaway') return;
                  dismissToast(item.id);
                }}
                onPause={() => pauseToast(item.id)}
                onResume={() => resumeToast(item.id)}
              />
            </Box>
          ))}
        </Stack>
      </Box>
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const value = useContext(NotificationContext);
  if (!value) {
    throw new Error('useNotification must be used within NotificationProvider');
  }
  return value;
}

/** Как useNotification, но без провайдера возвращает null (изолированный рендер компонента). */
export function useOptionalNotification() {
  return useContext(NotificationContext);
}

/** Отдельная подписка на историю тостов: не ререндерит обычных потребителей API. */
export function useNotificationHistory() {
  return useContext(NotificationHistoryContext);
}
