import { Box, Stack } from '@mui/material';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import ToastViewport from '../components/feedback/ToastViewport';
import { normalizeToastAction } from '../components/feedback/toastActions';

const NotificationContext = createContext(null);

const TOAST_HISTORY_KEY = 'itinvent_toast_history';
const HUB_SEEN_KEY = 'itinvent_hub_seen_ids';
const MAX_HISTORY_ITEMS = 50;
const MAX_SEEN_IDS = 300;
const MAX_ACTIVE_TOASTS = 4;
const DEDUPE_WINDOW_MS = 15_000;
const TOAST_TICK_MS = 100;

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
  return safeParseArray(window.localStorage.getItem(TOAST_HISTORY_KEY));
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
  const normalizedMessage = String(message || '').trim() || 'Событие';
  const normalizedTitle = String(options.title || '').trim();
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
    paused: false,
    persist: Boolean(options.persist),
    actionLabel: String(options.actionLabel || '').trim(),
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
    paused: false,
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

  useEffect(() => {
    persistToastHistory(toastHistory);
  }, [toastHistory]);

  useEffect(() => {
    persistSeenHubIds(seenHubNotificationIds);
  }, [seenHubNotificationIds]);

  const hasRunningToastTimers = activeToasts.some((item) => !item.persist && !item.paused);

  useEffect(() => {
    if (!hasRunningToastTimers) return undefined;

    const intervalId = window.setInterval(() => {
      setActiveToasts((prev) => {
        let changed = false;
        const next = [];

        prev.forEach((item) => {
          if (item.persist || item.paused) {
            next.push(item);
            return;
          }

          const remainingMs = Math.max(0, Number(item.remainingMs || item.durationMs || 0) - TOAST_TICK_MS);
          if (remainingMs <= 0) {
            changed = true;
            return;
          }

          if (remainingMs !== item.remainingMs) {
            changed = true;
            next.push({ ...item, remainingMs });
            return;
          }

          next.push(item);
        });

        return changed ? next : prev;
      });
    }, TOAST_TICK_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasRunningToastTimers]);

  const dismissToast = useCallback((id) => {
    setActiveToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pauseToast = useCallback((id) => {
    setActiveToasts((prev) => prev.map((item) => (
      item.id === id && !item.persist
        ? { ...item, paused: true }
        : item
    )));
  }, []);

  const resumeToast = useCallback((id) => {
    setActiveToasts((prev) => prev.map((item) => (
      item.id === id && !item.persist
        ? { ...item, paused: false }
        : item
    )));
  }, []);

  const pushToast = useCallback((severity, message, options = {}) => {
    const next = buildToastPayload(severity, message, options);

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
        data-toast-position="bottom-left"
        sx={{
          position: 'fixed',
          left: { xs: 12, sm: 24 },
          bottom: { xs: 12, sm: 24 },
          zIndex: (theme) => theme.zIndex.snackbar,
          pointerEvents: 'none',
        }}
      >
        <Stack spacing={1}>
          {activeToasts.map((item) => (
            <Box key={item.id} sx={{ pointerEvents: 'auto' }}>
              <ToastViewport
                toast={item}
                open
                inline
                progressValue={item.persist ? 100 : ((Number(item.remainingMs || 0) / Number(item.durationMs || 1)) * 100)}
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
