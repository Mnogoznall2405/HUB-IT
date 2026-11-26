import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import { myFilesAPI } from '../../api/myFiles';
import { getMyFileName } from '../../lib/myFilesPreview';
import { folderTreeOptions } from './MyFilesCopyDialog';

export default function MyFilesLibraryMoveDialog({ files, libraries, isCurrent, onClose, onMoved }) {
  const [libraryId, setLibraryId] = useState('');
  const [folderId, setFolderId] = useState('');
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const options = useMemo(() => folderTreeOptions(folders), [folders]);

  useEffect(() => {
    if (!libraryId) return undefined;
    const controller = new AbortController();
    setLoading(true);
    myFilesAPI.listFolders({ libraryId, signal: controller.signal })
      .then((payload) => { if (!controller.signal.aborted) setFolders(payload?.items || []); })
      .catch(() => {
        if (!controller.signal.aborted) setError('Не удалось загрузить список папок. Выберите общую папку заново.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [libraryId]);

  const submit = async () => {
    if (!libraryId || progress !== null || !files.length) return;
    setError('');
    setProgress(0);
    const moved = [];
    const failures = [];
    for (const [index, file] of files.entries()) {
      if (!isCurrent()) return;
      try {
        await myFilesAPI.moveFileToLibrary(file.id, { libraryId, folderId: folderId || null });
        moved.push(file.id);
      } catch (err) {
        failures.push(`${getMyFileName(file)}: ${err?.response?.data?.detail || 'не удалось перенести'}`);
      }
      if (!isCurrent()) return;
      setProgress(index + 1);
    }
    setProgress(null);
    if (failures.length) {
      setError(`Перенесено ${moved.length} из ${files.length}. ${failures.slice(0, 3).join('; ')}.`);
    }
    onMoved(moved, failures.length === 0);
  };

  const busy = progress !== null;
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="my-files-library-move-title">
      <DialogTitle id="my-files-library-move-title">Переместить в общую папку ({files.length})</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="warning">
            Файлы исчезнут с личного диска. История версий сохранится; доступ будет определяться правами общей папки.
            Прежние персональные доступы и ссылки на эти файлы перестанут работать.
          </Alert>
          <TextField select label="Общая папка" value={libraryId} disabled={busy} onChange={(event) => {
            setLibraryId(event.target.value);
            setFolderId('');
            setFolders([]);
            setError('');
          }}>
            <MenuItem value="">Выберите общую папку</MenuItem>
            {libraries.map((library) => <MenuItem key={library.id} value={String(library.id)}>{library.name}</MenuItem>)}
          </TextField>
          <TextField select label="Куда внутри папки" value={folderId} disabled={!libraryId || busy || loading}
            onChange={(event) => setFolderId(event.target.value)}>
            <MenuItem value="">Корень общей папки</MenuItem>
            {options.map((folder) => <MenuItem key={folder.id} value={folder.id} sx={{ pl: 2 + folder.depth * 2 }}>{folder.name}</MenuItem>)}
          </TextField>
          {error && <Alert severity="error">{error}</Alert>}
          {busy && <span role="status">Обработано: {progress} из {files.length}</span>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>Закрыть</Button>
        <Button variant="contained" disabled={!libraryId || loading || busy || !files.length} onClick={() => void submit()}>
          Переместить
        </Button>
      </DialogActions>
    </Dialog>
  );
}
