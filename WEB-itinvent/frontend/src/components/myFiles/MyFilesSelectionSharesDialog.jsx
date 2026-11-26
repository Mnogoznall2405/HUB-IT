import { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { myFilesAPI } from '../../api/myFiles';

export default function MyFilesSelectionSharesDialog({ fileIds, onClose }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    myFilesAPI.listSelectionShares({ signal: controller.signal })
      .then((rows) => { if (!controller.signal.aborted) setLinks(rows); })
      .catch(() => { if (!controller.signal.aborted) setError('Не удалось загрузить список ссылок.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const link = await myFilesAPI.createSelectionShare(fileIds);
      setLinks((current) => [link, ...current]);
      setCreated(true);
      setStatus('Ссылка создана.');
    } catch {
      setError('Не удалось создать ссылку. Проверьте, что все выбранные файлы доступны для публикации.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token) => {
    setBusy(true);
    setError('');
    try {
      await myFilesAPI.revokeSelectionShare(token);
      setLinks((current) => current.filter((link) => link.token !== token));
      setStatus('Ссылка отключена.');
    } catch {
      setError('Не удалось отключить ссылку.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="my-files-selection-shares-title">
      <DialogTitle id="my-files-selection-shares-title">Публичные ссылки на файлы</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {fileIds.length > 0 && (
            <Alert severity="warning">
              Любой человек по ссылке сможет скачать выбранные файлы ({fileIds.length}) без входа. Ссылка действует 7 дней или до отключения.
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          <Typography role="status" variant="body2">{loading ? 'Загрузка ссылок…' : status || (!links.length ? 'Нет активных ссылок.' : '')}</Typography>
          {links.map((link, index) => {
            const url = myFilesAPI.buildPublicFolderUrl(link.token);
            return (
              <Stack key={link.token} spacing={1}>
                <Typography variant="caption">Файлов: {link.file_count} · До {new Date(link.expires_at).toLocaleString('ru-RU')}</Typography>
                <TextField label={`Ссылка ${index + 1}`} size="small" value={url} inputProps={{ readOnly: true }}
                  onFocus={(event) => event.target.select()} />
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Button onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(url);
                      setStatus('Ссылка скопирована.');
                    } catch {
                      setStatus('Выделите и скопируйте ссылку из поля.');
                    }
                  }}>Копировать</Button>
                  <Button color="error" disabled={busy} onClick={() => void revoke(link.token)}>Отключить</Button>
                </Stack>
              </Stack>
            );
          })}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>Закрыть</Button>
        {fileIds.length > 0 && !created && (
          <Button variant="contained" disabled={busy || loading} onClick={() => void create()}>Создать ссылку</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
