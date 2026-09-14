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

const NotificationContext = createContext(null);

const TOAST_HISTORY_KEY = 'itinvent_toast_history';
const HUB_SEEN_KEY = 'itinvent_hub_seen_ids';
const MAX_HISTORY_ITEMS = 50;
const MAX_SEEN_IDS = 300;
const MAX_ACTIVE_TOASTS = 4;
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
  if (typeof window === 'undefined') return [];
  return safeParseArray(window.localStorage.getItem(TOAST_HISTORY_KEY))
    .map(normalizeNotificationItem);
}

function loadSeenHubIds() {
  if (typeof window === 'undefined') return [];
  return safeParseArray(window.localStorage.getItem(HUB_SEEN_KEY))
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function persistToastHistory(items) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOAST_HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS)));
}

function persistSeenHubIds(ids) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(HUB_SEEN_KEY, JSON.stringify(ids.slice(-MAX_SEEN_IDS)));
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

  useEffect(() => {
    persistToastHistory(toastHistory);
  }, [toastHistory]);

  useEffect(() => {
    persistSeenHubIds(seenHubNotificationIds);
  }, [seenHubNotificationIds]);

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
    if (hasActiveChatToast) return;
    const queue = chatSerialQueueRef.current;
    if (!Array.isArray(queue) || queue.length === 0) return;
    const nextChatToast = queue.shift();
    if (!nextChatToast) return;
    if (!nextChatToast.persist) nextChatToast.expiresAt = Date.now() + nextChatToast.durationMs;
    setActiveToasts((prev) => [...prev, nextChatToast]);
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

    setActiveToasts((prev) => {
      if (isChatSerialToast) {
        if (next.dedupeMode === 'recent') {
          const queueMatchIndex = chatSerialQueueRef.current.findIndex((item) => item.dedupeKey === next.dedupeKey);
          if (queueMatchIndex >= 0) {
            chatSerialQueueRef.current[queueMatchIndex] = updateActiveToast(
              chatSerialQueueRef.current[queueMatchIndex],
              next,
            );
            return prev;
          }
          const activeMatch = prev.find((item) => (
            String(item?.source || '').trim() === 'chat'
            && item.dedupeKey === next.dedupeKey
          ));
          if (activeMatch) {
            return prev.map((item) => (
              item.id === activeMatch.id
                ? updateActiveToast(item, next)
                : item
            ));
          }
        }
        chatSerialQueueRef.current.push(next);
        const hasActiveChatToast = prev.some((item) => String(item?.source || '').trim() === 'chat');
        if (!hasActiveChatToast) {
          const queued = chatSerialQueueRef.current.shift();
          if (queued && !queued.persist) queued.expiresAt = Date.now() + queued.durationMs;
          return queued ? [...prev, queued] : prev;
        }
        return prev;
      }

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
  }, []);

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
    setToastHistory([]);
  }, []);

  const markHubNotificationsSeen = useCallback((ids) => {
    const values = (Array.isArray(ids) ? ids : [ids])
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    if (values.length === 0) return;

    setSeenHubNotificationIds((prev) => {
      const next = [...new Set([...prev, ...values])];
      return next.slice(-MAX_SEEN_IDS);
    });
  }, []);

  const hasSeenHubNotification = useCallback((id) => {
    const normalized = String(id || '').trim();
    return normalized ? seenHubNotificationIds.includes(normalized) : false;
  }, [seenHubNotificationIds]);

  const value = useMemo(() => ({
    toastHistory,
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
    toastHistory,
  ]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
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
