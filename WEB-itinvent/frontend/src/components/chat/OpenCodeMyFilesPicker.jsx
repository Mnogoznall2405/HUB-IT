import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { myFilesAPI } from '../../api/myFiles';
import { loadSandboxInputFile, SANDBOX_INPUT_MAX_BYTES } from '../../api/chatSandboxFiles';
import { isArchiveFile } from './chatHelpers';

export default function OpenCodeMyFilesPicker({ onSelectFiles, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [folderId, setFolderId] = useState('');
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const downloadRef = useRef(null);
  const latestSelectRef = useRef(onSelectFiles);
  useLayoutEffect(() => {
    latestSelectRef.current = onSelectFiles;
    if (disabled) {
      downloadRef.current?.abort();
      setBusy(false);
    }
  }, [disabled, onSelectFiles]);
  useLayoutEffect(() => () => downloadRef.current?.abort(), []);
  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setFiles([]);
    setError('');
    Promise.all([
      myFilesAPI.listFiles({ folderId: folderId || null, signal: controller.signal }),
      myFilesAPI.listFolders({ signal: controller.signal }),
    ]).then(([fileData, folderData]) => {
      if (controller.signal.aborted) return;
      setFiles(fileData?.items || []);
      setFolders(folderData?.items || []);
    }).catch(() => {
      if (!controller.signal.aborted) setError('Не удалось загрузить Мои файлы. Проверьте доступ и повторите открытие.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [open, folderId]);
  const close = () => {
    downloadRef.current?.abort();
    setOpen(false);
    setBusy(false);
  };
  const select = async (item) => {
    if (busy || disabled) return;
    const controller = new AbortController();
    downloadRef.current = controller;
    setBusy(true);
    setError('');
    try {
      const file = await loadSandboxInputFile(item, { signal: controller.signal });
      if (controller.signal.aborted) return;
      latestSelectRef.current?.({ target: { files: [file], value: '' } });
      close();
    } catch (err) {
      if (!controller.signal.aborted) setError(err?.message || 'Не удалось подготовить файл.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <>
      <Button disabled={disabled} onClick={() => setOpen(true)} sx={{ alignSelf: 'flex-start', minHeight: 44 }}>
        Добавить в OpenCode из Моих файлов
      </Button>
      <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="opencode-my-files-title">
        <DialogTitle id="opencode-my-files-title">Выберите файл для OpenCode</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <Typography variant="body2">Файл добавится к сообщению. Перед отправкой укажите, что с ним сделать. До 256 МБ, без архивов.</Typography>
            <TextField select label="Папка" value={folderId} disabled={busy} onChange={(event) => setFolderId(event.target.value)}>
              <MenuItem value="">Мои файлы</MenuItem>
              {folders.map((folder) => <MenuItem key={folder.id} value={folder.id}>{folder.path || folder.name}</MenuItem>)}
            </TextField>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {loading || busy ? <Stack direction="row" spacing={1} role="status"><CircularProgress size={20} /><Typography>{busy ? 'Подготовка файла…' : 'Загрузка…'}</Typography></Stack> : null}
            {!loading && files.length === 0 ? <Typography color="text.secondary">В этой папке нет файлов.</Typography> : null}
            {files.map((item) => {
              const name = item.download_file_name || item.original_file_name || 'Файл';
              const unavailable = item.status !== 'ready' || Number(item.original_size_bytes) > SANDBOX_INPUT_MAX_BYTES
                || isArchiveFile({ name, type: item.download_mime_type || item.mime_type });
              return <Button key={item.id} disabled={busy || disabled || unavailable} onClick={() => void select(item)} sx={{ justifyContent: 'flex-start', overflowWrap: 'anywhere', minHeight: 44 }}>{name}{unavailable ? ' — недоступен для отправки' : ''}</Button>;
            })}
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={close}>Отмена</Button></DialogActions>
      </Dialog>
    </>
  );
}
