import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';

import { myFilesAPI } from '../../api/myFiles';
import { getMyFileName } from '../../lib/myFilesPreview';

const LIBRARY_EDIT_ROLES = new Set(['edit', 'manage']);

const errorMessage = (err, fallback) => String(err?.response?.data?.detail || err?.message || fallback);

// Folders come flat with parent ids: order them as a tree and indent by depth.
export const folderTreeOptions = (folders) => {
  const byParent = new Map();
  (folders || []).forEach((folder) => {
    const key = String(folder?.parent_id || '');
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(folder);
  });
  const result = [];
  const walk = (parentKey, depth, seen) => {
    const children = (byParent.get(parentKey) || [])
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru', { sensitivity: 'base' }));
    children.forEach((folder) => {
      const id = String(folder.id);
      if (seen.has(id)) return;
      result.push({ id, name: String(folder.name || ''), depth });
      walk(id, depth + 1, new Set([...seen, id]));
    });
  };
  walk('', 0, new Set());
  return result;
};

/**
 * "Копировать в…": копия файла в любую свою папку или в общую папку, где у пользователя есть право правки.
 * Перенос между «Моим диском» и общими папками запрещён, копирование — разрешённый способ.
 */
export default function MyFilesCopyDialog({ open, file, libraries = [], onClose, onCopied }) {
  const [space, setSpace] = useState('');
  const [folderId, setFolderId] = useState('');
  const [folders, setFolders] = useState([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const writableLibraries = useMemo(
    () => (libraries || []).filter((entry) => LIBRARY_EDIT_ROLES.has(String(entry?.my_role || ''))),
    [libraries],
  );

  useEffect(() => {
    if (!open) return;
    setSpace(file?.library_id ? String(file.library_id) : '');
    setFolderId('');
    setError('');
  }, [open, file]);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setLoadingFolders(true);
    myFilesAPI.listFolders({ libraryId: space || null, signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) setFolders(Array.isArray(payload?.items) ? payload.items : []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFolders([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingFolders(false);
      });
    return () => controller.abort();
  }, [open, space]);

  const options = useMemo(() => folderTreeOptions(folders), [folders]);

  const submit = async () => {
    if (!file?.id) return;
    setBusy(true);
    setError('');
    try {
      const copy = await myFilesAPI.copyFile(file.id, { folderId: folderId || null, libraryId: space || null });
      onCopied?.(copy, { libraryId: space || null, folderId: folderId || null });
    } catch (err) {
      setError(errorMessage(err, 'Не удалось скопировать файл.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : () => onClose?.()} maxWidth="xs" fullWidth>
      <DialogTitle>Копировать «{getMyFileName(file)}»</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            size="small"
            label="Куда"
            value={space}
            onChange={(event) => {
              setSpace(event.target.value);
              setFolderId('');
            }}
            inputProps={{ 'data-testid': 'my-files-copy-space' }}
          >
            <MenuItem value="">Мой диск</MenuItem>
            {writableLibraries.map((entry) => (
              <MenuItem key={entry.id} value={String(entry.id)}>{entry.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Папка"
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
            disabled={loadingFolders}
            InputProps={{ endAdornment: loadingFolders ? <CircularProgress size={16} sx={{ mr: 3 }} /> : null }}
            inputProps={{ 'data-testid': 'my-files-copy-folder' }}
          >
            <MenuItem value="">Корень</MenuItem>
            {options.map((option) => (
              <MenuItem key={option.id} value={option.id} sx={{ pl: 2 + option.depth * 2 }}>{option.name}</MenuItem>
            ))}
          </TextField>
          {space ? (
            <Alert severity="info">В общей папке копия хранится бессрочно и занимает лимит этой папки.</Alert>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose?.()} disabled={busy}>Отмена</Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy} data-testid="my-files-copy-submit">
          {busy ? 'Копируем…' : 'Копировать'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
