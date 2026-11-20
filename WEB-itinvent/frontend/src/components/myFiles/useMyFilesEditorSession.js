import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTheme } from '@mui/material/styles';
import AuthContext from '../../contexts/AuthContext';
import { myFilesOfficeAPI } from '../../api/myFilesOffice';

const docsApiLoads = new Map();
const OFFICE_PUBLIC_PATH_KEY = 'hub.office.publicPath';
let rememberedPublicPath = '';
export const rememberOfficePublicPath = (publicPath) => {
  const path = String(publicPath || '').trim();
  if (!path) return;
  rememberedPublicPath = path;
  try { sessionStorage.setItem(OFFICE_PUBLIC_PATH_KEY, path); } catch { /* Storage can be disabled. */ }
};
const officePublicPathHint = () => {
  if (!rememberedPublicPath) {
    try { rememberedPublicPath = String(sessionStorage.getItem(OFFICE_PUBLIC_PATH_KEY) || '').trim(); } catch { /* Storage can be disabled. */ }
  }
  return rememberedPublicPath;
};
let nextTimingId = 0;
export const loadDocsApi = (publicPath) => {
  if (window.DocsAPI?.DocEditor) return Promise.resolve();
  const src = `${publicPath}/web-apps/apps/api/documents/api.js`;
  if (!docsApiLoads.has(src)) {
    docsApiLoads.set(src, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let timer;
      const fail = () => {
        clearTimeout(timer);
        docsApiLoads.delete(src);
        script.remove();
        reject(new Error('Сервер редактора документов недоступен'));
      };
      script.src = src;
      script.async = true;
      script.onload = () => {
        if (!window.DocsAPI?.DocEditor) return fail();
        clearTimeout(timer);
        resolve();
      };
      script.onerror = fail;
      timer = setTimeout(fail, 30000);
      document.head.appendChild(script);
    }));
  }
  return docsApiLoads.get(src);
};

const PRESENCE_DOCUMENT_TYPES = new Set(['cell', 'word', 'slide']);
const supportsPresence = (config) =>
  PRESENCE_DOCUMENT_TYPES.has(config?.documentType) && config?.document?.permissions?.edit === true;

const initialStatus = () => ({
  phase: 'loading', save: 'clean', offline: navigator.onLine === false,
  frameReady: false, hasEditor: false, busy: false, message: '', warning: '', others: [], othersCount: 0,
  docType: '', savedAt: 0,
});
const retryable = (error) => !error?.response || error.response.status === 429 || error.response.status >= 500;
const retryDelay = (attempt, error) => {
  const backoff = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5) * (0.8 + Math.random() * 0.4));
  const retryAfter = Number(error?.response?.headers?.['retry-after']);
  return Math.max(backoff, Number.isFinite(retryAfter) ? Math.min(300, Math.max(0, retryAfter)) * 1000 : 0);
};

