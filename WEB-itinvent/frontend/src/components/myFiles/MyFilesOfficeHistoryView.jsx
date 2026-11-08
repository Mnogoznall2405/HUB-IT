import { useContext, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, LinearProgress } from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import AuthContext from '../../contexts/AuthContext';
import { myFilesOfficeAPI } from '../../api/myFilesOffice';
import { loadDocsApi } from './useMyFilesEditorSession';

const messageOf = error => typeof error?.response?.data?.detail === 'string' ? error.response.data.detail : 'История временно недоступна. Повторите загрузку.';

/** A separate read-only SDK instance leaves the live editor and its unsent changes intact. */
export default function MyFilesOfficeHistoryView({ fileId, fileName, onClose, active = true }) {
  const auth = useContext(AuthContext);
  const accountKey = String(auth?.user?.id ?? '');
  const hostRef = useRef(null);
  const callbacks = useRef({ onClose });
  callbacks.current = { onClose, active };
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!fileId) return undefined;
    let disposed = false;
    let editor;
    let readyTimer;
    let historyStarted = false;
    let dataSequence = 0;
    let listSequence = 0;
    const controllers = new Set();
    const request = async job => {
      const controller = new AbortController();
      controllers.add(controller);
      try { return await job(controller.signal); }
      finally { controllers.delete(controller); }
    };
    const report = err => {
      if (disposed) return;
      setError(messageOf(err));
      const denied = [401, 403, 404, 410].includes(err?.response?.status);
      if (denied) { try { editor?.destroyEditor?.(); } catch { /* Already removed by the SDK. */ } }
      return denied;
    };
    const listHistory = async () => {
      const sequence = ++listSequence;
      setError('');
      try {
        const history = await request(signal => myFilesOfficeAPI.getHistory(fileId, { signal }));
        if (disposed || sequence !== listSequence) return;
        if (!Number.isInteger(history?.currentVersion) || history.currentVersion < 1 || !Array.isArray(history?.history) || !history.history.length
          || !history.history.some(item => item.version === history.currentVersion)
          || history.history.some(item => !Number.isInteger(item.version) || item.version < 1 || typeof item.key !== 'string' || !item.key)) throw new Error('Invalid history');
        editor.refreshHistory(history);
      } catch (err) {
        if (disposed || sequence !== listSequence) return;
        if (!report(err)) { try { editor?.refreshHistory?.({ error: messageOf(err) }); } catch { /* Error remains in HUB. */ } }
      }
    };
    const showVersion = async event => {
      const version = event?.data;
      if (!Number.isInteger(version) || version < 1) return;
      const sequence = ++dataSequence;
      setError('');
      try {
        const payload = await request(signal => myFilesOfficeAPI.getHistoryData(fileId, version, { signal }));
        if (disposed || sequence !== dataSequence) return;
        if (payload?.data?.version !== version || !payload.data.key || !payload.data.url || !payload.data.token) throw new Error('Invalid version');
        editor.setHistoryData(payload.data);
      } catch (err) {
        if (!disposed && sequence === dataSequence && !report(err)) {
          try { editor?.setHistoryData?.({ error: messageOf(err), version }); } catch { /* Error remains in HUB. */ }
        }
      }
    };
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const payload = await request(signal => myFilesOfficeAPI.getHistoryConfig(fileId, { signal }));
        if (disposed) return;
        const config = payload?.config;
        if (!config?.token || config?.editorConfig?.mode !== 'view' || config?.document?.permissions?.edit !== false
          || String(config?.editorConfig?.user?.id ?? '') !== accountKey) throw new Error('Invalid history configuration');
        await loadDocsApi(payload.public_path);
        if (disposed || !hostRef.current) return;
        const target = document.createElement('div');
        target.id = `office-history-${fileId}`;
        hostRef.current.replaceChildren(target);
        editor = new window.DocsAPI.DocEditor(target.id, { ...config, width: '100%', height: '100%', events: {
          onDocumentReady: () => {
            if (disposed) return;
            clearTimeout(readyTimer);
            setLoading(false);
            if (!historyStarted) {
              historyStarted = true;
              if (callbacks.current.active) hostRef.current?.querySelector('iframe')?.focus();
              void listHistory();
            }
          },
          onRequestHistory: () => { if (!disposed) void listHistory(); },
          onRequestHistoryData: event => { if (!disposed) void showVersion(event); },
          onRequestHistoryClose: () => { if (!disposed) callbacks.current.onClose?.(); },
          onRequestClose: () => { if (!disposed) callbacks.current.onClose?.(); },
          onError: () => { if (!disposed) { clearTimeout(readyTimer); setLoading(false); setError('Редактор не смог показать историю. Повторите загрузку.'); } },
        } });
        if (!historyStarted) readyTimer = setTimeout(() => {
          if (!disposed) { setLoading(false); setError('История открывается дольше обычного. Повторите загрузку.'); }
        }, 60000);
      } catch (err) { if (!disposed) { setLoading(false); report(err); } }
    })();
    return () => {
      disposed = true;
      clearTimeout(readyTimer);
      controllers.forEach(controller => controller.abort());
      try { editor?.destroyEditor?.(); } catch { /* The SDK may have already removed its frame. */ }
    };
  }, [fileId, accountKey, retry]);

  return <Box role="region" aria-label={`История изменений · ${fileName}`} sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
      {loading || error ? <Box sx={{ px: 1, py: 0.5 }}>
        <Button size="small" startIcon={<ArrowBackRoundedIcon />} onClick={onClose} autoFocus={active}>Вернуться к документу</Button>
      </Box> : null}
      {error ? <Alert severity="error" sx={{ borderRadius: 0 }} action={<Button color="inherit" onClick={() => setRetry(value => value + 1)}>Повторить</Button>}>{error}</Alert> : null}
      {loading ? <LinearProgress aria-label="Загрузка истории изменений" /> : null}
      <Box ref={hostRef} data-testid="my-files-native-history" sx={{ flex: 1, minHeight: 0 }} />
  </Box>;
}
