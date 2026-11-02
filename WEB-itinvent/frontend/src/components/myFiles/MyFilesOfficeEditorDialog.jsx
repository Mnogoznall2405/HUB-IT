import { useEffect, useRef, useState } from 'react';
import { Alert, Box, CircularProgress, Dialog, IconButton, Stack, Typography } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

import { myFilesOfficeAPI } from '../../api/myFilesOffice';

const docsApiLoads = new Map();

const loadDocsApi = (publicPath) => {
  const src = `${publicPath}/web-apps/apps/api/documents/api.js`;
  if (window.DocsAPI?.DocEditor) return Promise.resolve();
  if (!docsApiLoads.has(src)) {
    docsApiLoads.set(src, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        docsApiLoads.delete(src);
        script.remove();
        reject(new Error('Сервер редактора документов недоступен'));
      };
      document.head.appendChild(script);
    }));
  }
  return docsApiLoads.get(src);
};

const errorMessage = (err) => String(err?.response?.data?.detail || err?.message || 'Не удалось открыть редактор');

function EditorSurface({ fileId, onError }) {
  const hostRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let editor = null;
    (async () => {
      try {
        const { config, public_path: publicPath } = await myFilesOfficeAPI.getEditorConfig(fileId);
        await loadDocsApi(publicPath);
        if (cancelled || !hostRef.current) return;
        const target = document.createElement('div');
        target.id = `office-editor-${fileId}`;
        hostRef.current.replaceChildren(target);
        editor = new window.DocsAPI.DocEditor(target.id, {
          ...config,
          width: '100%',
          height: '100%',
          events: { onAppReady: () => { if (!cancelled) setLoading(false); } },
        });
      } catch (err) {
        if (cancelled) return;
        const message = errorMessage(err);
        setError(message);
        setLoading(false);
        onError?.(message);
      }
    })();
    return () => {
      cancelled = true;
      try {
        editor?.destroyEditor?.();
      } catch {
        // the editor may already be torn down together with its container
      }
    };
  }, [fileId, onError]);

  return (
    <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <Box ref={hostRef} data-testid="my-files-office-editor" sx={{ position: 'absolute', inset: 0 }} />
      {loading ? (
        <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0, bgcolor: 'background.paper' }}>
          <CircularProgress />
        </Stack>
      ) : null}
      {error ? (
        <Alert severity="error" sx={{ position: 'absolute', top: 16, left: 16, right: 16 }}>{error}</Alert>
      ) : null}
    </Box>
  );
}

export default function MyFilesOfficeEditorDialog({ open, file, onClose }) {
  const fileId = String(file?.id || '');
  const fileName = String(file?.original_file_name || file?.file_name || 'документ');

  return (
    <Dialog open={Boolean(open && fileId)} onClose={onClose} fullScreen PaperProps={{ sx: { display: 'flex', flexDirection: 'column' } }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }} noWrap>{fileName}</Typography>
        <IconButton onClick={onClose} aria-label="Закрыть редактор" data-testid="my-files-office-close">
          <CloseRoundedIcon />
        </IconButton>
      </Stack>
      {open && fileId ? <EditorSurface key={fileId} fileId={fileId} /> : null}
    </Dialog>
  );
}