/** Retain the live editor; refresh its signed config only when the SDK requests a new version. */
export default function useMyFilesEditorSession({ fileId, initialCompare = '', onConfig, onError, onStatusChange, onRequestClose, onTitleChange, onRequestHistory, onRequestRename, onRequestSharingSettings }) {
  const auth = useContext(AuthContext);
  const officeUiTheme = useTheme().palette.mode === 'dark' ? 'theme-dark' : 'theme-light';
  const accountKey = String(auth?.user?.id ?? auth?.user?.username ?? '');
  const hostRef = useRef(null);
  const actions = useRef({});
  const callbacks = useRef({});
  callbacks.current = { onConfig, onError, onStatusChange, onRequestClose, onTitleChange, onRequestHistory, onRequestRename, onRequestSharingSettings };
  const permissions = useRef({});
  permissions.current = { rename: auth?.hasPermission?.('my_files.write') === true, share: auth?.hasPermission?.('my_files.share') === true };
  const initialCompareRef = useRef(initialCompare);
  initialCompareRef.current = initialCompare;
  const [status, setStatus] = useState(initialStatus);
  const [restart, setRestart] = useState(0);
  const [discardAction, setDiscardAction] = useState(null);

  useEffect(() => { callbacks.current.onStatusChange?.(status); }, [status]);

  useEffect(() => {
    const timingId = ++nextTimingId;
    const startedAt = performance.now();
    let editorStartedAt = startedAt;
    let appMeasured = false;
    let documentMeasured = false;
    // Local browser diagnostics only: no file IDs, titles, URLs, tokens or content.
    const measure = (stage, start) => {
      try {
        const name = `hub.office.${stage}`;
        if (performance.getEntriesByName(name).length >= 100) performance.clearMeasures(name);
        performance.measure(name, { start, end: performance.now(), detail: { load: timingId } });
      } catch { /* Diagnostics must never interrupt the editor. */ }
    };
    let disposed = false;
    let editor = null;
    let currentConfig = null;
    let currentCapabilities = {};
    let compareRequested = false;
    // setRevisedFile opens the built-in comparison view on the live editor: the signed
    // revised-file object comes from HUB so Document Server fetches the version itself.
    const startCompare = (versionId) => {
      if (disposed || terminal || !editor) return;
      Promise.resolve()
        .then(() => myFilesOfficeAPI.compareVersion(fileId, versionId))
        .then((file) => {
          if (disposed || terminal || !editor) return;
          try { editor.setRevisedFile?.(file); } catch { /* The SDK ignored the revised file. */ }
        })
        .catch((error) => {
          if (disposed || terminal) return;
          const code = error?.response?.status;
          update({ warning: code === 404
            ? 'Версия для сравнения не найдена: у файла ещё нет сохранённых версий.'
            : 'Не удалось запустить сравнение версий.' });
        });
    };
    let currentPublicPath = '';
    let inFlight = false;
    let terminal = false;
    let dirty = false;
    let hadChanges = false;
    let refreshRequested = false;
    let retryTimer = null;
    let readyTimer = null;
    let controller = null;
    let attempt = 0;
    let frameReady = false;
    let documentReady = false;
    let checkpointMs = 0;
    let checkpointTimer = null;
    let checkpointInFlight = false;
    let unsaved = false;
    let presenceTimer = null;
    let presenceInFlight = false;
    const update = (patch) => { if (!disposed) setStatus((previous) => ({ ...previous, ...patch })); };
    setStatus(initialStatus());
    setDiscardAction(null);

    const denyEditing = () => {
      try { editor?.denyEditingRights?.('Права доступа к документу изменились.'); } catch { /* retain the document */ }
    };
    const block = (message) => {
      terminal = true;
      clearTimeout(retryTimer);
      denyEditing();
      update({ phase: 'blocked', busy: false, message });
    };
    const schedule = (kind, delay) => {
      if (disposed || terminal || retryTimer !== null) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void request(kind);
      }, delay);
    };
    const waitForChanges = () => update({
      phase: 'refreshing', busy: false,
      message: 'Есть неотправленные изменения. Дождёмся их передачи, прежде чем обновлять версию.',
    });
    const events = {
      onAppReady: () => {
        if (disposed || terminal) return;
        if (!appMeasured) { measure('frame', editorStartedAt); appMeasured = true; }
        frameReady = true;
        update({ frameReady: true, phase: refreshRequested ? 'refreshing' : 'opening' });
      },
      onDocumentReady: () => {
        if (disposed || terminal) return;
        if (!documentMeasured) {
          measure('document', editorStartedAt);
          measure('total', startedAt);
          documentMeasured = true;
        }
        documentReady = true;
        clearTimeout(readyTimer);
        frameReady = true;
        update({ frameReady: true, phase: refreshRequested ? 'refreshing' : 'ready', warning: '' });
        pollPresence();
        if (!compareRequested && initialCompareRef.current) {
          compareRequested = true;
          startCompare(initialCompareRef.current);
        }
      },
      onRequestCompareFile: () => { if (!disposed && !terminal) startCompare('latest'); },
      onUserActionRequired: () => {
        if (disposed || terminal) return;
        frameReady = true;
        update({ frameReady: true, phase: 'action-required' });
      },
      onDocumentStateChange: (event) => {
        if (disposed || typeof event?.data !== 'boolean') return;
        dirty = event.data;
        hadChanges ||= dirty;
        unsaved ||= dirty;
        update({ save: dirty ? 'dirty' : hadChanges ? 'submitted' : 'clean', ...(!dirty && hadChanges ? { savedAt: Date.now() } : {}) });
        if (!dirty && refreshRequested && !terminal) schedule('refresh', 0);
      },
      onRequestRefreshFile: () => {
        if (disposed || terminal) return;
        refreshRequested = true;
        if (dirty) return waitForChanges();
        update({ phase: 'refreshing', message: 'Восстанавливаем документ через HUB…' });
        if (!inFlight) schedule('refresh', 0);
      },
      onRequestClose: () => { if (!disposed) callbacks.current.onRequestClose?.(); },
      onMetaChange: (event) => {
        if (disposed || terminal || typeof event?.data?.title !== 'string') return;
        const title = event.data.title.trim();
        if (title && title.length <= 255) callbacks.current.onTitleChange?.(title);
      },
      onWarning: () => update({ warning: 'Редактор сообщил о проблеме. Проверьте сообщение внутри документа.' }),
      onError: () => {
        if (disposed || terminal) return;
        clearTimeout(readyTimer);
        terminal = true;
        clearTimeout(retryTimer);
        const message = 'Не удалось продолжить работу в редакторе. Сохраните доступные правки перед повторным открытием.';
        update({ phase: 'error', frameReady: true, message, busy: false });
        callbacks.current.onError?.(message);
      },
    };

    async function request(kind) {
      if (disposed || terminal || inFlight) return;
      if (navigator.onLine === false) { update({ offline: true }); return; }
      if (kind === 'refresh' && dirty) { waitForChanges(); return; }
      inFlight = true;
      controller = new AbortController();
      update({ busy: true });
      // The DocsAPI script is shared across documents: start fetching it while the config is in flight.
      const hintedPath = kind === 'initial' ? officePublicPathHint() : '';
      if (hintedPath) loadDocsApi(hintedPath).catch(() => {});
      try {
        const configStartedAt = performance.now();
        const payload = await myFilesOfficeAPI.getEditorConfig(fileId, { signal: controller.signal, uiTheme: officeUiTheme });
        if (kind === 'initial') checkpointMs = Math.max(0, Number(payload.checkpoint_interval_sec) * 1000 || 0);
        const { config, public_path: publicPath } = payload;
        rememberOfficePublicPath(publicPath);
        const capabilities = { canRename: payload.can_rename === true, canManageAccess: payload.can_manage_access === true, canViewHistory: payload.can_view_history === true,
          nativeChrome: config?.editorConfig?.customization?.close?.visible === true };
        if (disposed || terminal) return;
        if (kind === 'initial') measure('config', configStartedAt);
        if (accountKey && String(config?.editorConfig?.user?.id ?? '') !== accountKey) {
          block('Учётная запись изменилась. Откройте документ заново под нужным пользователем.');
          return;
        }
        currentCapabilities = capabilities;
        if (kind === 'refresh') {
          const oldUser = String(currentConfig?.editorConfig?.user?.id ?? '');
          const newUser = String(config?.editorConfig?.user?.id ?? '');
          if (!newUser || newUser !== oldUser || (accountKey && newUser !== accountKey)) {
            block('Учётная запись изменилась. Откройте документ заново под нужным пользователем.');
            return;
          }
          if (publicPath !== currentPublicPath || config?.documentType !== currentConfig?.documentType) {
            block('Параметры документа изменились. Откройте его заново.');
            return;
          }
          if (typeof config?.document?.key !== 'string' || !config.document.key || typeof config?.token !== 'string' || !config.token) {
            block('HUB не передал полную конфигурацию документа. Автоматическое обновление остановлено; текущее окно сохранено.');
            return;
          }
          const oldRights = currentConfig.document.permissions || {};
          const newRights = config.document.permissions || {};
          const lostWriteAccess = (oldRights.edit === true && newRights.edit !== true)
            || (oldRights.comment === true && newRights.comment !== true);
          if (lostWriteAccess) {
            callbacks.current.onConfig?.(config, capabilities);
            // refreshFile reuses the SDK's original permission/mode settings. A new role requires a fresh editor.
            block('Права редактирования изменились. Для работы с новой ролью переоткройте документ. Текущее окно сохранено для просмотра и копирования правок.');
            return;
          }
          callbacks.current.onConfig?.(config, capabilities);
          if (dirty) { waitForChanges(); return; }
          if (config.document.key === currentConfig.document.key) {
            update({ phase: 'refreshing', message: 'Ждём сохранения новой версии в HUB. Повторим автоматически.' });
            schedule('refresh', retryDelay(attempt++));
            return;
          }
          if (typeof editor?.refreshFile !== 'function') {
            block('Для обновления версии нужно переоткрыть документ. Сначала сохраните доступные правки.');
            return;
          }
          const previousConfig = currentConfig;
          currentConfig = config;
          refreshRequested = false;
          try {
            editor.refreshFile(config);
          } catch (error) {
            // A failed SDK call did not apply this version; retry it rather than
            // waiting forever for a newer HUB key while the iframe stays old.
            currentConfig = previousConfig;
            refreshRequested = true;
            throw error;
          }
          // SDK callbacks can report a fatal error synchronously during refresh.
          if (disposed || terminal) return;
          attempt = 0;
          // refreshFile does not reload the document: another onDocumentReady is not guaranteed.
          update({ phase: documentReady ? 'ready' : 'opening', message: '', warning: '' });
          return;
        }
        const sdkStartedAt = performance.now();
        await loadDocsApi(publicPath);
        if (disposed || !hostRef.current) return;
        measure('sdk', sdkStartedAt);
        currentConfig = config;
        currentPublicPath = publicPath;
        update({ docType: String(config?.documentType || '') });
        const target = document.createElement('div');
        target.id = `office-editor-${fileId}`;
        hostRef.current.replaceChildren(target);
        callbacks.current.onConfig?.(config, capabilities);
        try {
          editorStartedAt = performance.now();
          editor = new window.DocsAPI.DocEditor(target.id, { ...config, width: '100%', height: '100%', events: {
            ...events,
            ...(capabilities.canViewHistory ? { onRequestHistory: () => { if (!disposed && !terminal) callbacks.current.onRequestHistory?.(); } } : {}),
            ...(capabilities.canRename && permissions.current.rename ? { onRequestRename: event => {
              if (!disposed && !terminal && currentCapabilities.canRename && permissions.current.rename && typeof event?.data === 'string') callbacks.current.onRequestRename?.(event.data);
            } } : {}),
            ...(capabilities.canManageAccess && permissions.current.share ? { onRequestSharingSettings: () => {
              if (!disposed && !terminal && currentCapabilities.canManageAccess && permissions.current.share) callbacks.current.onRequestSharingSettings?.();
            } } : {}),
          } });
        } catch {
          terminal = true;
          update({ phase: 'error', frameReady: true, message: 'Не удалось открыть документ в редакторе. Попробуйте открыть его заново.' });
          return;
        }
        update({ hasEditor: true, ...(terminal ? {} : { message: '' }) });
        if (checkpointMs > 0 && checkpointTimer === null) checkpointTimer = setInterval(checkpoint, checkpointMs);
        // Co-editors poll feeds the floating chip: shared sessions reach every open document type.
        if (supportsPresence(config) && presenceTimer === null) {
          presenceTimer = setInterval(pollPresence, 30000);
        }
        if (!terminal && !documentReady) readyTimer = setTimeout(() => update({
          frameReady: true, warning: 'Документ открывается дольше обычного. Окно сохранено; можно дождаться загрузки или переоткрыть его.',
        }), 60000);
        attempt = 0;
      } catch (error) {
        if (disposed || terminal || controller?.signal.aborted) return;
        if (!retryable(error)) {
          const code = error?.response?.status;
          const denied = [401, 403, 404, 410].includes(code);
          const message = code === 401 ? 'Сессия HUB завершена. Войдите снова, чтобы открыть документ.'
            : denied ? 'Доступ к документу изменён или файл больше недоступен. Автоматическое обновление остановлено.'
              : typeof error?.response?.data?.detail === 'string' ? error.response.data.detail : 'Не удалось открыть документ.';
          if (denied) block(message);
          else { terminal = true; update({ phase: 'error', frameReady: true, message }); }
          callbacks.current.onError?.(message);
          return;
        }
        update({
          phase: kind === 'refresh' ? 'refreshing' : 'loading',
          message: 'HUB или сервер редактора временно недоступен. Повторим автоматически.',
        });
        schedule(kind, retryDelay(attempt++, error));
      } finally {
        inFlight = false;
        update({ busy: false });
        if (refreshRequested && editor && !dirty && !terminal && retryTimer === null) schedule('refresh', 0);
      }
    }

    const online = () => {
      update({ offline: false });
      if (terminal) return;
      clearTimeout(retryTimer);
      retryTimer = null;
      if (!editor || refreshRequested) schedule(editor ? 'refresh' : 'initial', 0);
    };
    const offline = () => update({ offline: true });
    // Periodic forcesave keeps restorable versions appearing while the session is still open.
    // It waits for acknowledged changes (dirty is false) and ignores failures: the next tick retries.
    const checkpoint = () => {
      if (!unsaved || dirty || terminal || disposed || checkpointInFlight || navigator.onLine === false) return;
      checkpointInFlight = true;
      Promise.resolve()
        .then(() => myFilesOfficeAPI.requestCheckpoint(fileId))
        .then((outcome) => {
          if (outcome?.result === 'requested' || outcome?.result === 'no_changes') unsaved = false;
        })
        .catch(() => { /* A failed heartbeat simply retries on the next interval. */ })
        .finally(() => { checkpointInFlight = false; });
    };
    // Presence is advisory: failures are silent and retried on the next interval tick.
    const pollPresence = () => {
      if (disposed || terminal || presenceInFlight || !documentReady || navigator.onLine === false) return;
      if (!supportsPresence(currentConfig)) return;
      presenceInFlight = true;
      Promise.resolve()
        .then(() => myFilesOfficeAPI.getOfficePresence(fileId))
        .then((payload) => {
          if (disposed) return;
          const names = Array.isArray(payload?.others) ? payload.others.filter((name) => typeof name === 'string' && name) : [];
          update({ others: names, othersCount: Math.max(names.length, Number(payload?.others_count) || 0) });
        })
        .catch(() => {})
        .finally(() => { presenceInFlight = false; });
    };
    const visible = () => { if (document.visibilityState === 'visible' && navigator.onLine !== false && refreshRequested) online(); };
    const hidden = () => { if (document.visibilityState === 'hidden') checkpoint(); };
    const checkClose = (event) => { if (dirty) event.preventDefault(); };
    const beforeUnload = (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('hub:before-close', checkClose);
    document.addEventListener('visibilitychange', visible);
    document.addEventListener('visibilitychange', hidden);
    actions.current = {
      sharingSettings: settings => {
        if (disposed || terminal || !currentCapabilities.canManageAccess || !permissions.current.share) return;
        try { editor?.setSharingSettings?.(settings); } catch { /* HUB already confirmed the access change. */ }
      },
      compare: startCompare,
      retry: () => {
        if (terminal || inFlight) return;
        clearTimeout(retryTimer);
        retryTimer = null;
        schedule(editor ? 'refresh' : 'initial', 0);
      },
      reopen: () => {
        if (hadChanges || dirty) setDiscardAction('reopen');
        else setRestart((value) => value + 1);
      },
      close: () => {
        if (editor && frameReady && typeof editor.requestClose === 'function') editor.requestClose();
        else if (dirty) setDiscardAction('close');
        else callbacks.current.onRequestClose?.();
      },
    };
    void request('initial');
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(retryTimer);
      clearTimeout(readyTimer);
      clearInterval(checkpointTimer);
      clearInterval(presenceTimer);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('hub:before-close', checkClose);
      document.removeEventListener('visibilitychange', visible);
      document.removeEventListener('visibilitychange', hidden);
      actions.current = {};
      try { editor?.destroyEditor?.(); } catch { /* the frame may already be removed */ }
    };
  }, [fileId, accountKey, restart]);

  const requestClose = useCallback(() => actions.current.close?.(), []);
  const retry = useCallback(() => actions.current.retry?.(), []);
  const reopen = useCallback(() => actions.current.reopen?.(), []);
  const setSharingSettings = useCallback(settings => actions.current.sharingSettings?.(settings), []);
  const startCompare = useCallback(versionId => actions.current.compare?.(versionId), []);
  const cancelDiscard = useCallback(() => setDiscardAction(null), []);
  const confirmDiscard = () => {
    const action = discardAction;
    setDiscardAction(null);
    if (action === 'close') callbacks.current.onRequestClose?.();
    else if (action === 'reopen') setRestart((value) => value + 1);
  };
  return { hostRef, status, requestClose, retry, reopen, discardAction, cancelDiscard, confirmDiscard, setSharingSettings, startCompare };
}
