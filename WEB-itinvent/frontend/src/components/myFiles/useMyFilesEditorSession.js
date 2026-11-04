import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import AuthContext from '../../contexts/AuthContext';
import { myFilesOfficeAPI } from '../../api/myFilesOffice';

const docsApiLoads = new Map();
const loadDocsApi = (publicPath) => {
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

const initialStatus = () => ({
  phase: 'loading', save: 'clean', offline: navigator.onLine === false,
  frameReady: false, hasEditor: false, busy: false, message: '', warning: '',
});
const retryable = (error) => !error?.response || error.response.status === 429 || error.response.status >= 500;
const retryDelay = (attempt, error) => {
  const backoff = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5) * (0.8 + Math.random() * 0.4));
  const retryAfter = Number(error?.response?.headers?.['retry-after']);
  return Math.max(backoff, Number.isFinite(retryAfter) ? Math.min(300, Math.max(0, retryAfter)) * 1000 : 0);
};

/** Retain the live editor; refresh its signed config only when the SDK requests a new version. */
export default function useMyFilesEditorSession({ fileId, onConfig, onError, onStatusChange, onRequestClose, onTitleChange }) {
  const auth = useContext(AuthContext);
  const accountKey = String(auth?.user?.id ?? auth?.user?.username ?? '');
  const hostRef = useRef(null);
  const actions = useRef({});
  const callbacks = useRef({});
  callbacks.current = { onConfig, onError, onStatusChange, onRequestClose, onTitleChange };
  const [status, setStatus] = useState(initialStatus);
  const [restart, setRestart] = useState(0);
  const [discardAction, setDiscardAction] = useState(null);

  useEffect(() => { callbacks.current.onStatusChange?.(status); }, [status]);

  useEffect(() => {
    let disposed = false;
    let editor = null;
    let currentConfig = null;
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
        frameReady = true;
        update({ frameReady: true, phase: refreshRequested ? 'refreshing' : 'opening' });
      },
      onDocumentReady: () => {
        if (disposed || terminal) return;
        documentReady = true;
        clearTimeout(readyTimer);
        frameReady = true;
        update({ frameReady: true, phase: refreshRequested ? 'refreshing' : 'ready', warning: '' });
      },
      onUserActionRequired: () => {
        if (disposed || terminal) return;
        frameReady = true;
        update({ frameReady: true, phase: 'action-required' });
      },
      onDocumentStateChange: (event) => {
        if (disposed || typeof event?.data !== 'boolean') return;
        dirty = event.data;
        hadChanges ||= dirty;
        update({ save: dirty ? 'dirty' : hadChanges ? 'submitted' : 'clean' });
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
      try {
        const payload = await myFilesOfficeAPI.getEditorConfig(fileId, { signal: controller.signal });
        const { config, public_path: publicPath } = payload;
        const capabilities = { canRename: payload.can_rename === true, canManageAccess: payload.can_manage_access === true };
        if (disposed || terminal) return;
        if (accountKey && String(config?.editorConfig?.user?.id ?? '') !== accountKey) {
          block('Учётная запись изменилась. Откройте документ заново под нужным пользователем.');
          return;
        }
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
          currentConfig = config;
          refreshRequested = false;
          attempt = 0;
          editor.refreshFile(config);
          // refreshFile does not reload the document: another onDocumentReady is not guaranteed.
          update({ phase: documentReady ? 'ready' : 'opening', message: '', warning: '' });
          return;
        }
        await loadDocsApi(publicPath);
        if (disposed || !hostRef.current) return;
        currentConfig = config;
        currentPublicPath = publicPath;
        const target = document.createElement('div');
        target.id = `office-editor-${fileId}`;
        hostRef.current.replaceChildren(target);
        callbacks.current.onConfig?.(config, capabilities);
        try {
          editor = new window.DocsAPI.DocEditor(target.id, { ...config, width: '100%', height: '100%', events });
        } catch {
          terminal = true;
          update({ phase: 'error', frameReady: true, message: 'Не удалось открыть документ в редакторе. Попробуйте открыть его заново.' });
          return;
        }
        update({ hasEditor: true, ...(terminal ? {} : { message: '' }) });
        if (!terminal && !documentReady) readyTimer = setTimeout(() => update({
          frameReady: true, warning: 'Документ открывается дольше обычного. Окно сохранено; можно дождаться загрузки или переоткрыть его.',
        }), 60000);
        attempt = 0;
      } catch (error) {
        if (disposed || controller?.signal.aborted) return;
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
    const visible = () => { if (document.visibilityState === 'visible' && navigator.onLine !== false && refreshRequested) online(); };
    const beforeUnload = (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', visible);
    actions.current = {
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
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', visible);
      actions.current = {};
      try { editor?.destroyEditor?.(); } catch { /* the frame may already be removed */ }
    };
  }, [fileId, accountKey, restart]);

  const requestClose = useCallback(() => actions.current.close?.(), []);
  const retry = useCallback(() => actions.current.retry?.(), []);
  const reopen = useCallback(() => actions.current.reopen?.(), []);
  const cancelDiscard = useCallback(() => setDiscardAction(null), []);
  const confirmDiscard = () => {
    const action = discardAction;
    setDiscardAction(null);
    if (action === 'close') callbacks.current.onRequestClose?.();
    else if (action === 'reopen') setRestart((value) => value + 1);
  };
  return { hostRef, status, requestClose, retry, reopen, discardAction, cancelDiscard, confirmDiscard };
}
