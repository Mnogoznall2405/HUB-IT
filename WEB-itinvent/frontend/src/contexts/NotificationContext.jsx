import {
  Alert,
  AlertTitle,
  Box,
  Snackbar,
  Stack,
} from '@mui/material';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const NotificationContext = createContext(null);

const TOAST_HISTORY_KEY = 'itinvent_toast_history';
const HUB_SEEN_KEY = 'itinvent_hub_seen_ids';
const MAX_HISTORY_ITEMS = 50;
const MAX_SEEN_IDS = 300;
const DEDUPE_WINDOW_MS = 15_000;

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
    durationMs: Number(options.durationMs || 5000) || 5000,
    dedupeMode: options.dedupeMode === 'recent' ? 'recent' : 'none',
    dedupeKey,
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

  const dismissToast = useCallback((id) => {
    setActiveToasts((prev) => prev.filter((item) => item.id !== id));
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
          const current = updated[matchIndex];
          updated[matchIndex] = {
            ...current,
            lastSeenAt: next.lastSeenAt,
            repeatCount: Number(current?.repeatCount || 1) + 1,
            suppressedCount: Number(current?.suppressedCount || 0) + 1,
            message: next.message,
            title: next.title,
            statusCode: next.statusCode || current?.statusCode,
          };
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
              ? {
                ...item,
                message: next.message,
                title: next.title,
                statusCode: next.statusCode || item.statusCode,
                lastSeenAt: next.lastSeenAt,
              }
              : item
          ));
        }
      }

      return [...prev, next].slice(-4);
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
        sx={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: (theme) => theme.zIndex.snackbar,
          pointerEvents: 'none',
        }}
      >
        <Stack spacing={1} sx={{ width: { xs: 'calc(100vw - 32px)', sm: 420 } }}>
          {activeToasts.map((item) => {
            const showTitle = String(item?.title || '').trim() && item.title !== item.message;
            return (
              <Snackbar
                key={item.id}
                open
                anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                autoHideDuration={item.durationMs}
                onClose={(_, reason) => {
                  if (reason === 'clickaway') return;
                  dismissToast(item.id);
                }}
                sx={{ position: 'static', transform: 'none', pointerEvents: 'auto' }}
              >
                <Alert
                  severity={item.severity}
                  variant="filled"
                  onClose={() => dismissToast(item.id)}
                  sx={{ width: '100%', alignItems: 'flex-start' }}
                >
                  {showTitle ? <AlertTitle>{item.title}</AlertTitle> : null}
                  {item.message}
                </Alert>
              </Snackbar>
            );
          })}
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

