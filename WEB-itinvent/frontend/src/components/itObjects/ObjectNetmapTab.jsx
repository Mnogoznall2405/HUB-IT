import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import UploadRoundedIcon from '@mui/icons-material/UploadRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import { itObjectsAPI } from '../../api/itObjects';
import { getItObjectsErrorMessage, isItObjectsRequestCancelled } from './itObjectsShared';
import {
  drawioEditorUrl,
  drawioExportPngBase64,
  drawioOrigin,
  drawioViewerUrl,
  looksLikeDrawioXml,
  parseDrawioMessage,
} from '../../lib/drawio';

const EDITOR_INIT_TIMEOUT_MS = 15000;
const EDITOR_SAVE_DEBOUNCE_MS = 1500;

const formatWhen = (value) => {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toLocaleString('ru-RU') : '';
};

const readFileText = (file) => {
  if (typeof file?.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать файл'));
    reader.readAsText(file);
  });
};

// Встраиваемый редактор diagrams.net по официальному JSON-протоколу embed-режима:
// init -> load(xml) -> autosave/save(xml) -> exit. Контент уходит только в iframe указанного origin.
function DrawioEditorDialog({ open, fileName, xml, version, onSaved, onExported, onClose }) {
  const iframeRef = useRef(null);
  const pendingXmlRef = useRef('');
  const expectedRef = useRef(version);
  const originRef = useRef('');
  const saveTimerRef = useRef(0);
  const onSavedRef = useRef(onSaved);
  const onExportedRef = useRef(onExported);
  const onCloseRef = useRef(onClose);
  const [editorState, setEditorState] = useState('loading');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editorUrl, setEditorUrl] = useState('');

  onSavedRef.current = onSaved;
  onExportedRef.current = onExported;
  onCloseRef.current = onClose;
  useEffect(() => { expectedRef.current = version; }, [version]);
  useEffect(() => {
    if (open) {
      setEditorState('loading');
      setSaveError('');
      originRef.current = drawioOrigin();
      setEditorUrl(drawioEditorUrl());
    }
  }, [open]);

  const save = useCallback(async (body, { force = false } = {}) => {
    if (!body) return true;
    setSaving(true);
    setSaveError('');
    try {
      const saved = await onSavedRef.current({ xml: body, expectedVersion: force ? null : expectedRef.current });
      if (saved?.version) expectedRef.current = saved.version;
      pendingXmlRef.current = '';
      // Обновить PNG-миниатюру карты: редактор рендерит текущий документ в фоне.
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ action: 'export', format: 'png', xml: body, border: 8, background: '#ffffff' }),
        originRef.current || '*',
      );
      return true;
    } catch (requestError) {
      setSaveError(requestError?.response?.status === 409 && !force ? 'conflict' : getItObjectsErrorMessage(requestError, 'Не удалось сохранить карту'));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const saveThenClose = useCallback(async () => {
    const pending = pendingXmlRef.current;
    if (pending) await save(pending);
    onCloseRef.current();
  }, [save]);

  useEffect(() => {
    if (!open) return undefined;
    const origin = originRef.current || drawioOrigin();
    originRef.current = origin;
    const scheduleSave = (immediate = false) => {
      window.clearTimeout(saveTimerRef.current);
      if (immediate) {
        void save(pendingXmlRef.current);
      } else {
        saveTimerRef.current = window.setTimeout(() => void save(pendingXmlRef.current), EDITOR_SAVE_DEBOUNCE_MS);
      }
    };
    const onMessage = (event) => {
      const iframe = iframeRef.current;
      if (!iframe || event.source !== iframe.contentWindow) return;
      if (origin && event.origin !== origin) return;
      const message = parseDrawioMessage(event.data);
      if (!message?.event) return;
      if (message.event === 'init') {
        iframe.contentWindow.postMessage(JSON.stringify({
          action: 'load',
          xml,
          autosave: 1,
          title: fileName || 'Карта сети',
          modified: 'unsavedChanges',
        }), origin || '*');
        setEditorState('ready');
      } else if (message.event === 'autosave') {
        if (typeof message.xml === 'string' && message.xml) {
          pendingXmlRef.current = message.xml;
          scheduleSave();
        }
      } else if (message.event === 'save') {
        if (typeof message.xml === 'string' && message.xml) pendingXmlRef.current = message.xml;
        scheduleSave(true);
      } else if (message.event === 'export') {
        const png = drawioExportPngBase64(message);
        if (png && onExportedRef.current) void onExportedRef.current(png);
      } else if (message.event === 'exit') {
        void saveThenClose();
      }
    };
    const timer = window.setTimeout(() => setEditorState((prev) => (prev === 'loading' ? 'failed' : prev)), EDITOR_INIT_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(saveTimerRef.current);
      window.removeEventListener('message', onMessage);
    };
  }, [open, xml, fileName, save, saveThenClose]);

  const close = () => { void saveThenClose(); };

  return (
    <Dialog open={open} onClose={close} fullScreen>
      <DialogTitle sx={{ py: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography fontWeight={800} sx={{ flex: 1, minWidth: 0 }} noWrap>
            Карта сети — редактирование{fileName ? ` · ${fileName}` : ''}
          </Typography>
          {saving ? <Typography variant="caption" color="text.secondary">Сохранение…</Typography> : null}
          <Tooltip title="Сохранить и закрыть">
            <IconButton aria-label="Закрыть редактор" onClick={close} sx={{ width: 44, height: 44 }}>
              <CloseRoundedIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', position: 'relative' }} dividers>
        {saveError === 'conflict' ? (
          <Alert
            severity="warning"
            action={(
              <Stack direction="row" spacing={1}>
                <Button size="small" color="inherit" disabled={saving} onClick={() => void save(pendingXmlRef.current, { force: true })}>
                  Перезаписать
                </Button>
                <Button size="small" color="inherit" onClick={() => onCloseRef.current()}>Выйти без сохранения</Button>
              </Stack>
            )}
          >
            Карту уже изменил другой пользователь. Перезаписать её или выйти без сохранения?
          </Alert>
        ) : null}
        {saveError && saveError !== 'conflict' ? <Alert severity="error">{saveError}</Alert> : null}
        {editorState === 'loading' ? <LinearProgress aria-label="Загрузка редактора" /> : null}
        {editorState === 'failed' ? (
          <Alert severity="warning" sx={{ m: 2 }}>
            Редактор diagrams.net не ответил — проверьте доступ к нему или настройте self-hosted drawio
            (VITE_DRAWIO_EDITOR_URL). Файл можно скачать и отредактировать в приложении drawio, затем загрузить обратно.
          </Alert>
        ) : null}
        {editorUrl ? (
          <iframe
            ref={iframeRef}
            title="Редактор карты сети drawio"
            src={editorUrl}
            style={{ flex: 1, border: 0, display: editorState === 'failed' ? 'none' : 'block' }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

const normalizeHost = (value) => String(value || '').split('.')[0].trim().toLowerCase();

// Подписи узлов карты, совпавшие с компьютерами объекта: токен в подписи = hostname.
const matchMapDevices = (labels, computers) => {
  if (!Array.isArray(labels) || !labels.length || !Array.isArray(computers)) return [];
  const hosts = new Map(
    computers.map((item) => [normalizeHost(item?.hostname), item]).filter(([key]) => key.length >= 3),
  );
  if (!hosts.size) return [];
  const out = [];
  const seen = new Set();
  labels.forEach((label) => {
    const tokens = String(label).toLowerCase().split(/[\s()[\],;:]+/).filter(Boolean);
    const hit = tokens.map((token) => hosts.get(token)).find(Boolean) || hosts.get(normalizeHost(label));
    if (hit) {
      const key = normalizeHost(hit.hostname);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ label, hostname: hit.hostname });
      }
    }
  });
  return out;
};

export default function ObjectNetmapTab({ objectRef, canManage, canViewComputers, onOpenTab }) {
  const [state, setState] = useState({ loading: true, map: null, error: '', labels: [] });
  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState({ loading: false, items: [], error: '' });
  const [viewing, setViewing] = useState(null);
  const [devices, setDevices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [conflict, setConflict] = useState(null);
  const fileInputRef = useRef(null);
  const requestSeqRef = useRef(0);

  const load = useCallback(async ({ silent = false } = {}) => {
    const seq = ++requestSeqRef.current;
    if (!silent) setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const payload = await itObjectsAPI.netmap(objectRef);
      if (seq !== requestSeqRef.current) return;
      setState({ loading: false, map: payload?.map || null, error: '', labels: payload?.labels || [] });
    } catch (requestError) {
      if (isItObjectsRequestCancelled(requestError) || seq !== requestSeqRef.current) return;
      setState((prev) => ({ ...prev, loading: false, error: getItObjectsErrorMessage(requestError, 'Не удалось загрузить карту сети') }));
    }
  }, [objectRef]);

  useEffect(() => {
    void load();
    return () => { requestSeqRef.current += 1; };
  }, [load]);

  const map = state.map;
  const labels = state.labels;
  const [viewerUrl, setViewerUrl] = useState('');
  useEffect(() => {
    setViewerUrl(map ? drawioViewerUrl(map.xml, { title: map.file_name }) : '');
  }, [map]);

  const save = useCallback(async ({ fileName, xml, expectedVersion = null }) => {
    const payload = await itObjectsAPI.saveNetmap(objectRef, { fileName, xml, expectedVersion });
    setNotice('');
    setUploadError('');
    setState({ loading: false, map: payload?.map || null, error: '', labels: payload?.labels || [] });
    return payload?.map;
  }, [objectRef]);

  const onEditorSaved = useCallback(({ xml, expectedVersion }) => (
    save({ fileName: map?.file_name || 'network-map.drawio', xml, expectedVersion })
  ), [save, map?.file_name]);

  // Миниатюра — производная: ошибка записи превью не должна мешать работе с картой.
  const onEditorExported = useCallback((pngBase64) => {
    itObjectsAPI.saveNetmapPreview(objectRef, pngBase64)
      .then(() => setState((prev) => (prev.map ? { ...prev, map: { ...prev.map, has_preview: true } } : prev)))
      .catch(() => {});
  }, [objectRef]);

  // Устройства, подписанные на карте, сопоставляемые с компьютерами объекта.
  useEffect(() => {
    let cancelled = false;
    if (!canViewComputers || !labels.length) {
      setDevices([]);
      return undefined;
    }
    itObjectsAPI.computers(objectRef)
      .then((payload) => {
        if (!cancelled) setDevices(matchMapDevices(labels, payload?.items || []));
      })
      .catch(() => { if (!cancelled) setDevices([]); });
    return () => { cancelled = true; };
  }, [objectRef, canViewComputers, labels]);

  const openHistory = useCallback(async () => {
    setHistoryOpen(true);
    setViewing(null);
    setHistory({ loading: true, items: [], error: '' });
    try {
      const payload = await itObjectsAPI.netmapVersions(objectRef);
      setHistory({ loading: false, items: payload?.items || [], error: '' });
    } catch (requestError) {
      setHistory({ loading: false, items: [], error: getItObjectsErrorMessage(requestError, 'Не удалось загрузить историю') });
    }
  }, [objectRef]);

  const viewVersion = useCallback(async (version) => {
    setHistory((prev) => ({ ...prev, error: '' }));
    try {
      const payload = await itObjectsAPI.netmapVersion(objectRef, version);
      setViewing(payload?.map || null);
    } catch (requestError) {
      setHistory((prev) => ({ ...prev, error: getItObjectsErrorMessage(requestError, 'Не удалось открыть версию') }));
    }
  }, [objectRef]);

  const restoreVersion = useCallback(async (version) => {
    setBusy(true);
    try {
      const payload = await itObjectsAPI.netmapVersion(objectRef, version);
      const row = payload?.map;
      if (!row?.xml) return;
      await save({ fileName: row.file_name || 'network-map.drawio', xml: row.xml, expectedVersion: map?.version ?? null });
      setHistoryOpen(false);
      setViewing(null);
    } catch (requestError) {
      setHistory((prev) => ({
        ...prev,
        error: requestError?.response?.status === 409
          ? 'Карту уже изменил другой пользователь. Обновите вкладку и повторите.'
          : getItObjectsErrorMessage(requestError, 'Не удалось восстановить версию'),
      }));
    } finally {
      setBusy(false);
    }
  }, [objectRef, map?.version, save]);

  const pickFile = () => fileInputRef.current?.click();

  const onFilePicked = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploadError('');
    setConflict(null);
    setBusy(true);
    try {
      const text = await readFileText(file);
      if (!looksLikeDrawioXml(text)) {
        setUploadError('Файл не похож на диаграмму drawio (.drawio, mxfile).');
        return;
      }
      await save({ fileName: file.name || 'network-map.drawio', xml: text, expectedVersion: map?.version ?? null });
    } catch (requestError) {
      if (requestError?.response?.status === 409) {
        try {
          setConflict({ fileName: file.name || 'network-map.drawio', xml: await readFileText(file) });
        } catch {
          setUploadError(getItObjectsErrorMessage(requestError, 'Не удалось загрузить карту'));
        }
      } else {
        setUploadError(getItObjectsErrorMessage(requestError, 'Не удалось загрузить карту'));
      }
    } finally {
      setBusy(false);
    }
  }, [map?.version, save]);

  const forceUpload = useCallback(async () => {
    if (!conflict) return;
    setBusy(true);
    try {
      await save({ fileName: conflict.fileName, xml: conflict.xml, expectedVersion: null });
      setConflict(null);
    } catch (requestError) {
      setUploadError(getItObjectsErrorMessage(requestError, 'Не удалось загрузить карту'));
      setConflict(null);
    } finally {
      setBusy(false);
    }
  }, [conflict, save]);

  const download = useCallback(() => {
    if (!map) return;
    const blob = new Blob([map.xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = map.file_name || 'network-map.drawio';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [map]);

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      await itObjectsAPI.deleteNetmap(objectRef);
      setConfirmDelete(false);
      setState({ loading: false, map: null, error: '', labels: [] });
      setDevices([]);
    } catch (requestError) {
      setNotice(getItObjectsErrorMessage(requestError, 'Не удалось удалить карту'));
    } finally {
      setBusy(false);
    }
  }, [objectRef]);

  return (
    <Stack spacing={1.5}>
      <input ref={fileInputRef} type="file" accept=".drawio,.xml,application/xml" hidden onChange={(event) => void onFilePicked(event)} />
      <Paper variant="outlined" sx={{ px: 1.5, py: 1, borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} useFlexGap flexWrap="wrap">
          <Stack sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" fontWeight={800} noWrap>
              Карта сети{map?.file_name ? ` · ${map.file_name}` : ''}
            </Typography>
            {map ? (
              <Typography variant="caption" color="text.secondary" noWrap>
                Обновлено {formatWhen(map.updated_at)}{map.updated_by ? ` · ${map.updated_by}` : ''}
              </Typography>
            ) : null}
          </Stack>
          {canManage ? (
            <Button size="small" variant="contained" startIcon={<UploadRoundedIcon />} disabled={busy} onClick={pickFile} sx={{ minHeight: 40, textTransform: 'none' }}>
              {map ? 'Заменить файл' : 'Загрузить .drawio'}
            </Button>
          ) : null}
          {map ? (
            <>
              {canManage ? (
                <Button size="small" variant="outlined" startIcon={<EditRoundedIcon />} disabled={busy} onClick={() => setEditorOpen(true)} sx={{ minHeight: 40, textTransform: 'none' }}>
                  Редактировать
                </Button>
              ) : null}
              <Button size="small" variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={download} sx={{ minHeight: 40, textTransform: 'none' }}>
                Скачать
              </Button>
              <Button size="small" variant="outlined" startIcon={<HistoryRoundedIcon />} onClick={() => void openHistory()} sx={{ minHeight: 40, textTransform: 'none' }}>
                История
              </Button>
              {canManage ? (
                <Button size="small" color="error" variant="outlined" startIcon={<DeleteOutlineRoundedIcon />} disabled={busy} onClick={() => setConfirmDelete(true)} sx={{ minHeight: 40, textTransform: 'none' }}>
                  Удалить
                </Button>
              ) : null}
            </>
          ) : null}
          <Tooltip title="Обновить">
            <span>
              <IconButton aria-label="Обновить карту сети" onClick={() => void load()} disabled={state.loading || busy} sx={{ width: 40, height: 40 }}>
                <RefreshRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        {state.loading ? <LinearProgress aria-label="Загрузка карты сети" sx={{ mt: 1 }} /> : null}
        {state.error ? <Alert severity="warning" sx={{ mt: 1 }} action={<Button disabled={state.loading} onClick={() => void load()}>Повторить</Button>}>{state.error}</Alert> : null}
        {uploadError ? <Alert severity="error" sx={{ mt: 1 }} onClose={() => setUploadError('')}>{uploadError}</Alert> : null}
        {notice ? <Alert severity="error" sx={{ mt: 1 }} onClose={() => setNotice('')}>{notice}</Alert> : null}
        {conflict ? (
          <Alert
            severity="warning"
            sx={{ mt: 1 }}
            action={(
              <Stack direction="row" spacing={1}>
                <Button size="small" color="inherit" disabled={busy} onClick={() => void forceUpload()}>Перезаписать</Button>
                <Button size="small" color="inherit" onClick={() => setConflict(null)}>Отмена</Button>
              </Stack>
            )}
          >
            Карту уже изменил другой пользователь. Перезаписать файлом «{conflict.fileName}»?
          </Alert>
        ) : null}
        {!state.loading && !state.error && !map ? (
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Карта сети не загружена. {canManage ? 'Загрузите файл .drawio — его можно будет смотреть и править прямо здесь.' : 'Загрузить её может тот, у кого на раздел есть управление.'}
          </Typography>
        ) : null}
      </Paper>

      {devices.length ? (
        <Paper variant="outlined" sx={{ px: 1.5, py: 1, borderRadius: 2 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
            <Typography variant="caption" color="text.secondary" fontWeight={700}>Устройства на карте:</Typography>
            {devices.map((device) => (
              <Chip
                key={device.hostname}
                size="small"
                variant="outlined"
                label={device.hostname}
                title={device.label}
                onClick={onOpenTab ? () => onOpenTab('computers') : undefined}
                clickable={Boolean(onOpenTab)}
              />
            ))}
          </Stack>
        </Paper>
      ) : null}

      {map ? (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          {viewerUrl ? (
            <iframe
              key={map.updated_at || 'map'}
              title="Карта сети объекта"
              src={viewerUrl}
              style={{ display: 'block', width: '100%', height: 'min(76vh, 900px)', border: 0 }}
            />
          ) : null}
        </Paper>
      ) : null}

      <DrawioEditorDialog
        open={editorOpen}
        fileName={map?.file_name}
        xml={map?.xml || ''}
        version={map?.version}
        onSaved={onEditorSaved}
        onExported={onEditorExported}
        onClose={() => setEditorOpen(false)}
      />

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ py: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography fontWeight={800} sx={{ flex: 1, minWidth: 0 }}>Карта сети — история версий</Typography>
            <IconButton aria-label="Закрыть историю" onClick={() => setHistoryOpen(false)} sx={{ width: 44, height: 44 }}>
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {history.loading ? <LinearProgress aria-label="Загрузка истории" /> : null}
          {history.error ? <Alert severity="error" sx={{ mb: 1 }}>{history.error}</Alert> : null}
          {!history.loading && !history.items.length && !history.error ? (
            <Typography color="text.secondary">Версий пока нет.</Typography>
          ) : null}
          <Stack spacing={0.5} divider={<Typography component="span" sx={{ borderTop: 1, borderColor: 'divider' }} />}>
            {history.items.map((item) => (
              <Stack key={item.version} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ py: 0.5 }}>
                <Typography fontWeight={800} sx={{ width: 48, flexShrink: 0 }}>v{item.version}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} noWrap>
                  {item.file_name} · {formatWhen(item.saved_at)}{item.saved_by ? ` · ${item.saved_by}` : ''}
                </Typography>
                <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                  <Button size="small" onClick={() => void viewVersion(item.version)} sx={{ textTransform: 'none' }}>Открыть</Button>
                  {canManage ? (
                    <Button size="small" variant="outlined" disabled={busy} onClick={() => void restoreVersion(item.version)} sx={{ textTransform: 'none' }}>
                      Восстановить
                    </Button>
                  ) : null}
                </Stack>
              </Stack>
            ))}
          </Stack>
          {viewing ? (
            <Paper variant="outlined" sx={{ mt: 1.5, borderRadius: 2, overflow: 'hidden' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, pt: 1 }}>
                Версия {viewing.version} · {viewing.file_name} · сохранена {formatWhen(viewing.saved_at)}
              </Typography>
              <iframe
                title={`Версия ${viewing.version} карты сети`}
                src={drawioViewerUrl(viewing.xml, { title: viewing.file_name })}
                style={{ display: 'block', width: '100%', height: 'min(60vh, 640px)', border: 0 }}
              />
            </Paper>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onClose={() => (busy ? null : setConfirmDelete(false))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Удалить карту сети?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Файл «{map?.file_name || 'network-map.drawio'}» будет удалён у объекта. Скачайте его заранее, если копия нужна.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)} disabled={busy}>Отмена</Button>
          <Button color="error" variant="contained" disabled={busy} onClick={() => void remove()}>Удалить</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
